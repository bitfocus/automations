import { Octokit, App } from 'octokit'

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })

// The github action to merge dependabot updates for, eg "actions/checkout".
// Can be overridden with the TARGET_ACTION env var. Matching is case-insensitive.
const TARGET_ACTION = (process.env.TARGET_ACTION || 'actions/checkout').toLowerCase()

const {
	data: { login },
} = await octokit.rest.users.getAuthenticated()
console.log('Hello, %s', login)
console.log('Merging dependabot PRs for action: %s', TARGET_ACTION)

const prs = await octokit.rest.search.issuesAndPullRequests({
	q: `is:pr is:open archived:false sort:updated-desc user:bitfocus author:app/dependabot ${TARGET_ACTION}`,
	per_page: 100,
	advanced_search: 'true',
})

for (const pr of prs.data.items) {
	try {
		if (pr.user.login !== 'dependabot[bot]') continue

		const parts = pr.repository_url.split('/')
		const name = parts[parts.length - 1]

		// Dependabot github-action bumps look like "chore(deps): bump actions/checkout from 4 to 5"
		const match = /bump (\S+) from /i.exec(pr.title.toLocaleLowerCase())
		if (!match) continue

		// Only merge PRs for the specific action we care about
		if (match[1] !== TARGET_ACTION) continue

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
	} catch (e) {
		console.log(`${pr.html_url} Merge failed: ${e}`)
	}
}
