import { expect, test } from '@playwright/test'
import { APP_NAME, NOT_FOUND_TITLE, appRoutes } from './routes'

/**
 * 全ルートのスモークテスト。各画面について:
 * - document.title がその画面のもの（= ルーティングとページメタデータが正しい）
 * - アプリシェルの main が表示される（= 認証・レイアウトが壊れていない）
 * - 404 画面に落ちていない
 * - 未捕捉の JS エラーが起きていない
 */
for (const route of appRoutes) {
  test(`/${route.path} が表示される`, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(String(error)))

    await page.goto(`/${route.path}`)

    await expect(page).toHaveTitle(`${route.title} | ${APP_NAME}`)
    await expect(page.locator('main.workspace-content')).toBeVisible()

    expect(
      pageErrors,
      `未捕捉エラー:\n${pageErrors.join('\n')}`,
    ).toEqual([])
  })
}

test('存在しないルートは 404 画面になる', async ({ page }) => {
  await page.goto('/golf/definitely-not-a-route')
  await expect(page).toHaveTitle(`${NOT_FOUND_TITLE} | ${APP_NAME}`)
})
