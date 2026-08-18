import { expect, test } from '@playwright/test'
import { e2eApiUrl } from './routes'

/** 認証なしで届くべきものが届くことを確認する。 */

test('/download が表示される', async ({ page }) => {
  await page.goto('/download')
  await expect(page).toHaveTitle('Course Board をダウンロード')
})

test('API の healthz が ok を返す', async ({ request }) => {
  const apiUrl = e2eApiUrl()
  test.skip(!apiUrl, 'E2E_API_URL 未設定（ローカルのモックモードでは API を立てない）')
  const response = await request.get(`${apiUrl}/healthz`)
  expect(response.ok()).toBeTruthy()
  expect(await response.text()).toContain('"status":"ok"')
})
