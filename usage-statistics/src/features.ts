import { DRY_RUN, runQuery } from './util.js'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AppStore } from './types.js'
import { CompanionFeatureNumeric, CompanionFeatureValues, StatsSamplePeriod } from './prisma/client.js'

/**
 * Generic scraping of the CompanionFeatures table.
 * Every column is discovered at runtime, so new features reported by Companion get collected without changes here.
 */

const SOURCE_TABLE = 'CompanionFeatures'

// Columns which are not features
const IGNORED_COLUMNS = new Set(['id', 'user_id', 'createdAt', 'updatedAt'])
const IGNORED_PREFIXES = ['app_', 'os_']

// Maximum distinct values to keep for a string column, the rest are grouped as 'other'
const MAX_CATEGORICAL_VALUES = 30

// Users who didn't report a value are split into these, per version group:
// 'unsupported' when nobody in the group reports the feature (their version predates it), otherwise 'unknown'
const VALUE_NULL = 'null'
const VALUE_UNKNOWN = 'unknown'
const VALUE_UNSUPPORTED = 'unsupported'

type FeatureKind = 'boolean' | 'categorical' | 'numeric'

interface FeatureOverride {
	exclude?: boolean
	kind?: FeatureKind
	/** 'exact' records every numeric value instead of bucketing */
	buckets?: 'exact'
}

// Optional tweaks for specific columns. Columns not listed here use the default behaviour
const FEATURE_OVERRIDES: Record<string, FeatureOverride | undefined> = {
	gridMinCol: { buckets: 'exact' },
	gridMaxCol: { buckets: 'exact' },
	gridMinRow: { buckets: 'exact' },
	gridMaxRow: { buckets: 'exact' },
}

interface FeatureColumn {
	name: string
	kind: FeatureKind
	exact: boolean
}

const NUMERIC_BUCKETS: [min: number, label: string][] = [
	[1000, '1000+'],
	[500, '500-999'],
	[250, '250-499'],
	[100, '100-249'],
	[50, '50-99'],
	[25, '25-49'],
	[10, '10-24'],
	[5, '5-9'],
	[2, '2-4'],
	[1, '1'],
	[0, '0'],
]

function bucketNumber(value: number): string {
	for (const [min, label] of NUMERIC_BUCKETS) {
		if (value >= min) return label
	}
	return '<0'
}

function versionGroup(appVersion: string | null | undefined): string {
	const match = /^(\d+)\.(\d+)/.exec(appVersion ?? '')
	return match ? `${match[1]}.${match[2]}` : 'other'
}

function classifyColumn(dataType: string, columnType: string): FeatureKind | null {
	if (columnType === 'tinyint(1)') return 'boolean'
	switch (dataType) {
		case 'varchar':
		case 'char':
		case 'enum':
		case 'text':
			return 'categorical'
		case 'tinyint':
		case 'smallint':
		case 'mediumint':
		case 'int':
		case 'bigint':
			return 'numeric'
		default:
			return null
	}
}

async function discoverColumns(store: AppStore): Promise<FeatureColumn[]> {
	const rows: any[] = await store.srcDb.query(
		`SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
		[SOURCE_TABLE]
	)

	const columns: FeatureColumn[] = []
	for (const row of rows) {
		const name: string = row.COLUMN_NAME
		if (IGNORED_COLUMNS.has(name) || IGNORED_PREFIXES.some((p) => name.startsWith(p))) continue

		const override = FEATURE_OVERRIDES[name]
		if (override?.exclude) continue

		const kind =
			override?.kind ?? classifyColumn(String(row.DATA_TYPE).toLowerCase(), String(row.COLUMN_TYPE).toLowerCase())
		if (!kind) {
			console.warn(`Features: skipping column ${name} of unsupported type ${row.COLUMN_TYPE}`)
			continue
		}

		columns.push({ name, kind, exact: override?.buckets === 'exact' })
	}
	return columns
}

type FeatureValueRow = Omit<CompanionFeatureValues, 'id' | 'ts'>
type FeatureNumericRow = Omit<CompanionFeatureNumeric, 'id' | 'ts'>

/** Nearest-rank percentile of a sorted array */
function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
	return sorted[index]
}

function formatValue(column: FeatureColumn, raw: unknown): string {
	if (raw === null || raw === undefined) return VALUE_NULL
	switch (column.kind) {
		case 'boolean':
			return Number(raw) ? 'true' : 'false'
		case 'numeric':
			return column.exact ? String(Number(raw)) : bucketNumber(Number(raw))
		case 'categorical':
			return String(raw as string | number).slice(0, 64)
	}
}

function summariseNumbers(
	column: FeatureColumn,
	rows: any[]
): Omit<FeatureNumericRow, 'type' | 'version_group' | 'feature'> | null {
	const numbers: number[] = []
	for (const row of rows) {
		const raw = row[column.name]
		if (raw !== null && raw !== undefined) numbers.push(Number(raw))
	}
	if (numbers.length === 0) return null

	numbers.sort((a, b) => a - b)
	const sum = numbers.reduce((acc, v) => acc + v, 0)
	return {
		users: numbers.length,
		nonzero_users: numbers.filter((v) => v !== 0).length,
		sum: BigInt(sum),
		mean: sum / numbers.length,
		p50: percentile(numbers, 50),
		p90: percentile(numbers, 90),
		p99: percentile(numbers, 99),
		max: numbers[numbers.length - 1],
	}
}

function aggregate(
	columns: FeatureColumn[],
	rows: any[],
	type: StatsSamplePeriod
): { values: FeatureValueRow[]; numeric: FeatureNumericRow[] } {
	const values: FeatureValueRow[] = []
	const numeric: FeatureNumericRow[] = []

	// Group the users by version
	const groups = new Map<string, any[]>()
	for (const row of rows) {
		const group = versionGroup(row.app_version)
		let groupRows = groups.get(group)
		if (!groupRows) groups.set(group, (groupRows = []))
		groupRows.push(row)
	}

	for (const column of columns) {
		// Limit string columns to the most popular values overall, in case one turns out to be free text
		let allowedValues: Set<string> | undefined
		if (column.kind === 'categorical') {
			const counts = new Map<string, number>()
			for (const row of rows) {
				const value = formatValue(column, row[column.name])
				counts.set(value, (counts.get(value) ?? 0) + 1)
			}
			allowedValues = new Set(
				[...counts.entries()]
					.sort((a, b) => b[1] - a[1])
					.slice(0, MAX_CATEGORICAL_VALUES)
					.map((e) => e[0])
			)
			allowedValues.add(VALUE_NULL)
		}

		// The synthetic 'all' group is the sum of the version groups, so that it carries their unknown/unsupported split
		const allCounts = new Map<string, number>()

		for (const [group, groupRows] of groups) {
			const counts = new Map<string, number>()
			for (const row of groupRows) {
				let value = formatValue(column, row[column.name])
				if (allowedValues && !allowedValues.has(value)) value = 'other'
				counts.set(value, (counts.get(value) ?? 0) + 1)
			}

			// If nobody in this version group reports the feature, assume the version is too old to support it
			const nullCount = counts.get(VALUE_NULL)
			if (nullCount !== undefined) {
				counts.delete(VALUE_NULL)
				counts.set(counts.size === 0 ? VALUE_UNSUPPORTED : VALUE_UNKNOWN, nullCount)
			}

			for (const [value, user_count] of counts) {
				values.push({ type, version_group: group, feature: column.name, value, user_count })
				allCounts.set(value, (allCounts.get(value) ?? 0) + user_count)
			}
		}

		for (const [value, user_count] of allCounts) {
			values.push({ type, version_group: 'all', feature: column.name, value, user_count })
		}

		if (column.kind === 'numeric') {
			for (const [group, groupRows] of [['all', rows] as const, ...groups]) {
				const summary = summariseNumbers(column, groupRows)
				if (summary) numeric.push({ type, version_group: group, feature: column.name, ...summary })
			}
		}
	}

	return { values, numeric }
}

async function writeData(store: AppStore, columns: FeatureColumn[], rows: any[], type: StatsSamplePeriod) {
	const { values, numeric } = aggregate(columns, rows, type)

	if (DRY_RUN) {
		await writeFile(
			path.join(import.meta.dirname, `../dry-run/features-${type}.json`),
			JSON.stringify({ columns, values, numeric }, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2)
		)
	} else {
		const res = await store.prismaDest.companionFeatureValues.createMany({ data: values })
		console.log(`Inserted ${res.count} records for feature values ${type}`)
		const res2 = await store.prismaDest.companionFeatureNumeric.createMany({ data: numeric })
		console.log(`Inserted ${res2.count} records for feature numeric ${type}`)
	}
}

export async function runFeatures(store: AppStore): Promise<void> {
	await runQuery('Features', async () => {
		const columns = await discoverColumns(store)
		if (columns.length === 0) throw new Error(`No feature columns found in ${SOURCE_TABLE}`)

		// Fetch the 30 day set once, and flag which rows also fall into the shorter periods.
		// The periods are computed in sql to match the other collectors
		const columnList = columns.map((c) => `\`${c.name.replaceAll('`', '``')}\``).join(', ')
		const rows: any[] = await store.srcDb.query(`
			SELECT
				app_version,
				updatedAt >= DATE_SUB(CURRENT_DATE, INTERVAL 7 day) AS in_day7,
				updatedAt >= DATE_SUB(CURRENT_DATE, INTERVAL 24 hour) AS in_day1,
				${columnList}
			FROM \`${SOURCE_TABLE}\`
			WHERE updatedAt >= DATE_SUB(CURRENT_DATE, INTERVAL 30 day)
		`)

		await writeData(store, columns, rows, StatsSamplePeriod.day30)
		await writeData(
			store,
			columns,
			rows.filter((r) => Number(r.in_day7)),
			StatsSamplePeriod.day7
		)
		await writeData(
			store,
			columns,
			rows.filter((r) => Number(r.in_day1)),
			StatsSamplePeriod.day1
		)
	})
}
