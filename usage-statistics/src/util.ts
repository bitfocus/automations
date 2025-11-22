export const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'

export async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms || 0))
}

export async function runWithRetry(identifier: string, fcn: () => Promise<void>): Promise<void> {
	try {
		await fcn()
	} catch (_e) {
		console.warn(`Query ${identifier} failed. Retrying...`, _e)

		// Sleep in case something is down briefly
		await sleep(30 * 1000)

		// Try and hope it is better
		await fcn()
	}
}

export async function runQuery(identifier: string, runFn: () => Promise<void>): Promise<void> {
	const start = performance.now()
	await runWithRetry(identifier, async () => {
		await runFn()
	})
		.catch((e) => {
			console.error(`${identifier} failed`, e)
		})
		.finally(() => {
			const duration = performance.now() - start
			console.log(`${identifier} took ${duration}ms`)
		})
}
