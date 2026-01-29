import { DRY_RUN, runQuery } from './util.js'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AppStore } from './types.js'
import { CompanionSurfaceDailyCounts, CompanionSurfaceTotalSeen, StatsSamplePeriod } from './prisma/client.js'

export async function runSurfaceCounts(store: AppStore): Promise<void> {
	async function writeData(stats: any[], type: StatsSamplePeriod) {
		const data = stats.map(
			(m) =>
				({
					type,
					description: m.surface_description?.slice(0, 128), // Trim to fit DB field
					count: Number(m.surfaces) || 0,
				}) satisfies Omit<CompanionSurfaceDailyCounts, 'id' | 'ts'>
		)

		if (DRY_RUN) {
			await writeFile(
				path.join(import.meta.dirname, `../dry-run/surface-daily-counts-${type}.json`),
				JSON.stringify(data, null, 2)
			)
		} else {
			const res = await store.prismaDest.companionSurfaceDailyCounts.createMany({ data })
			console.log(`Inserted ${res.count} records for surface daily counts ${type}`)
		}
	}

	function formatQuery(interval: string) {
		return `SELECT count(distinct id) surfaces, surface_description FROM \`SurfaceUserLastSeen\` where last_seen >= date_sub(CURRENT_DATE, interval ${interval}) group by surface_description;`
	}

	await Promise.all([
		runQuery('Surfaces daily 30day', async () => {
			const rows = await store.srcDb.query(formatQuery('30 day'))
			await writeData(rows, StatsSamplePeriod.day30)
		}),
		runQuery('Surfaces daily 7day', async () => {
			const rows = await store.srcDb.query(formatQuery('7 day'))
			await writeData(rows, StatsSamplePeriod.day7)
		}),
		runQuery('Surfaces daily 1day', async () => {
			const rows = await store.srcDb.query(formatQuery('24 hour'))
			await writeData(rows, StatsSamplePeriod.day1)
		}),
	])
}

export async function runSurfaceTotals(store: AppStore): Promise<void> {
	async function writeData(stats: any[]) {
		const data = stats.map(
			(m) =>
				({
					description: m.surface_description?.slice(0, 128), // Trim to fit DB field
					count: Number(m.surfaces) || 0,
				}) satisfies Omit<CompanionSurfaceTotalSeen, 'id' | 'ts'>
		)

		if (DRY_RUN) {
			await writeFile(
				path.join(import.meta.dirname, `../dry-run/surface-total-counts.json`),
				JSON.stringify(data, null, 2)
			)
		} else {
			const res = await store.prismaDest.companionSurfaceTotalSeen.createMany({ data })
			console.log(`Inserted ${res.count} records for surface totals`)
		}
	}

	const query = `SELECT count(distinct id) surfaces, surface_description FROM \`SurfaceUserLastSeen\` group by surface_description;`

	await runQuery('Surfaces total seen', async () => {
		const rows = await store.srcDb.query(query)
		await writeData(rows)
	})
}
