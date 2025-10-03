import { Sequelize } from 'sequelize'
import { IPlatformsInfo, PlatformsInfo } from './models-grafana.js'
import { runQuery } from './util.js'

function translateResults(stats: any[], type: IPlatformsInfo['type']): Omit<IPlatformsInfo, 'id' | 'ts'>[] {
	return stats.map(({ users, os_platform, os_arch }) => ({
		type,
		platform: os_platform,
		arch: os_arch,
		user_count: users ?? 0,
	}))
}

function formatQuery(interval: string) {
	return `SELECT COUNT(*) users, os_platform, os_arch FROM \`user\` WHERE app_name = 'companion' AND last_seen >= DATE_SUB(CURRENT_DATE, interval ${interval}) GROUP BY os_platform, os_arch;`
}
export async function runPlatforms(db: Sequelize): Promise<void> {
	await Promise.all([
		runQuery(db, 'Platforms 30day', formatQuery('30 day'), async (stats) => {
			await PlatformsInfo.bulkCreate<PlatformsInfo>(translateResults(stats, '30day'))
		}),
		runQuery(db, 'Platforms 7day', formatQuery('7 day'), async (stats) => {
			await PlatformsInfo.bulkCreate<PlatformsInfo>(translateResults(stats, '7day'))
		}),
		runQuery(db, 'Platforms 1day', formatQuery('24 hour'), async (stats) => {
			await PlatformsInfo.bulkCreate<PlatformsInfo>(translateResults(stats, '1day'))
		}),
	])
}
