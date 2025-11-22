import { Sequelize } from 'sequelize'
import { IPlatformsInfo, PlatformsInfo } from './models-grafana.js'
import { DRY_RUN, runQuery } from './util.js'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

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

async function writeData(stats: any[], type: IPlatformsInfo['type']) {
	const data = translateResults(stats, type)

	if (DRY_RUN) {
		await writeFile(path.join(import.meta.dirname, `../dry-run/platforms-${type}.json`), JSON.stringify(data, null, 2))
	} else {
		await PlatformsInfo.bulkCreate<PlatformsInfo>(data)
	}
}

export async function runPlatforms(db: Sequelize): Promise<void> {
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
