import { createHash } from 'node:crypto'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { expect, test, type Page, type Route } from '@playwright/test'
import type { ImportJob } from '../src/features/golf/common-imports/api'
import { documentImport as ja } from '../src/i18n/locales/ja/documentImport'
import { documentImport as en } from '../src/i18n/locales/en/documentImport'
import { documentImport as plain } from '../src/i18n/locales/ja-plain/documentImport'

const root = '/v1/course/data-imports'
const entry = '/golf/data-imports/courseboardReservationReports/documents'
async function fixture(page: Page, loseResponses = false) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  pdf.addPage([600, 400]).drawText('East | 10/8 | AM | 2 | 1', { x: 30, y: 300, size: 18, font })
  const bytes = Buffer.from(await pdf.save())
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const source = { index: 0, contentType: 'application/pdf', size: bytes.length, sha256, rotation: 0 as 0 | 90 | 180 | 270 }
  const raw = { _source_index: 0, _source_page: 1, _source_row: 1, cells: JSON.stringify({ facilityName: 'East', date: '10/8', dayPart: 'AM', groupCount: '2', caddieAttachedGroupCount: '1' }) }
  let job: ImportJob | undefined
  const keys: string[] = []
  const reserveInputs: Array<{ year: unknown; pages: unknown; rotation: unknown }> = []
  let putCount = 0, ocrReads = 0, confirmationCalls = 0, businessReceipts = 0
  const uploadUrl = 'https://storage.example.invalid/__document-source'
  const reply = (route: Route, value: unknown) => route.fulfill({ json: value })
  await page.route('**/__document-source', async route => {
    expect(route.request().headers().authorization).toBeUndefined()
    expect(route.request().headers().cookie).toBeUndefined()
    if (route.request().method() === 'PUT') putCount++
    await route.fulfill({ status: 200, body: route.request().method() === 'GET' ? bytes : '', headers: { 'access-control-allow-origin': '*', 'content-type': 'application/pdf' } })
  })
  await page.route(`**${root}/**`, async route => {
    const path = new URL(route.request().url()).pathname.slice(root.length)
    if (path === '/objects') return reply(route, { items: [{ key: 'courseboardReservationReports', label: 'Reservation reports', importModes: ['create_only'], import: { writable: true, fields: [] }, documentImport: { pricingStatus: 'undecided', maximumFiles: 32, maximumFileBytes: 67108864, maximumTotalBytes: 1073741824, maximumPages: 64 } }] })
    if (path.endsWith('/document-upload')) {
      const body = route.request().postDataJSON()
      keys.push(body.idempotencyKey)
      reserveInputs.push({ year: body.importOptions.year, pages: body.pages, rotation: body.documents[0].rotation })
      source.rotation = body.documents[0].rotation
      if (job) { expect(body.importOptions).toEqual(job.importOptions); expect(body.pages ?? null).toEqual(job.document!.pages) }
      if (!job) job = { id: 'dtj_document_fixture', objectKey: 'courseboardReservationReports', status: 'uploading', mode: 'create_only', processed: 0, total: null, created: 0, updated: 0, errors: 0, validationErrors: [], preview: [], batch: false, previewPage: 0, previewPages: 0, filename: null, failure: null, importOptions: body.importOptions, sourceSha256: sha256, createdAt: '2026-10-08T00:00:00Z', document: { rowField: 'rows', ocrJobId: 'goj_same', manifestSha256: 'b'.repeat(64), sources: [source], pages: body.pages ?? null, ocrStatus: 'uploading', expiresAt: '2099-10-08T00:00:00Z', revisionVersion: 0, revisionSha256: null, executionAvailable: false } }
      if (loseResponses && keys.length === 1) return route.abort('failed')
      return reply(route, { job, ocr: { id: 'goj_same', status: 'uploading', uploads: [{ storageKey: 'source', uploadUrl, expiresAt: '2099' }] } })
    }
    if (!job) return route.fulfill({ status: 404 })
    if (path.endsWith('/document-read')) {
      const { operation } = route.request().postDataJSON()
      if (operation === 'confirm') job.document!.ocrStatus = 'ready'
      if (operation === 'advance') {
        ocrReads++
        job = { ...job, status: 'review', document: { ...job.document!, ocrStatus: 'completed', extracted: { fields: { rows: [raw] }, warnings: [] } } }
      }
      return reply(route, { job, ocr: { id: 'goj_same', status: job.document!.ocrStatus }, uploads: [] })
    }
    if (path.endsWith('/document-original/0')) return route.fulfill({ body: bytes, headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store' } })
    if (path.endsWith('/document-revision')) {
      const body = route.request().postDataJSON()
      expect(body.rows).toHaveLength(1)
      expect(body.rows[0].source).toEqual({ fileIndex: 0, page: 1, row: 1 })
      expect(body.rows[0].values.originalConfirmed).toBe(true)
      job = { ...job, status: 'review', importOptions: body.importOptions, document: { ...job.document!, revisionVersion: 1, revisionSha256: 'c'.repeat(64), revision: { version: 1, sha256: 'c'.repeat(64), rows: body.rows } } }
    }
    if (path.endsWith('/document-validate')) job = { ...job, status: 'ready', total: 1, document: { ...job.document!, executionAvailable: true, validationCursor: 1 } }
    if (path.endsWith('/document-confirm')) {
      confirmationCalls++
      const body = route.request().postDataJSON()
      expect(body).toEqual({ manifestSha256: 'b'.repeat(64), revisionVersion: 1, revisionSha256: 'c'.repeat(64) })
      if (!businessReceipts) businessReceipts++
      job = { ...job, status: 'running', processed: 1, created: 1, document: { ...job.document!, executionConfirmed: true } }
      if (loseResponses && confirmationCalls === 1) return route.abort('failed')
      job.status = 'completed'
    }
    return reply(route, job)
  })
  return { file: { name: 'reservation.pdf', mimeType: 'application/pdf', buffer: bytes }, keys, reserveInputs, counts: () => ({ putCount, ocrReads, confirmationCalls, businessReceipts }) }
}

test('PDF reserve and save response losses resume the same document and receipt', async ({ page }) => {
  const mock = await fixture(page, true)
  await page.goto(entry)
  await page.getByLabel(ja.files, { exact: true }).setInputFiles(mock.file)
  await page.getByLabel(ja.fields.year, { exact: true }).fill('2025')
  await page.getByLabel(ja.pages).fill('1')
  await page.getByLabel(ja.rotation.replace('{{file}}', mock.file.name), { exact: true }).selectOption('90')
  await page.getByRole('button', { name: ja.start, exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel(ja.fields.year, { exact: true })).toHaveValue('2025')
  await expect(page.getByLabel(ja.pages)).toHaveValue('1')
  await page.getByLabel(ja.files, { exact: true }).setInputFiles(mock.file)
  await page.getByRole('button', { name: ja.start, exact: true }).click()
  await expect(page.getByRole('button', { name: ja.openOriginal, exact: true })).toBeVisible()
  expect(mock.keys).toHaveLength(2)
  expect(new Set(mock.keys).size).toBe(1)
  expect(mock.reserveInputs).toEqual([{ year: 2025, pages: '1', rotation: 90 }, { year: 2025, pages: '1', rotation: 90 }])
  await expect(page.getByRole('button', { name: ja.saveRevision, exact: true })).toBeDisabled()
  await page.getByRole('button', { name: ja.openOriginal, exact: true }).click()
  const reviewPage = page.getByRole('button', { name: '1ページの各行を原本と照合した', exact: true })
  await expect(reviewPage).toBeEnabled()
  const canvas = page.locator('.reception-pdf-page canvas')
  const dimensions = await canvas.evaluate(element => ({ width: (element as HTMLCanvasElement).width, height: (element as HTMLCanvasElement).height }))
  expect(dimensions.width).toBeLessThan(dimensions.height)
  await reviewPage.click()
  await page.getByRole('button', { name: ja.saveRevision, exact: true }).click()
  await page.getByRole('button', { name: ja.validate, exact: true }).click()
  await expect(page.getByRole('button', { name: ja.confirmSave, exact: true })).toBeEnabled()
  expect(mock.counts().businessReceipts).toBe(0)
  await page.getByRole('button', { name: ja.confirmSave, exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: ja.reconcile, exact: true }).click()
  await expect(page.getByText(ja.completedMessage, { exact: true })).toBeVisible()
  expect(mock.counts()).toEqual({ putCount: 1, ocrReads: 1, confirmationCalls: 2, businessReceipts: 1 })
})

for (const locale of ['ja', 'ja-plain', 'en'] as const) {
  test(`PDF review is usable in ${locale} at 200 percent`, async ({ page }, info) => {
    const messages = locale === 'en' ? en : locale === 'ja-plain' ? { ...ja, ...plain } : ja
    await page.addInitScript(value => localStorage.setItem('courseboard.locale', value), locale)
    await page.setViewportSize({ width: 1280, height: 900 })
    const mock = await fixture(page)
    await page.goto(entry)
    await expect(page.getByRole('heading', { name: messages.title, exact: true })).toBeVisible()
    await page.getByLabel(messages.files, { exact: true }).setInputFiles(mock.file)
    await page.getByRole('button', { name: messages.start, exact: true }).click()
    await page.getByRole('button', { name: messages.openOriginal, exact: true }).click()
    await expect(page.locator('.document-import-page canvas')).toBeVisible()
    await page.evaluate(() => { document.documentElement.style.zoom = '2' })
    await page.getByRole('button', { name: messages.saveRevision, exact: true }).scrollIntoViewIfNeeded()
    const smallControls = await page.locator('.document-import-page button, .document-import-page input, .document-import-page select').evaluateAll(elements => elements.filter(element => {
      const box = element.getBoundingClientRect(), style = getComputedStyle(element)
      return box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44 || parseFloat(style.fontSize) < 16)
    }).map(element => element.outerHTML))
    expect(smallControls).toEqual([])
    expect(await page.locator('.document-import-page').evaluate(element => element.scrollWidth <= element.clientWidth + 2)).toBe(true)
    await page.screenshot({ path: info.outputPath(`${locale}-200-percent.png`), fullPage: true })
  })
}
