import { QueryTypes, Sequelize } from 'sequelize'

export async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms || 0))
}

export async function runWithRetry(identifier: string, fcn: () => Promise<void>): Promise<void> {
	try {
		await fcn()
	} catch (_e) {
		console.warn(`Query ${identifier} failed. Retrying...`)

		// Sleep in case something is down briefly
		await sleep(30 * 1000)

		// Try and hope it is better
		await fcn()
	}
}

export async function runQuery(
	db: Sequelize,
	identifier: string,
	query: string,
	saveStats: (rows: any[]) => Promise<void>
): Promise<void> {
	await runWithRetry(identifier, async () => {
		const stats = await db.query<any>(query, {
			type: QueryTypes.SELECT,
		})
		await saveStats(stats)
	}).catch((e) => {
		console.error(`${identifier} failed`, e)
	})
}
