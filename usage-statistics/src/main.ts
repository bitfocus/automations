import { PrismaClient } from './prisma/client.js'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { runUsers } from './users-data.js'
import { runModules } from './modules-data.js'
import { runModuleVersions } from './module-versions-data.js'
import { runPlatforms } from './platforms.js'
import { runPlatformStats } from './platform-stats.js'
import type { AppStore } from './types.js'
import * as mariadb from 'mariadb'
import { runSurfaceCounts, runSurfaceTotals } from './surfaces.js'
import { runFeatures } from './features.js'
import { DRY_RUN } from './util.js'
import { parseArgs } from 'node:util'

const COLLECTORS: Record<string, (store: AppStore) => Promise<void>> = {
	users: runUsers,
	modules: runModules,
	'module-versions': runModuleVersions,
	platforms: runPlatforms,
	'platform-stats': runPlatformStats,
	'surface-counts': runSurfaceCounts,
	'surface-totals': runSurfaceTotals,
	features: runFeatures,
}

// Usage: main.js [--dry-run] [collector...]
// With no collectors named, all of them are run
const args = parseArgs({
	options: { 'dry-run': { type: 'boolean' } }, // Read by DRY_RUN in util.ts
	allowPositionals: true,
})
const unknownCollectors = args.positionals.filter((name) => !COLLECTORS[name])
if (unknownCollectors.length > 0) {
	throw new Error(
		`Unknown collector(s): ${unknownCollectors.join(', ')}. Valid options: ${Object.keys(COLLECTORS).join(', ')}`
	)
}
const collectorNames = args.positionals.length > 0 ? args.positionals : Object.keys(COLLECTORS)

console.log(`Running ${collectorNames.join(', ')}${DRY_RUN ? ' (dry run)' : ''}`)

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
	throw new Error('DATABASE_URL environment variable is required')
}

const sourceUrl = process.env.SOURCE_DATABASE_URL
if (!sourceUrl) {
	throw new Error('SOURCE_DATABASE_URL environment variable is required')
}

const adapter = new PrismaMariaDb(connectionString)
const prismaDest = new PrismaClient({
	adapter,
})

const srcDb = await mariadb.createConnection(sourceUrl)

const store: AppStore = {
	prismaDest,
	srcDb,
}

try {
	// Set everything going
	await Promise.all(collectorNames.map(async (name) => COLLECTORS[name](store)))

	console.log('all done!')
} finally {
	await srcDb.end()
	await prismaDest.$disconnect()
}
