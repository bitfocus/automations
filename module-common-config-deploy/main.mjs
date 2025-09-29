import { Octokit } from 'octokit'
import dotenv from 'dotenv'
import PLazy from 'p-lazy'
dotenv.config()

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })

const {
	data: { login },
} = await octokit.rest.users.getAuthenticated()
console.log('Hello, %s', login)

const targetContentBase64 = PLazy.from(async () => {
	const checkManifestExists = await octokit.rest.repos.getContent({
		owner: 'bitfocus',
		repo: 'companion-module-template-ts',
		path: '.github/workflows/companion-module-checks.yaml',
	})
	if (!checkManifestExists || checkManifestExists.status !== 200) {
		throw new Error('Failed to get template workflow')
	}

	const data = checkManifestExists.data.content
	if (!data) throw new Error('Failed to get template workflow')

	return data
})

const errors = []

const allRepos = await octokit.paginate(octokit.rest.repos.listForOrg, {
	org: 'bitfocus',
})
console.log('found %d repos in org', allRepos.length)

for (const repo of allRepos) {
	const repoName = repo.name
	if (!repoName.startsWith('companion-module-')) {
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
				content: await targetContentBase64,
				message: "chore: add 'Companion Module Checks' workflow",
			})
		}
	} catch (e) {
		console.error(`Failed ${repoName}: ${e?.message ?? e?.toString() ?? e}`)
		errors.push(e)
	}
}

console.log('All errors', errors)
