import type { Sequelize } from 'sequelize'
import type { PrismaClient } from './prisma/client.js'

export interface AppStore {
	prismaDest: PrismaClient
	oldDb: Sequelize
}
