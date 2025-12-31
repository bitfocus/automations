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
	const [bugFile, configFile, featureFile] = await Promise.all([
		fs.readFile(path.join(import.meta.dirname, './assets/ISSUE_TEMPLATE/bug_report.yml'), 'utf-8'),
		fs.readFile(path.join(import.meta.dirname, './assets/ISSUE_TEMPLATE/config.yml'), 'utf-8'),
		fs.readFile(path.join(import.meta.dirname, './assets/ISSUE_TEMPLATE/feature_request.yml'), 'utf-8'),
	])

	return {
		bugFile: base64Encode(bugFile),
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

		const issueTemplateSetManual = await octokit.rest.repos
			.getContent({
				owner: 'bitfocus',
				repo: repoName,
				path: '.github/.companion-manual-issue-templates',
			})
			.then(() => true)
			.catch((e) => (e.status === 404 ? false : Promise.reject(e)))
		if (issueTemplateSetManual) {
			console.log(`Skipping ${repoName}: companion-manual-issue-templates flag set`)
		} else {
			// Check if the .github/ISSUE_TEMPLATE folder exists
			const issueTemplateFolderExists = await octokit.rest.repos
				.getContent({
					owner: 'bitfocus',
					repo: repoName,
					path: '.github/ISSUE_TEMPLATE',
				})
				.then(() => true)
				.catch((e) => (e.status === 404 ? false : Promise.reject(e)))
			if (issueTemplateFolderExists) {
				console.log(`Skipping ${repoName}: ISSUE_TEMPLATE folder already exists`)

				await octokit.rest.repos.createOrUpdateFileContents({
					owner: 'bitfocus',
					repo: repoName,
					path: '.github/.companion-manual-issue-templates',
					content: base64Encode('\n'),
					message: 'chore: add manual issue templates marker',
				})
			} else {
				console.log(`Creating ${repoName}: ISSUE_TEMPLATE folder`)

				const files = await targetIssueTemplateContentBase64

				await updateMultipleFiles(repoName, repo.default_branch, {
					'.github/ISSUE_TEMPLATE/bug_report.yml': files.bugFile,
					'.github/ISSUE_TEMPLATE/config.yml': files.configFile,
					'.github/ISSUE_TEMPLATE/feature_request.yml': files.featureFile,
				})
			}
		}
	} catch (e) {
		console.error(`Failed ${repoName}: ${e?.message ?? e?.toString() ?? e}`)
		errors.push(e)
	}
}

console.log('All errors', errors)

async function updateMultipleFiles(repoName, defaultBranch, files) {
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

	// Create blobs for each file
	const blobs = await Promise.all(
		Object.entries(files).map(async ([path, content]) => {
			const { data: blob } = await octokit.rest.git.createBlob({
				owner: 'bitfocus',
				repo: repoName,
				content,
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
		message: 'chore: add issue templates',
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

	console.log(`Updated ${repoName} with ${Object.keys(files).length} files in a single commit`)
}
