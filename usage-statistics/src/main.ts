import { PrismaClient } from './prisma/client.js'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { runUsers } from './users-data.js'
// import { runModules } from './modules-data.js'
import { runPlatforms } from './platforms.js'
import { runPlatformStats } from './platform-stats.js'
import type { AppStore } from './types.js'
import mariadb from 'mariadb'

console.log('hello world')

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
	throw new Error('DATABASE_URL environment variable is required')
}

const sourceUrl = process.env.SOURCE_DATABASE_URL
if (!sourceUrl) {
	throw new Error('SOURCE_DATABASE_URL environment variable is required')
}

const oldSourceUrl = process.env.OLD_SOURCE_DATABASE_URL
if (!oldSourceUrl) {
	throw new Error('OLD_SOURCE_DATABASE_URL environment variable is required')
}

const adapter = new PrismaMariaDb(connectionString)
const prismaDest = new PrismaClient({
	adapter,
})

const srcDb = await mariadb.createConnection(sourceUrl)
const oldDb = await mariadb.createConnection(oldSourceUrl)

const store: AppStore = {
	prismaDest,
	srcDb,
	oldDb,
}

try {
	await Promise.all([
		// Set everything going
		runUsers(store),
		// runModules(store),
		runPlatforms(store),
		runPlatformStats(store),
	])

	console.log('all done!')
} finally {
	await oldDb.end()
	await srcDb.end()
}
