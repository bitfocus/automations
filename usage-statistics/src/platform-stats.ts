import { Sequelize } from 'sequelize'
import { IPlatformStatsInfo, PlatformStatsInfo } from './models-grafana.js'
import { runQuery } from './util.js'

function translateResults(stats: any[], type: IPlatformStatsInfo['type']): Omit<IPlatformStatsInfo, 'id' | 'ts'>[] {
	const groupedStats: Record<string, number> = {}

	for (const { users, os_platform, os_release } of stats) {
		let releaseGroup: string

		if (os_platform === 'linux') {
			// Extract version prefix in the form X.Y for Linux only
			const match = os_release.match(/^(\d+\.\d+)/)
			releaseGroup = match ? match[1] : os_release
		} else {
			// For other platforms, use the full release string
			releaseGroup = os_release
		}

		const key = `${os_platform}:${releaseGroup}`

		if (!groupedStats[key]) {
			groupedStats[key] = 0
		}
		groupedStats[key] += users
	}

	return Object.entries<number>(groupedStats).map(([key, user_count]) => {
		const [platform, release_group] = key.split(':')
		return {
			type,
			platform,
			release_group,
			user_count,
		}
	})
}

function formatQuery(interval: string) {
	return `SELECT COUNT(*) users, os_platform, os_release FROM \`user\` WHERE app_name = 'companion' AND last_seen >= DATE_SUB(CURRENT_DATE, interval ${interval}) GROUP BY os_platform, os_release;`
}

export async function runPlatformStats(db: Sequelize): Promise<void> {
	await Promise.all([
		runQuery(db, 'Platform Stats 30day', formatQuery('30 day'), async (stats) => {
			await PlatformStatsInfo.bulkCreate<PlatformStatsInfo>(translateResults(stats, '30day'))
		}),
		runQuery(db, 'Platform Stats 7day', formatQuery('7 day'), async (stats) => {
			await PlatformStatsInfo.bulkCreate<PlatformStatsInfo>(translateResults(stats, '7day'))
		}),
		runQuery(db, 'Platform Stats 1day', formatQuery('24 hour'), async (stats) => {
			await PlatformStatsInfo.bulkCreate<PlatformStatsInfo>(translateResults(stats, '1day'))
		}),
	])
}
