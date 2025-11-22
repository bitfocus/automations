import { initDb } from './models-raw.js'
import { PrismaClient } from './prisma/client.js'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { runUsers } from './users-data.js'
// import { runModules } from './modules-data.js'
import { runPlatforms } from './platforms.js'
import { runPlatformStats } from './platform-stats.js'
import type { AppStore } from './types.js'

console.log('hello world')

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
	throw new Error('DATABASE_URL environment variable is required')
}

const adapter = new PrismaMariaDb(connectionString)
const prismaDest = new PrismaClient({
	adapter,
})

const oldDb = await initDb()

const store: AppStore = {
	prismaDest,
	oldDb,
}

await Promise.all([
	// Set everything going
	runUsers(store),
	// runModules(store),
	runPlatforms(store),
	runPlatformStats(store),
])

console.log('all done!')
