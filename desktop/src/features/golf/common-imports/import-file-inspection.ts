// Port of Field PR #1563 file selection policy; its boundary regressions
// are retained alongside this adapter. Large sources stay in Storage.
import { batchImportLimit } from './api'
import { MAX_PREVIEW_IMPORT_BYTES } from './api'

// Mirrors the Bridge parser's MAX_BRIDGE_CSV_ROWS, excluding the header.
const MAX_PREVIEW_IMPORT_ROWS = 500
const MAX_HEADER_SCAN_ROWS = 25
const HEADER_LOOKAHEAD_ROWS = 5
// Rust str::trim keeps a BOM within a cell; JS trim would discard it.
const trimCell = (value: string) =>
	value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')

export type ImportFilePlan = 'single' | 'size' | 'rows' | 'excel'
export const importFilePlanLabels: Record<ImportFilePlan, string> = {
	single: '通常取込で検証します（500行以内のCSV）。',
	size: '大きいCSVのため、分割して全件を検証します。',
	rows: '500行を超えるCSVのため、分割して全件を検証します。',
	excel: 'Excelは分割して全件を検証します。',
}

type CsvRecord = { line: number; values: string[] }

// Read logical records while preserving physical start lines for header scanning.
function* csvRecords(text: string): Generator<CsvRecord> {
	let quoted = false
	let fieldStart = true
	let value = ''
	let values: string[] = []
	let line = 1
	let startLine = 1
	let recordStarted = false
	for (
		let index = text.startsWith('\uFEFF') ? 1 : 0;
		index < text.length;
		index++
	) {
		const char = text[index]
		if (char === '\n' || (char === '\r' && text[index + 1] !== '\n')) line++
		if (quoted) {
			if (char === '"') {
				if (text[index + 1] === '"') {
					value += '"'
					index++
				} else quoted = false
			} else value += char
			continue
		}
		if (char === '"' && fieldStart) {
			quoted = true
			fieldStart = false
			recordStarted = true
		} else if (char === ',') {
			values.push(trimCell(value))
			value = ''
			fieldStart = true
			recordStarted = true
		} else if (char === '\r' || char === '\n') {
			if (recordStarted) {
				values.push(trimCell(value))
				yield { line: startLine, values }
			}
			if (char === '\r' && text[index + 1] === '\n') {
				index++
				line++
			}
			startLine = line
			value = ''
			values = []
			recordStarted = false
			fieldStart = true
		} else {
			fieldStart = false
			recordStarted = true
			value += char
		}
	}
	if (recordStarted) {
		values.push(trimCell(value))
		yield { line: startLine, values }
	}
}

// Mirrors Bridge's first-25-physical-row scoring and five-record lookahead.
// The server still validates the original file; this only chooses its route.
function detectedHeader(records: CsvRecord[]) {
	let best = -1
	let bestScore = -1
	for (const [index, record] of records.entries()) {
		if (record.line > MAX_HEADER_SCAN_ROWS) break
		const headers = [...record.values]
		while (headers.at(-1) === '') headers.pop()
		if (
			headers.length === 0 ||
			headers.length > 256 ||
			new Set(headers).size !== headers.length ||
			headers.some(
				header =>
					!header ||
					header.length > 512 ||
					[...header].length > 256 ||
					header === '__bridgeSourceRowNumber',
			)
		)
			continue
		const density = (next: CsvRecord | undefined) =>
			Math.min(next?.values.filter(Boolean).length ?? 0, headers.length)
		const score =
			headers.length * 10_000 +
			density(records[index + 1]) * 100 +
			records
				.slice(index + 1, index + 1 + HEADER_LOOKAHEAD_ROWS)
				.reduce((sum, next) => sum + density(next), 0)
		if (score > bestScore) {
			best = index
			bestScore = score
		}
	}
	return best
}

function exceedsPreviewRows(text: string) {
	const records = csvRecords(text)
	const prefix: CsvRecord[] = []
	for (
		let index = 0;
		index < MAX_HEADER_SCAN_ROWS + HEADER_LOOKAHEAD_ROWS;
		index++
	) {
		const record = records.next()
		if (record.done) break
		prefix.push(record.value)
	}
	const header = detectedHeader(prefix)
	if (header < 0) return false
	let rows = prefix
		.slice(header + 1)
		.filter(row => row.values.some(Boolean)).length
	for (const record of records) {
		if (record.values.some(Boolean) && ++rows > MAX_PREVIEW_IMPORT_ROWS)
			return true
	}
	return rows > MAX_PREVIEW_IMPORT_ROWS
}

function readSmallCsv(file: File, signal?: AbortSignal): Promise<string> {
	return new Promise((resolve, reject) => {
		signal?.throwIfAborted()
		const reader = new FileReader()
		const abort = () => reader.abort()
		const cleanup = () => signal?.removeEventListener('abort', abort)
		reader.onload = () => {
			cleanup()
			const bytes = reader.result as ArrayBuffer
			try {
				resolve(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
			} catch {
				try {
					resolve(new TextDecoder('shift_jis', { fatal: true }).decode(bytes))
				} catch {
					reject(
						new Error(
							'CSVの文字コードを読み取れません。UTF-8またはShift_JISで保存してください。',
						),
					)
				}
			}
		}
		reader.onerror = () => {
			cleanup()
			reject(new Error('ファイルを読み込めませんでした。選び直してください。'))
		}
		reader.onabort = () => {
			cleanup()
			reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
		}
		signal?.addEventListener('abort', abort, { once: true })
		reader.readAsArrayBuffer(file)
	})
}

export async function inspectImportFile(
	file: File,
	signal?: AbortSignal,
): Promise<ImportFilePlan> {
	signal?.throwIfAborted()
	if (!/\.(csv|xlsx?)$/iu.test(file.name))
		throw new Error('CSV（.csv）またはExcel（.xls・.xlsx）を選択してください。')
	if (file.size === 0) throw new Error('空のファイルは取り込めません。')
	if (file.size > batchImportLimit(file.name))
		throw new Error('CSVは1 GiB以下、Excelは32 MiB以下で選択してください。')
	// A compressed workbook can contain many rows despite a small file size.
	// Let the bounded server converter handle every Excel file without unpacking
	// ZIP/OLE or loading an Excel parser into the browser.
	if (!/\.csv$/iu.test(file.name)) return 'excel'
	if (file.size > MAX_PREVIEW_IMPORT_BYTES) return 'size'
	const text = await readSmallCsv(file, signal)
	signal?.throwIfAborted()
	return exceedsPreviewRows(text) ? 'rows' : 'single'
}
