// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { inspectImportFile } from './import-file-inspection'

afterEach(() => vi.restoreAllMocks())
const csv = (text: string) => new File([text], '取引先.CSV')

it.each([500, 501])(
	'detects a Shift_JIS CSV header before counting %i data rows',
	async count => {
		// 名前,電話番号 followed by ASCII-only records in the same encoding.
		const header = Uint8Array.from([
			150, 188, 145, 79, 44, 147, 100, 152, 98, 148, 212, 141, 134, 10,
		])
		const body = new TextEncoder().encode('Alice,09012340000\n'.repeat(count))
		const file = new File([header, body], '取引先.csv')
		expect(await inspectImportFile(file)).toBe(count > 500 ? 'rows' : 'single')
	},
)

it('uses ordinary preview through 500 data rows and batch from row 501, excluding the header', async () => {
	for (const count of [1, 500, 501, 601]) {
		const file = csv(
			`id,name\n${Array.from({ length: count }, (_, index) => `,取引先${index}`).join('\n')}`,
		)
		expect(await inspectImportFile(file)).toBe(count > 500 ? 'rows' : 'single')
	}
})
it.each([500, 501])(
	'counts %i data rows after a title and the automatically detected CSV header',
	async count => {
		const rows = Array.from(
			{ length: count },
			(_, index) => `,取引先${index},09012340000`,
		)
		for (const preamble of [
			'取引先一覧\n',
			'"取引先\n一覧"\r\n\r\n',
			`${'\n'.repeat(23)}取引先一覧\n`,
		]) {
			const file = csv(`${preamble}id,name,phone\n${rows.join('\n')}`)
			expect(await inspectImportFile(file)).toBe(
				count > 500 ? 'rows' : 'single',
			)
		}
	},
)
it('counts quoted multiline and escaped quotes as one record, with BOM, CRLF and blank rows', async () => {
	const row = ',"取引先\r\n複数行\r\n""引用""",'
	const blanks = '\r\n,,\r\n," \t ",\r\n'
	const source = `\uFEFFid,name,memo\r\n${Array.from({ length: 500 }, () => row).join(blanks)}`
	expect(await inspectImportFile(csv(source))).toBe('single')
	expect(await inspectImportFile(csv(`${source}\r\n${row}`))).toBe('rows')
})
it('counts a literal quote as data but ignores empty quoted cells and whitespace-only rows', async () => {
	const source = `name\n${'""\n \t\n'.repeat(600)}${'""""\n'.repeat(500)}`
	expect(await inspectImportFile(csv(source))).toBe('single')
	expect(await inspectImportFile(csv(`${source}""""`))).toBe('rows')
})
it('keeps a BOM inside a data cell as nonempty, matching the server row limit', async () => {
	const source = `\uFEFFname\n${'取引先\n'.repeat(500)}"\uFEFF"`
	expect(await inspectImportFile(csv(source))).toBe('rows')
})
it('does not read CSV beyond 3 MB or unpack either Excel format in the browser', async () => {
	const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer')
	for (const name of ['source.csv', 'source.xls', 'source.xlsx']) {
		const file = {
			name,
			size: name.endsWith('.csv') ? 3_000_001 : 16_000,
		} as File
		expect(await inspectImportFile(file)).toBe(
			name.endsWith('.csv') ? 'size' : 'excel',
		)
	}
	expect(read).not.toHaveBeenCalled()
})
it('still inspects the exact 3 MB boundary without classifying a long quoted cell as many rows', async () => {
	const source = `name\n"${'a'.repeat(3_000_000 - 7)}"`
	const file = csv(source)
	expect(file.size).toBe(3_000_000)
	expect(await inspectImportFile(file)).toBe('single')
})
it.each([
	['file.txt', 10, 'CSV（.csv）またはExcel'],
	['empty.csv', 0, '空のファイル'],
	['huge.csv', 1024 * 1024 * 1024 + 1, 'CSVは1 GiB以下'],
	['huge.xlsx', 32 * 1024 * 1024 + 1, 'Excelは32 MiB以下'],
])(
	'rejects %s before reading or starting an upload',
	async (name, size, message) => {
		const read = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer')
		await expect(inspectImportFile({ name, size } as File)).rejects.toThrow(
			message,
		)
		expect(read).not.toHaveBeenCalled()
	},
)
it('stops an active small-file read when the selection is cancelled', async () => {
	const controller = new AbortController()
	const pending = inspectImportFile(csv('name\n取引先\n'), controller.signal)
	controller.abort()
	await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
	await expect(
		inspectImportFile(csv('name\n'), controller.signal),
	).rejects.toMatchObject({ name: 'AbortError' })
})
