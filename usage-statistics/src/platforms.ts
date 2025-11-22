import { DRY_RUN, runQuery } from './util.js'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AppStore } from './types.js'
import type { CompanionPlatforms, StatsSamplePeriod } from './prisma/client.js'

function translateResults(stats: any[], type: StatsSamplePeriod): Omit<CompanionPlatforms, 'id' | 'ts'>[] {
	return stats.map(({ users, os_platform, os_arch }) => ({
		type,
		platform: os_platform,
		arch: os_arch,
		user_count: Number(users) || 0,
	}))
}

function formatQuery(interval: string) {
	return `SELECT COUNT(*) users, os_platform, os_arch FROM \`user\` WHERE app_name = 'companion' AND last_seen >= DATE_SUB(CURRENT_DATE, interval ${interval}) GROUP BY os_platform, os_arch;`
}

async function writeData(store: AppStore, stats: any[], type: StatsSamplePeriod) {
	const data = translateResults(stats, type)

	if (DRY_RUN) {
		await writeFile(path.join(import.meta.dirname, `../dry-run/platforms-${type}.json`), JSON.stringify(data, null, 2))
	} else {
		await store.prismaDest.companionPlatforms.createMany({ data })
	}
}

export async function runPlatforms(store: AppStore): Promise<void> {
	await Promise.all([
		runQuery(store.oldDb, 'Platforms 30day', formatQuery('30 day'), async (stats) => {
			await writeData(store, stats, '30day')
		}),
		runQuery(store.oldDb, 'Platforms 7day', formatQuery('7 day'), async (stats) => {
			await writeData(store, stats, '7day')
		}),
		runQuery(store.oldDb, 'Platforms 1day', formatQuery('24 hour'), async (stats) => {
			await writeData(store, stats, '1day')
		}),
	])
}
