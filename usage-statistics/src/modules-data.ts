import { Sequelize, QueryTypes } from 'sequelize'
import { IModuleInfo, ModuleInfo } from './models-grafana.js'
import { runQuery } from './util.js'

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

	await Promise.all([
		runQuery(db, 'Platforms 30day', formatQuery('30 day'), async (stats) => {
			await ModuleInfo.bulkCreate<ModuleInfo>(convertModules(stats, '30day'))
		}),
		runQuery(db, 'Platforms 7day', formatQuery('7 day'), async (stats) => {
			await ModuleInfo.bulkCreate<ModuleInfo>(convertModules(stats, '7day'))
		}),
		runQuery(db, 'Platforms 1day', formatQuery('24 hour'), async (stats) => {
			await ModuleInfo.bulkCreate<ModuleInfo>(convertModules(stats, '1day'))
		}),
	])
}
