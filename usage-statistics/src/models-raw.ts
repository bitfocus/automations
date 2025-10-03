import { Sequelize, Model, DataTypes, DataType, ModelAttributeColumnOptions } from 'sequelize'

const mysqlUrl = process.env.MYSQL_URL || ''

if (!mysqlUrl || mysqlUrl.length === 0) {
	throw new Error('MYSQL_URL is required')
}

const sequelize = new Sequelize(mysqlUrl)

export interface IUserModule {
	id: number
	uuid: string
	devices: number
	module: string
	instances: number
	rt: number // uptime
	ts: Date // recorded
}

export class UserModule extends Model implements IUserModule {
	public id!: number
	public uuid!: string
	public devices!: number
	public module!: string
	public instances!: number
	public rt!: number // uptime
	public ts!: Date // recorded
}

UserModule.init(
	{
		id: {
			type: DataTypes.INTEGER,
			autoIncrement: true,
			primaryKey: true,
		},
		uuid: DataTypes.STRING,
		devices: DataTypes.INTEGER,
		module: DataTypes.STRING,
		instances: DataTypes.INTEGER,
		rt: DataTypes.INTEGER,
		ts: DataTypes.DATE,
	} satisfies { [field in keyof IUserModule]: DataType | ModelAttributeColumnOptions },
	{
		sequelize,
		modelName: 'module',
		freezeTableName: true,
		createdAt: false,
		updatedAt: false,
		deletedAt: false,
		indexes: [],
	}
)

export async function initDb(): Promise<Sequelize> {
	await sequelize.authenticate()
	// await sequelize.sync()

	return sequelize
}
