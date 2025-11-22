import { Sequelize, QueryTypes } from 'sequelize'
import { IModuleInfo, ModuleInfo } from './models-grafana.js'
import { DRY_RUN, runQuery } from './util.js'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

function formatQuery(interval: string) {
	return `SELECT count(distinct uuid) users, module FROM \`module\` where ts >= date_sub(CURRENT_DATE, interval ${interval}) group by module;`
}

export async function runModules(db: Sequelize): Promise<void> {
	const allModules: any[] = await db.query<any>('SELECT module FROM `module` group by module;', {
		type: QueryTypes.SELECT,
	})

	function convertModules(stats: any[], type: IModuleInfo['type']): Omit<IModuleInfo, 'id' | 'ts'>[] {
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
					}) satisfies Omit<IModuleInfo, 'id' | 'ts'>
			)
	}

	async function writeData(stats: any[], type: IModuleInfo['type']) {
		const data = convertModules(stats, type)

		if (DRY_RUN) {
			await writeFile(path.join(import.meta.dirname, `../dry-run/modules-${type}.json`), JSON.stringify(data, null, 2))
		} else {
			await ModuleInfo.bulkCreate<ModuleInfo>(data)
		}
	}

	await Promise.all([
		runQuery(db, 'Platforms 30day', formatQuery('30 day'), async (stats) => {
			await writeData(stats, '30day')
		}),
		runQuery(db, 'Platforms 7day', formatQuery('7 day'), async (stats) => {
			await writeData(stats, '7day')
		}),
		runQuery(db, 'Platforms 1day', formatQuery('24 hour'), async (stats) => {
			await writeData(stats, '1day')
		}),
	])
}
