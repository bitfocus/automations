import { Octokit, App } from 'octokit'
import dotenv from 'dotenv'
import semver from 'semver'
dotenv.config()

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })

const {
	data: { login },
} = await octokit.rest.users.getAuthenticated()
console.log('Hello, %s', login)

const prs = await octokit.rest.search.issuesAndPullRequests({
	q: 'is:pr is:open archived:false sort:updated-desc user:bitfocus author:app/dependabot',
	per_page: 100,
})

// console.log('issues', prs)
for (const pr of prs.data.items) {
	try {
		if (pr.user.login !== 'dependabot[bot]') continue

		const parts = pr.repository_url.split('/')
		const name = parts[parts.length - 1]
		if (!name.startsWith('companion-module-')) continue

		// skip companion-module PRs
		if (pr.title.toLowerCase().includes('@companion-module/')) continue

		const match = /bump (.+) (\d.+) to (\d.+)/i.exec(pr.title.toLocaleLowerCase())
		if (!match) continue

		const vFrom = semver.parse(match[2])
		const vTo = semver.parse(match[3])
		if (
			vFrom &&
			vTo &&
			((vFrom.major === vTo.major && vFrom.major !== 0) ||
				(vFrom.major === 0 && vTo.major === 0 && vFrom.minor === vTo.minor))
		) {
			console.log(`Merging PR '${pr.title}' from ${name} (${pr.html_url}) `)
			try {
				// try a squash
				await octokit.rest.pulls.merge({
					owner: 'bitfocus',
					repo: name,
					pull_number: pr.number,
					merge_method: 'squash',
				})
			} catch (e) {
				// retry with a merge commit
				await octokit.rest.pulls.merge({
					owner: 'bitfocus',
					repo: name,
					pull_number: pr.number,
					merge_method: 'merge',
				})
			}
		}
	} catch (e) {
		console.log(`${pr.html_url} Merge failed: ${e}`)
		// console.log(pr)
	}
}
