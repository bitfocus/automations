import { Sequelize } from 'sequelize'
import { IUsersInfo, UsersInfo } from './models-grafana.js'
import { DRY_RUN, runQuery } from './util.js'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

function translateResults(stats: any[], type: IUsersInfo['type']): Omit<IUsersInfo, 'id' | 'ts'>[] {
	const regex = /^(\d+).(\d+).(\d+)/
	const stableRegex = /^(.+)\+(\d+)-stable-(.+)/

	// Translate some old release build versions to a unified format
	const aliases: Record<string, string | undefined> = {
		'2.1.0-47823d0-2493': '2.1.0-stable',
		'2.1.2-f4bcaf3-2679': '2.1.2-stable',
		'2.1.3-6b6820cd-2696': '2.1.3-stable',
		'2.1.4-b03d4f0f-2714': '2.1.4-stable',

		'2.2.0+3998-master-ccea40c7': '2.2.0-stable',
		'2.2.0+3998-unknown-ccea40c7': '2.2.0-stable',
		'2.2.0+3998-heads-v2.2.0-ccea40c7': '2.2.0-stable',

		'2.2.1+4443-v2-2.1-98594c92': '2.2.1-stable',
		'2.2.1+4443-unknown-98594c92': '2.2.1-stable',
		'2.2.1+4443-master-98594c92': '2.2.1-stable',

		'2.2.2+4454-v2-2.2-be663609': '2.2.2-stable',
		'2.2.2+4454-unknown-be663609': '2.2.2-stable',
		'2.2.2+4454-page-feedback-be663609': '2.2.2-stable',
		'2.2.2+4454-master-be663609': '2.2.2-stable',

		'2.2.3+4469-v2-2.3-82b174db': '2.2.3-stable',
		'2.2.3+4469-unknown-82b174db': '2.2.3-stable',
		'2.2.3+4469-stable-2.2-82b174db': '2.2.3-stable',
		'2.2.3+4469-master-82b174db': '2.2.3-stable',
		'2.2.3+1-master-82b174d': '2.2.3-stable',

		'2.3.0+4608-v2-3.0-2994a6d0': '2.3.0-stable',
		'2.3.0+4608-unknown-2994a6d0': '2.3.0-stable',
		'2.3.0+4608-master-2994a6d0': '2.3.0-stable',
		'2.3.0+1-master-2994a6d': '2.3.0-stable',

		'2.3.1+4641-v2-3.1-dc01ac7c': '2.3.1-stable',
		'2.3.1+4641-unknown-dc01ac7c': '2.3.1-stable',
		'2.3.1+4641-master-dc01ac7c': '2.3.1-stable',
		'2.3.1+1-unknown-dc01ac7': '2.3.1-stable',
		'2.3.1+1-master-dc01ac7c': '2.3.1-stable',
		'2.3.1+1-master-dc01ac7': '2.3.1-stable',

		'2.4.0+4877-v2-4.0-cd0b68c6': '2.4.0-stable',
		'2.4.0+4877-unknown-cd0b68c6': '2.4.0-stable',
		'2.4.0+4877-stable-2.4-cd0b68c6': '2.4.0-stable',
		'2.4.0+4877-master-cd0b68c6': '2.4.0-stable',
		'2.4.0+1-unknown-cd0b68c': '2.4.0-stable',

		'2.4.1+4898-v2-4.1-9646192a': '2.4.1-stable',
		'2.4.1+4898-unknown-9646192a': '2.4.1-stable',
		'2.4.1+4898-stable-2.4-9646192a': '2.4.1-stable',
		'2.4.1+4898-master-9646192a': '2.4.1-stable',
		'2.4.1+4898-heads-v2.4.1-9646192a': '2.4.1-stable',
		'2.4.1+4898-branch-v2.4.1-9646192a': '2.4.1-stable',
		'2.4.1+1-unknown-9646192': '2.4.1-stable',

		'2.4.2+4911-v2-4.2-fcb5a863': '2.4.2-stable',
		'2.4.2+4911-unknown-fcb5a863': '2.4.2-stable',
		'2.4.2+4911-master-fcb5a863': '2.4.2-stable',
		'2.4.2+4911-stable-2.4-fcb5a863': '2.4.2-stable',
		'2.4.2+4911-unknown-fcb5a8634': '2.4.2-stable',

		'3.0.0-rc1+5909-v3-0.0-rc1-725c3583': '3.0.0-rc1',
	}

	const sums: Record<string, number | undefined> = {}

	for (const { users, app_build } of stats) {
		let id = aliases[app_build]

		if (!id) {
			const match = app_build.match(stableRegex)
			if (
				match &&
				(match[1].startsWith('3.') ||
					match[1].startsWith('4.') ||
					match[1].startsWith('5.') ||
					match[1].startsWith('6.'))
			) {
				id = match[1]

				// If not a pre-release, append stable suffix
				if (id && id.indexOf('-') === -1) {
					id += '-stable'
				}
			}
		}

		if (!id) {
			const match = app_build.match(regex)
			if (match) {
				id = match[0]
			}
		}

		// const indexPlus = app_build.indexOf('+')
		// if (indexPlus != -1) {
		// 	id = app_build.slice(0, indexPlus)
		// }

		if (!id) id = 'other'

		if (id) {
			if (!sums[id]) sums[id] = 0
			sums[id] += users
		} else {
			console.log(users, app_build)
		}
	}

	return Object.entries<number | undefined>(sums).map(([version, user_count]) => ({
		type,
		version,
		user_count: user_count ?? 0,
	}))
}

function formatQuery(interval: string) {
	return `SELECT COUNT(*) users, app_build FROM \`user\` WHERE app_name = 'companion' AND last_seen >= DATE_SUB(CURRENT_DATE, interval ${interval}) GROUP BY app_build;`
}

async function writeData(stats: any[], type: IUsersInfo['type']) {
	const data = translateResults(stats, type)

	if (DRY_RUN) {
		await writeFile(path.join(import.meta.dirname, `../dry-run/users-${type}.json`), JSON.stringify(data, null, 2))
	} else {
		await UsersInfo.bulkCreate<UsersInfo>(data)
	}
}

export async function runUsers(db: Sequelize): Promise<void> {
	await Promise.all([
		runQuery(db, 'Users 30day', formatQuery('30 day'), async (stats) => {
			await writeData(stats, '30day')
		}),
		runQuery(db, 'Users 7day', formatQuery('7 day'), async (stats) => {
			await writeData(stats, '7day')
		}),
		runQuery(db, 'Users 1day', formatQuery('24 hour'), async (stats) => {
			await writeData(stats, '1day')
		}),
	])
}
