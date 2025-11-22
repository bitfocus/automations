import { DRY_RUN, runQuery } from './util.js'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AppStore } from './types.js'
import type { CompanionPlatformStats, StatsSamplePeriod } from './prisma/client.js'

function translateResults(stats: any[], type: StatsSamplePeriod): Omit<CompanionPlatformStats, 'id' | 'ts'>[] {
	const groupedStats: Record<string, number> = {}

	for (const { users, os_platform, os_release } of stats) {
		let releaseGroup: string

		if (os_platform === 'linux') {
			// Extract version prefix in the form X.Y for Linux only
			const match = os_release.match(/^(\d+\.\d+)/)
			releaseGroup = match ? match[1] : os_release
		} else {
			// For other platforms, use the full release string
			releaseGroup = os_release
		}

		const key = `${os_platform}:${releaseGroup}`

		if (!groupedStats[key]) {
			groupedStats[key] = 0
		}
		groupedStats[key] += Number(users)
	}

	return Object.entries<number>(groupedStats).map(([key, user_count]) => {
		const [platform, release_group] = key.split(':')
		return {
			type,
			platform,
			release_group,
			user_count,
		}
	})
}

function formatQuery(interval: string) {
	return `SELECT COUNT(*) users, os_platform, os_release FROM \`User\` WHERE app_name = 'companion' AND updatedAt >= DATE_SUB(CURRENT_DATE, interval ${interval}) GROUP BY os_platform, os_release;`
}

async function writeData(store: AppStore, stats: any[], type: StatsSamplePeriod) {
	const data = translateResults(stats, type)

	if (DRY_RUN) {
		await writeFile(
			path.join(import.meta.dirname, `../dry-run/platform-stats-${type}.json`),
			JSON.stringify(data, null, 2)
		)
	} else {
		const res = await store.prismaDest.companionPlatformStats.createMany({ data })
		console.log(`Inserted ${res.count} records for platform stats ${type}`)
	}
}

export async function runPlatformStats(store: AppStore): Promise<void> {
	await Promise.all([
		runQuery('Platform Stats 30day', async () => {
			const rows = await store.srcDb.query(formatQuery('30 day'))
			await writeData(store, rows, '30day')
		}),
		runQuery('Platform Stats 7day', async () => {
			const rows = await store.srcDb.query(formatQuery('7 day'))
			await writeData(store, rows, '7day')
		}),
		runQuery('Platform Stats 1day', async () => {
			const rows = await store.srcDb.query(formatQuery('24 hour'))
			await writeData(store, rows, '1day')
		}),
	])
}
