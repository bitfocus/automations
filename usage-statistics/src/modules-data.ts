import { DRY_RUN, runQuery } from './util.js'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AppStore } from './types.js'
import type { CompanionModules, StatsSamplePeriod } from './prisma/client.js'

function formatQuery(interval: string) {
	return `SELECT count(distinct uuid) users, module FROM \`module\` where ts >= date_sub(CURRENT_DATE, interval ${interval}) group by module;`
}

export async function runModules(store: AppStore): Promise<void> {
	const allModules: any[] = await store.oldDb.query('SELECT module FROM `module` group by module;')

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
		runQuery('Platforms 30day', async () => {
			const rows = await store.oldDb.query(formatQuery('30 day'))
			await writeData(rows, '30day')
		}),
		runQuery('Platforms 7day', async () => {
			const rows = await store.oldDb.query(formatQuery('7 day'))
			await writeData(rows, '7day')
		}),
		runQuery('Platforms 1day', async () => {
			const rows = await store.oldDb.query(formatQuery('24 hour'))
			await writeData(rows, '1day')
		}),
	])
}
