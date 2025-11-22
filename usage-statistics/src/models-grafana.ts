import { Sequelize, Model, DataTypes, DataType, ModelAttributeColumnOptions } from 'sequelize'

const mysqlUrl = process.env.DATABASE_URL || ''

if (!mysqlUrl || mysqlUrl.length === 0) {
	throw new Error('DATABASE_URL is required')
}

const sequelize = new Sequelize(mysqlUrl)

export interface IModuleInfo {
	id: number
	type: '1day' | '7day' | '30day'
	module: string
	user_count: number
	ts: Date // recorded
}

export class ModuleInfo extends Model implements IModuleInfo {
	public id!: number
	public type!: '1day' | '7day' | '30day'
	public module!: string
	public user_count!: number
	public ts!: Date // recorded
}

ModuleInfo.init(
	{
		id: {
			type: DataTypes.INTEGER,
			autoIncrement: true,
			primaryKey: true,
		},
		type: {
			type: DataTypes.ENUM,
			values: ['1day', '7day', '30day'],
		},
		module: DataTypes.STRING,
		user_count: DataTypes.INTEGER,
		ts: DataTypes.DATE,
	} satisfies { [field in keyof IModuleInfo]: DataType | ModelAttributeColumnOptions },
	{
		sequelize,
		modelName: 'companion_modules',
		freezeTableName: true,
		createdAt: false,
		updatedAt: false,
		deletedAt: false,
		indexes: [],
	}
)

export interface IUsersInfo {
	id: number
	type: '1day' | '7day' | '30day'
	version: string
	user_count: number
	ts: Date // recorded
}

export class UsersInfo extends Model implements IUsersInfo {
	public id!: number
	public type!: '1day' | '7day' | '30day'
	public version!: string
	public user_count!: number
	public ts!: Date // recorded
}

UsersInfo.init(
	{
		id: {
			type: DataTypes.INTEGER,
			autoIncrement: true,
			primaryKey: true,
		},
		type: {
			type: DataTypes.ENUM,
			values: ['1day', '7day', '30day'],
		},
		version: DataTypes.STRING,
		user_count: DataTypes.INTEGER,
		ts: DataTypes.DATE,
	} satisfies { [field in keyof IUsersInfo]: DataType | ModelAttributeColumnOptions },
	{
		sequelize,
		modelName: 'companion_users',
		freezeTableName: true,
		createdAt: false,
		updatedAt: false,
		deletedAt: false,
		indexes: [],
	}
)

export interface IPlatformsInfo {
	id: number
	type: '1day' | '7day' | '30day'
	platform: string
	arch: string
	user_count: number
	ts: Date // recorded
}
export class PlatformsInfo extends Model implements IPlatformsInfo {
	public id!: number
	public type!: '1day' | '7day' | '30day'
	public platform!: string
	public arch!: string
	public user_count!: number
	public ts!: Date // recorded
}

PlatformsInfo.init(
	{
		id: {
			type: DataTypes.INTEGER,
			autoIncrement: true,
			primaryKey: true,
		},
		type: {
			type: DataTypes.ENUM,
			values: ['1day', '7day', '30day'],
		},
		platform: DataTypes.STRING,
		arch: DataTypes.STRING,
		user_count: DataTypes.INTEGER,
		ts: DataTypes.DATE,
	} satisfies { [field in keyof IPlatformsInfo]: DataType | ModelAttributeColumnOptions },
	{
		sequelize,
		modelName: 'companion_platforms',
		freezeTableName: true,
		createdAt: false,
		updatedAt: false,
		deletedAt: false,
		indexes: [],
	}
)

export interface IPlatformStatsInfo {
	id: number
	type: '1day' | '7day' | '30day'
	platform: string
	release_group: string
	user_count: number
	ts: Date // recorded
}

export class PlatformStatsInfo extends Model implements IPlatformStatsInfo {
	public id!: number
	public type!: '1day' | '7day' | '30day'
	public platform!: string
	public release_group!: string
	public user_count!: number
	public ts!: Date // recorded
}

PlatformStatsInfo.init(
	{
		id: {
			type: DataTypes.INTEGER,
			autoIncrement: true,
			primaryKey: true,
		},
		type: {
			type: DataTypes.ENUM,
			values: ['1day', '7day', '30day'],
		},
		platform: DataTypes.STRING,
		release_group: DataTypes.STRING,
		user_count: DataTypes.INTEGER,
		ts: DataTypes.DATE,
	} satisfies { [field in keyof IPlatformStatsInfo]: DataType | ModelAttributeColumnOptions },
	{
		sequelize,
		modelName: 'companion_platform_stats',
		freezeTableName: true,
		createdAt: false,
		updatedAt: false,
		deletedAt: false,
		indexes: [],
	}
)

export async function initDb2(): Promise<Sequelize> {
	await sequelize.authenticate()
	// await sequelize.sync()

	return sequelize
}
