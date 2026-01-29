import { DRY_RUN, runQuery } from './util.js'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AppStore } from './types.js'
import { CompanionPlatforms, StatsSamplePeriod } from './prisma/client.js'

function translateResults(stats: any[], type: StatsSamplePeriod): Omit<CompanionPlatforms, 'id' | 'ts'>[] {
	return stats.map(({ users, os_platform, os_arch }) => ({
		type,
		platform: os_platform,
		arch: os_arch,
		user_count: Number(users) || 0,
	}))
}

function formatQuery(interval: string) {
	return `SELECT COUNT(*) users, os_platform, os_arch FROM \`User\` WHERE app_name = 'companion' AND updatedAt >= DATE_SUB(CURRENT_DATE, interval ${interval}) GROUP BY os_platform, os_arch;`
}

async function writeData(store: AppStore, stats: any[], type: StatsSamplePeriod) {
	const data = translateResults(stats, type)

	if (DRY_RUN) {
		await writeFile(path.join(import.meta.dirname, `../dry-run/platforms-${type}.json`), JSON.stringify(data, null, 2))
	} else {
		const res = await store.prismaDest.companionPlatforms.createMany({ data })
		console.log(`Inserted ${res.count} records for platforms ${type}`)
	}
}

export async function runPlatforms(store: AppStore): Promise<void> {
	await Promise.all([
		runQuery('Platforms 30day', async () => {
			const rows = await store.srcDb.query(formatQuery('30 day'))
			await writeData(store, rows, StatsSamplePeriod.day30)
		}),
		runQuery('Platforms 7day', async () => {
			const rows = await store.srcDb.query(formatQuery('7 day'))
			await writeData(store, rows, StatsSamplePeriod.day7)
		}),
		runQuery('Platforms 1day', async () => {
			const rows = await store.srcDb.query(formatQuery('24 hour'))
			await writeData(store, rows, StatsSamplePeriod.day1)
		}),
	])
}
