import type { PrismaClient } from './prisma/client.js'
import type mariadb from 'mariadb'

export interface AppStore {
	prismaDest: PrismaClient
	srcDb: mariadb.Connection
	oldDb: mariadb.Connection
}
