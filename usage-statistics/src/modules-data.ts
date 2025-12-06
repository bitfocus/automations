import { DRY_RUN, runQuery } from './util.js'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AppStore } from './types.js'
import type { CompanionModules, StatsSamplePeriod } from './prisma/client.js'

function formatQuery(interval: string) {
	return `
		SELECT 
			km.module_name as module,
			COUNT(DISTINCT muls.user_id) as users
		FROM KnownModule km
		INNER JOIN ModuleUserLastSeen muls ON km.id = muls.module_id
		WHERE km.module_type = 'CONNECTION'
			AND km.module_version = ''
			AND muls.last_seen >= DATE_SUB(CURRENT_DATE, INTERVAL ${interval})
		GROUP BY km.module_name
	`
}

export async function runModules(store: AppStore): Promise<void> {
	const allModules: any[] = await store.srcDb.query(`
		SELECT module_name as module
		FROM KnownModule
		WHERE module_type = 'CONNECTION'
			AND module_version = ''
		GROUP BY module_name
	`)

	function convertModules(stats: any[], type: StatsSamplePeriod): Omit<CompanionModules, 'id' | 'ts'>[] {
		const statsMap = new Map<string, number>()
		for (const stat of stats) {
			statsMap.set(stat.module, Number(stat.users))
		}

		return allModules
			.filter((m) => !!m.module)
			.map(
				(m) =>
					({
						type,
						module: m.module,
						user_count: statsMap.get(m.module) ?? 0,
					}) satisfies Omit<CompanionModules, 'id' | 'ts'>
			)
	}

	async function writeData(stats: any[], type: StatsSamplePeriod) {
		const data = convertModules(stats, type)

		if (DRY_RUN) {
			await writeFile(path.join(import.meta.dirname, `../dry-run/modules-${type}.json`), JSON.stringify(data, null, 2))
		} else {
			const res = await store.prismaDest.companionModules.createMany({ data })
			console.log(`Inserted ${res.count} records for modules ${type}`)
		}
	}

	await Promise.all([
		runQuery('Modules 30day', async () => {
			const rows = await store.srcDb.query(formatQuery('30 day'))
			await writeData(rows, 'day30' as '30day')
		}),
		runQuery('Modules 7day', async () => {
			const rows = await store.srcDb.query(formatQuery('7 day'))
			await writeData(rows, 'day7' as '7day')
		}),
		runQuery('Modules 1day', async () => {
			const rows = await store.srcDb.query(formatQuery('24 hour'))
			await writeData(rows, 'day1' as '1day')
		}),
	])
}
