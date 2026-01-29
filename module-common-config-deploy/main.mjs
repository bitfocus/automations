import { Octokit } from 'octokit'
import dotenv from 'dotenv'
import PLazy from 'p-lazy'
import fs from 'fs/promises'
import path from 'path'
dotenv.config()

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
