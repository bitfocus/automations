import { DRY_RUN, runQuery } from './util.js'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AppStore } from './types.js'
import { CompanionModuleVersions, StatsSamplePeriod } from './prisma/client.js'

function formatQuery(interval: string) {
	return `
		SELECT
			km.module_name as module,
			km.module_version as version,
			COUNT(DISTINCT muls.user_id) as users
		FROM KnownModule km
		INNER JOIN ModuleUserLastSeen muls ON km.id = muls.module_id
		WHERE km.module_type = 'CONNECTION'
			AND km.module_version != ''
			AND muls.last_seen >= DATE_SUB(CURRENT_DATE, INTERVAL ${interval})
		GROUP BY km.module_name, km.module_version
	`
}

function convertModuleVersions(stats: any[], type: StatsSamplePeriod): Omit<CompanionModuleVersions, 'id' | 'ts'>[] {
	return stats
		.filter((s) => !!s.module && !!s.version)
		.map(
			(s) =>
				({
					type,
					module: s.module,
					version: s.version,
					user_count: Number(s.users) || 0,
				}) satisfies Omit<CompanionModuleVersions, 'id' | 'ts'>
		)
}

async function writeData(store: AppStore, stats: any[], type: StatsSamplePeriod) {
	const data = convertModuleVersions(stats, type)

	if (DRY_RUN) {
		await writeFile(
			path.join(import.meta.dirname, `../dry-run/module-versions-${type}.json`),
			JSON.stringify(data, null, 2)
		)
	} else {
		const res = await store.prismaDest.companionModuleVersions.createMany({ data })
		console.log(`Inserted ${res.count} records for module versions ${type}`)
	}
}

export async function runModuleVersions(store: AppStore): Promise<void> {
	await Promise.all([
		runQuery('Module Versions 30day', async () => {
			const rows = await store.srcDb.query(formatQuery('30 day'))
			await writeData(store, rows, StatsSamplePeriod.day30)
		}),
		runQuery('Module Versions 7day', async () => {
			const rows = await store.srcDb.query(formatQuery('7 day'))
			await writeData(store, rows, StatsSamplePeriod.day7)
		}),
		runQuery('Module Versions 1day', async () => {
			const rows = await store.srcDb.query(formatQuery('24 hour'))
			await writeData(store, rows, StatsSamplePeriod.day1)
		}),
	])
}
