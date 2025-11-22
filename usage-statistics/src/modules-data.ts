import { QueryTypes } from 'sequelize'
import { DRY_RUN, runQuery } from './util.js'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AppStore } from './types.js'
import type { CompanionModules, StatsSamplePeriod } from './prisma/client.js'

function formatQuery(interval: string) {
	return `SELECT count(distinct uuid) users, module FROM \`module\` where ts >= date_sub(CURRENT_DATE, interval ${interval}) group by module;`
}

export async function runModules(store: AppStore): Promise<void> {
	const allModules: any[] = await store.oldDb.query<any>('SELECT module FROM `module` group by module;', {
		type: QueryTypes.SELECT,
	})

	function convertModules(stats: any[], type: StatsSamplePeriod): Omit<CompanionModules, 'id' | 'ts'>[] {
		const statsMap = new Map<string, number>()
		for (const stat of stats) {
			statsMap.set(stat.module, stat.users)
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
			await store.prismaDest.companionModules.createMany({ data })
		}
	}

	await Promise.all([
		runQuery(store.oldDb, 'Platforms 30day', formatQuery('30 day'), async (stats) => {
			await writeData(stats, '30day')
		}),
		runQuery(store.oldDb, 'Platforms 7day', formatQuery('7 day'), async (stats) => {
			await writeData(stats, '7day')
		}),
		runQuery(store.oldDb, 'Platforms 1day', formatQuery('24 hour'), async (stats) => {
			await writeData(stats, '1day')
		}),
	])
}
