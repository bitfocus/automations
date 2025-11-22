import { initDb } from './models-raw.js'
import { initDb2 } from './models-grafana.js'
import { runUsers } from './users-data.js'
import { runModules } from './modules-data.js'
import { runPlatforms } from './platforms.js'
import { runPlatformStats } from './platform-stats.js'

console.log('hello world')

const oldDb = await initDb()
await initDb2()

await Promise.all([
	// Set everything going
	runUsers(oldDb),
	runModules(oldDb),
	runPlatforms(oldDb),
	runPlatformStats(oldDb),
])

console.log('all done!')
