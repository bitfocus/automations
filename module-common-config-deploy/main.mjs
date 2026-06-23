import { Octokit } from 'octokit'
import PLazy from 'p-lazy'
import fs from 'fs/promises'
import path from 'path'
import YAML from 'yaml'
import semver from 'semver'

// Minimum yarn version required to understand the .yarnrc.yml keys we enforce.
// Repos below this get bumped up to TARGET_YARN_VERSION.
const MIN_YARN_VERSION = '4.10.0'
const TARGET_YARN_VERSION = '4.17.0'

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })

const {
	data: { login },
} = await octokit.rest.users.getAuthenticated()
console.log('Hello, %s', login)

function base64Encode(str) {
	return Buffer.from(str, 'utf-8').toString('base64')
}

const targetWorkflowContentBase64 = PLazy.from(async () => {
	const utf8Content = await fs.readFile(
		path.join(import.meta.dirname, './assets/companion-module-checks.yaml'),
		'utf-8'
	)
	return base64Encode(utf8Content)
})

const targetIssueTemplateContentBase64 = PLazy.from(async () => {
	const [bugFile, configFileOld, configFile, featureFile] = await Promise.all([
		fs.readFile(path.join(import.meta.dirname, './assets/ISSUE_TEMPLATE/bug_report.yml'), 'utf-8'),
		fs.readFile(path.join(import.meta.dirname, './assets/ISSUE_TEMPLATE/config-old.yml'), 'utf-8'),
		fs.readFile(path.join(import.meta.dirname, './assets/ISSUE_TEMPLATE/config.yml'), 'utf-8'),
		fs.readFile(path.join(import.meta.dirname, './assets/ISSUE_TEMPLATE/feature_request.yml'), 'utf-8'),
	])

	return {
		bugFile: base64Encode(bugFile),
		configFileOld: base64Encode(configFileOld),
		configFile: base64Encode(configFile),
		featureFile: base64Encode(featureFile),
	}
})

const errors = []

const allRepos = await octokit.paginate(octokit.rest.repos.listForOrg, {
	org: 'bitfocus',
})
console.log('found %d repos in org', allRepos.length)

for (const repo of allRepos) {
	if (repo.archived) continue

	const repoName = repo.name
	if (!repoName.startsWith('companion-module-') && !repoName.startsWith('companion-surface-')) {
		continue
	}

	try {
		const checkManifestExists = await octokit.rest.repos
			.getContent({
				owner: 'bitfocus',
				repo: repoName,
				path: 'companion/manifest.json',
			})
			.then(() => true)
			.catch((e) => (e.status === 404 ? false : Promise.reject(e)))
		if (!checkManifestExists) {
			console.log(`Skipping ${repoName}: manifest.json does not exist`)
			continue
		}

		const checkExists = await octokit.rest.repos
			.getContent({
				owner: 'bitfocus',
				repo: repoName,
				path: '.github/workflows/companion-module-checks.yaml',
			})
			.then(() => true)
			.catch((e) => (e.status === 404 ? false : Promise.reject(e)))

		console.log(`Checked ${repoName}: ${checkExists ? 'exists' : 'does not exist'}`)
		if (!checkExists) {
			// Future: this should do something more patch like
			await octokit.rest.repos.createOrUpdateFileContents({
				owner: 'bitfocus',
				repo: repoName,
				path: '.github/workflows/companion-module-checks.yaml',
				content: await targetWorkflowContentBase64,
				message: "chore: add 'Companion Module Checks' workflow",
			})
		}

		const issueTemplateSetManual = await fileExists(repoName, '.github/.companion-manual-issue-templates')
		if (issueTemplateSetManual) {
			console.log(`Skipping ${repoName}: companion-manual-issue-templates flag set`)
		} else {
			const expectedFiles = await targetIssueTemplateContentBase64

			await syncMultipleFiles(
				repoName,
				repo.default_branch,
				{
					'.github/ISSUE_TEMPLATE/bug_report.yml': expectedFiles.bugFile,
					'.github/ISSUE_TEMPLATE/config.yml': [expectedFiles.configFile, expectedFiles.configFileOld],
					'.github/ISSUE_TEMPLATE/feature_request.yml': expectedFiles.featureFile,
				},
				'chore: update issue templates'
			)
		}

		// Check and remove package-lock.json if it exists
		const packageLockExists = await octokit.rest.repos
			.getContent({
				owner: 'bitfocus',
				repo: repoName,
				path: 'package-lock.json',
			})
			.then((res) => res.data)
			.catch((e) => (e.status === 404 ? null : Promise.reject(e)))

		if (packageLockExists) {
			console.log(`${repoName}: removing package-lock.json`)
			await octokit.rest.repos.deleteFile({
				owner: 'bitfocus',
				repo: repoName,
				path: 'package-lock.json',
				message: 'chore: remove package-lock.json',
				sha: packageLockExists.sha,
			})
		}

		await ensureYarnConfig(repoName, repo.default_branch)
	} catch (e) {
		console.error(`Failed ${repoName}: ${e?.message ?? e?.toString() ?? e}`)
		errors.push(e)
	}
}

console.log('All errors', errors)

async function syncMultipleFiles(repoName, defaultBranch, files, message) {
	// Fetch current content for all files
	const currentFiles = await Promise.all(
		Object.keys(files).map((path) => fetchFileContent(repoName, path).then((content) => ({ path, content })))
	)

	// Filter to only files that need updating
	const filesToUpdate = Object.entries(files).filter(([path, newContent]) => {
		const current = currentFiles.find((f) => f.path === path)
		if (!current) return true
		if (Array.isArray(newContent)) {
			return !newContent.includes(current.content)
		}
		return current?.content !== newContent
	})

	if (filesToUpdate.length === 0) {
		console.log(`Skipping ${repoName}: all files are already up to date`)
		return
	}

	console.log(`Updating ${repoName}: ${filesToUpdate.length} file(s) need updating`)

	// Get reference to the default branch
	const { data: ref } = await octokit.rest.git.getRef({
		owner: 'bitfocus',
		repo: repoName,
		ref: `heads/${defaultBranch}`,
	})

	const baseSha = ref.object.sha

	// Get the base tree
	const { data: baseCommit } = await octokit.rest.git.getCommit({
		owner: 'bitfocus',
		repo: repoName,
		commit_sha: baseSha,
	})

	// Create blobs for each file that needs updating
	const blobs = await Promise.all(
		filesToUpdate.map(async ([path, content]) => {
			const { data: blob } = await octokit.rest.git.createBlob({
				owner: 'bitfocus',
				repo: repoName,
				content: Array.isArray(content) ? content[0] : content,
				encoding: 'base64',
			})
			return { path, sha: blob.sha }
		})
	)

	// Create a new tree
	const { data: newTree } = await octokit.rest.git.createTree({
		owner: 'bitfocus',
		repo: repoName,
		base_tree: baseCommit.tree.sha,
		tree: blobs.map(({ path, sha }) => ({
			path,
			mode: '100644',
			type: 'blob',
			sha,
		})),
	})

	// Create a new commit
	const { data: newCommit } = await octokit.rest.git.createCommit({
		owner: 'bitfocus',
		repo: repoName,
		message: message,
		tree: newTree.sha,
		parents: [baseSha],
	})

	// Update the reference
	await octokit.rest.git.updateRef({
		owner: 'bitfocus',
		repo: repoName,
		ref: `heads/${defaultBranch}`,
		sha: newCommit.sha,
	})

	console.log(`Updated ${repoName} with ${filesToUpdate.length} file(s) in a single commit`)
}

// Ensure a repo's yarn setup is correct: the packageManager in package.json must be
// new enough to understand the .yarnrc.yml keys we enforce. The .yarnrc.yml changes
// require that newer yarn, so both files are committed together - an intermediate
// state with only one applied would leave yarn erroring.
async function ensureYarnConfig(repoName, defaultBranch) {
	const files = {}

	const packageJson = await computePackageManagerUpdate(repoName, MIN_YARN_VERSION, TARGET_YARN_VERSION)
	if (packageJson) files['package.json'] = packageJson

	const yarnrc = await computeYarnrcUpdate(repoName)
	if (yarnrc) files['.yarnrc.yml'] = yarnrc

	const paths = Object.keys(files)
	if (paths.length === 0) return // nothing to do

	await commitFiles(repoName, defaultBranch, files, 'chore: update yarn config')
	console.log(`Updated ${repoName}: ${paths.join(', ')} in a single commit`)
}

// If the repo has a .yarnrc.yml, return its updated content with the required keys
// present (preserving existing content and comments), or null if no change is needed.
async function computeYarnrcUpdate(repoName) {
	const existing = await fetchFileRaw(repoName, '.yarnrc.yml')
	if (!existing) return null // no .yarnrc.yml, nothing to do

	const doc = YAML.parseDocument(existing.content)
	let changed = false

	// Disable lifecycle scripts unless the repo has explicitly opted in/out
	if (doc.get('enableScripts') === undefined) {
		doc.set('enableScripts', false)
		changed = true
	}

	// Enforce a minimum age before newly published npm versions can be installed,
	// while pre-approving our own scoped packages so they aren't held back
	if (doc.get('npmMinimalAgeGate') === undefined) {
		doc.set('npmMinimalAgeGate', '3d')
		ensurePreapprovedPackage(doc, '@companion-module/*')
		changed = true
	}

	return changed ? doc.toString() : null
}

// Add an entry to the npmPreapprovedPackages list, creating the list if needed and
// avoiding duplicates if it already exists
function ensurePreapprovedPackage(doc, pkg) {
	const node = doc.get('npmPreapprovedPackages', true)
	if (!node) {
		doc.set('npmPreapprovedPackages', [pkg])
		return
	}
	if (YAML.isSeq(node)) {
		const exists = node.items.some((item) => (YAML.isScalar(item) ? item.value : item) === pkg)
		if (!exists) node.add(pkg)
	}
}

// Return package.json content with its yarn packageManager bumped to at least
// minVersion (editing the field in place to preserve formatting), or null if the
// field is already new enough or not a yarn packageManager.
async function computePackageManagerUpdate(repoName, minVersion) {
	const existing = await fetchFileRaw(repoName, 'package.json')
	if (!existing) return null

	const match = existing.content.match(/"packageManager"\s*:\s*"yarn@(\d+\.\d+\.\d+)[^"]*"/)
	if (!match) return null // no yarn packageManager field to enforce

	const currentVersion = match[1]
	if (semver.major(currentVersion) !== 4) return null // only manage yarn 4.x
	if (semver.gte(currentVersion, minVersion)) return null // already new enough

	return existing.content.replace(match[0], `"packageManager": "yarn@${minVersion}"`)
}

// Commit one or more files (path -> UTF-8 content) to the default branch in a single commit
async function commitFiles(repoName, defaultBranch, files, message) {
	const { data: ref } = await octokit.rest.git.getRef({
		owner: 'bitfocus',
		repo: repoName,
		ref: `heads/${defaultBranch}`,
	})
	const baseSha = ref.object.sha

	const { data: baseCommit } = await octokit.rest.git.getCommit({
		owner: 'bitfocus',
		repo: repoName,
		commit_sha: baseSha,
	})

	const blobs = await Promise.all(
		Object.entries(files).map(async ([path, content]) => {
			const { data: blob } = await octokit.rest.git.createBlob({
				owner: 'bitfocus',
				repo: repoName,
				content: base64Encode(content),
				encoding: 'base64',
			})
			return { path, sha: blob.sha }
		})
	)

	const { data: newTree } = await octokit.rest.git.createTree({
		owner: 'bitfocus',
		repo: repoName,
		base_tree: baseCommit.tree.sha,
		tree: blobs.map(({ path, sha }) => ({ path, mode: '100644', type: 'blob', sha })),
	})

	const { data: newCommit } = await octokit.rest.git.createCommit({
		owner: 'bitfocus',
		repo: repoName,
		message: message,
		tree: newTree.sha,
		parents: [baseSha],
	})

	await octokit.rest.git.updateRef({
		owner: 'bitfocus',
		repo: repoName,
		ref: `heads/${defaultBranch}`,
		sha: newCommit.sha,
	})
}

// Fetch a file's decoded UTF-8 content along with its blob sha, or null if missing
async function fetchFileRaw(repoName, path) {
	return octokit.rest.repos
		.getContent({
			owner: 'bitfocus',
			repo: repoName,
			path: path,
		})
		.then((res) => ({
			content: Buffer.from(res.data.content, 'base64').toString('utf-8'),
			sha: res.data.sha,
		}))
		.catch((e) => (e.status === 404 ? null : Promise.reject(e)))
}

async function fetchFileContent(repoName, path) {
	return octokit.rest.repos
		.getContent({
			owner: 'bitfocus',
			repo: repoName,
			path: path,
		})
		.then((res) => res.data.content.replace(/\s+/g, ''))
		.catch((e) => (e.status === 404 ? null : Promise.reject(e)))
}

async function fileExists(repoName, path) {
	return octokit.rest.repos
		.getContent({
			owner: 'bitfocus',
			repo: repoName,
			path: path,
		})
		.then((res) => res.data)
		.catch((e) => (e.status === 404 ? null : Promise.reject(e)))
}
