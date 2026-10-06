import { expect, test, type Page, type Route } from '@playwright/test'
import type { ImportJob, ImportRow } from '../src/features/golf/common-imports/api'

const root = '/v1/course/data-imports'
const row = (number = 2, name = '確認済み'): ImportRow => ({ rowNumber: number, id: null, object: { name }, warnings: [], error: null, outcome: null })
async function fixture(page: Page, options: { batch?: boolean; invalidLater?: boolean; pauseUpload?: boolean } = {}) {
  const calls: string[] = []
  let job: ImportJob | null = null
  let beforeCancel = ''
  let validations = 0
  let puts = 0
  let releasePage: (() => void) | undefined
  const delayedPage = new Promise<void>(resolve => { releasePage = resolve })
  const reply = (route: Route, value: unknown) => route.fulfill({ json: value })
  await page.route('**/__import-source', async route => {
    calls.push('PUT source'); puts++
    expect(route.request().headers().authorization).toBeUndefined()
    if (options.pauseUpload && puts === 1) return
    await route.fulfill({ status: 200, body: '' })
  })
  await page.route(`**${root}/**`, async route => {
    const url = new URL(route.request().url()); const path = url.pathname.slice(root.length)
    calls.push(`${route.request().method()} ${path}`)
    if (path === '/objects') return reply(route, { items: ['customer', 'dailyBudgets', 'courseboardReservationReports'].map(key => ({ key, label: ({ customer:'顧客台帳',dailyBudgets:'日次予算',courseboardReservationReports:'予約表集計' })[key], importModes:['create_only'], import: { writable:true,fields:[{key:'name',label:'名称',required:true}] } })) })
    if (path === '/jobs') return reply(route, { items: job ? [{...job,preview:[]}] : [] })
    if (path.includes('/imports/')) {
      const request = route.request().postDataJSON()
      job = { id:'dtj_fixture', objectKey:path.split('/')[2], status: options.batch ? 'uploading' : 'ready', mode:'create_only', processed:0,total:options.batch ? null : 1,created:0,updated:0,errors:0,validationErrors:[],preview:options.batch ? [] : [row()],batch:!!options.batch,previewPage:0,previewPages: options.batch ? 0 : 1,filename:request.filename,failure:null,importOptions:request.importOptions,sourceSha256:request.sha256 ?? '',createdAt:'2026-10-07T00:00:00Z' }
      return reply(route, options.batch ? {job,uploadUrl:new URL('/__import-source',url).href,contentType:'text/csv'} : job)
    }
    if (!job) return route.fulfill({ status:404,json:{message:'not found'} })
    if (path.endsWith('/validate')) {
      validations++
      job={...job,status:validations===1?'validating':options.invalidLater?'invalid':'ready',total:501,previewPages:2,preview:validations===1?[row(2)]:[],validationErrors:validations>1&&options.invalidLater?[{rowNumber:503,message:'後続行の値が不正です'}]:[]}
    } else if (path.endsWith('/advance')) job={...job,status:'completed',processed:job.total??501,created:job.total??501,preview:[]}
    else if (path.endsWith('/cancel')) { beforeCancel=job.status;job={...job,status:'cancelled'} }
    else if (path.endsWith('/resume')) job={...job,status:beforeCancel,sourceUploadUrl:new URL('/__import-source',url).href,sourceContentType:'text/csv'}
    else if (path.endsWith('/preview/1')) { await delayedPage;return reply(route,{...job,previewPage:1,preview:[row(103,'次のページ')]}) }
    else if (path.endsWith('/preview/0')) return reply(route,{...job,previewPage:0,preview:[row(2)]})
    await reply(route,route.request().method()==='GET'&&!job.batch?{...job,preview:[row()]}:job)
  })
  return { calls, releasePage: () => releasePage?.() }
}
const file = (count = 1) => ({ name:'input.csv',mimeType:'text/csv',buffer:Buffer.from(`name\n${Array.from({length:count},(_,i)=>`顧客${i}`).join('\n')}\n`) })

for (const key of ['customer','dailyBudgets','courseboardReservationReports']) {
  test(`${key}: small CSV waits for confirmation and retains the preview after completion/reload`, async ({page}) => {
    const mock=await fixture(page)
    await page.goto(`/golf/data-imports/${key}`)
    await expect(page.getByLabel('取込対象')).toHaveValue(key)
    await page.locator('input[type="file"]').first().setInputFiles(file())
    await expect(page.locator('p[role="status"]')).toContainText('実行確認待ち')
    await expect(page.getByText('確認済み',{exact:true})).toBeVisible()
    expect(mock.calls.filter(call=>call.endsWith('/advance'))).toHaveLength(0)
    await page.getByRole('button',{name:'確認して取り込む',exact:true}).click()
    await expect(page.locator('p[role="status"]')).toContainText('完了：1 / 1')
    await expect(page.getByText('確認済み',{exact:true})).toBeVisible()
    await page.reload();await page.getByRole('button',{name:'確認する',exact:true}).click()
    await expect(page.locator('p[role="status"]')).toContainText('完了：1 / 1')
    expect(mock.calls.filter(call=>call.endsWith('/advance'))).toHaveLength(1)
  })
}
test('501-row CSV uses Storage and retains the preview on a later validation error',async({page})=>{
  const mock=await fixture(page,{batch:true,invalidLater:true})
  await page.goto('/golf/data-imports/customer')
  await page.locator('input[type="file"]').first().setInputFiles(file(501))
  await expect(page.locator('p[role="status"]')).toContainText('入力を修正してください')
  await expect(page.getByText('503 行目：後続行の値が不正です')).toBeVisible()
  await expect(page.getByText('確認済み',{exact:true})).toBeVisible()
  expect(mock.calls).toContain('PUT source');expect(mock.calls.filter(call=>call.endsWith('/advance'))).toHaveLength(0)
  await expect(page.getByRole('button',{name:'確認して取り込む',exact:true})).toHaveCount(0)
})
test('a delayed preview cannot overwrite cancellation, and resume waits for confirmation',async({page})=>{
  const mock=await fixture(page,{batch:true})
  await page.goto('/golf/data-imports/customer');await page.locator('input[type="file"]').first().setInputFiles(file(501))
  await expect(page.locator('p[role="status"]')).toContainText('実行確認待ち')
  await page.getByRole('button',{name:'次のページ'}).click();await expect(page.getByText('確認済み',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'中止',exact:true}).click();mock.releasePage()
  await expect(page.locator('p[role="status"]')).toContainText('中止：')
  await expect(page.locator('table').getByText('次のページ',{exact:true})).toHaveCount(0)
  await page.reload();await page.getByRole('button',{name:'確認する',exact:true}).click()
  await page.getByRole('button',{name:'中止した取込を再開'}).click()
  await expect(page.locator('p[role="status"]')).toContainText('実行確認待ち')
  expect(mock.calls.filter(call=>call.endsWith('/advance'))).toHaveLength(0)
  await page.getByRole('button',{name:'確認して取り込む',exact:true}).click()
  await expect(page.locator('p[role="status"]')).toContainText('完了：501 / 501')
})
test('upload cancellation resumes the same source and same job',async({page})=>{
  const mock=await fixture(page,{batch:true,pauseUpload:true})
  await page.goto('/golf/data-imports/customer');await page.locator('input[type="file"]').first().setInputFiles(file(501))
  await expect(page.locator('p[role="status"]')).toContainText('アップロード中')
  await page.getByRole('button',{name:'中止',exact:true}).click();await expect(page.locator('p[role="status"]')).toContainText('中止：')
  await page.getByRole('button',{name:'中止した取込を再開'}).click();await expect(page.locator('p[role="status"]')).toContainText('実行確認待ち')
  expect(mock.calls.filter(call=>call.endsWith('/imports/upload-url'))).toHaveLength(1)
  expect(mock.calls.filter(call=>call==='PUT source')).toHaveLength(2)
})
