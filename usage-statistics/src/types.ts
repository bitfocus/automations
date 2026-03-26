import type { PrismaClient } from './prisma/client.js'
import type * as mariadb from 'mariadb'

export interface AppStore {
	prismaDest: PrismaClient
	srcDb: mariadb.Connection
}
