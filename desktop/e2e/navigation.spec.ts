import { expect, test } from '@playwright/test'
import { APP_NAME, appRoutes } from './routes'

/**
 * サイドバーのナビゲーションで各画面へ遷移できることを確認する。
 * ホーム画面のタイルにも同名ボタンがあるためサイドバー内に絞る。
 */
test('サイドバーから各画面へ移動できる', async ({ page }) => {
  await page.goto('/golf')
  await expect(page.locator('main.workspace-content')).toBeVisible()

  const sidebar = page.locator('.courseboard-sidebar').first()
  await expect(sidebar).toBeVisible()

  for (const route of appRoutes.filter(r => r.sidebarLabel)) {
    await sidebar.getByRole('button', { name: route.sidebarLabel!, exact: true }).click()
    await expect(page).toHaveTitle(`${route.title} | ${APP_NAME}`)
  }
})
