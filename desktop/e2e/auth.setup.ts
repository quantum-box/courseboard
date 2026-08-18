import { expect, test as setup } from '@playwright/test'
import { STORAGE_STATE } from './routes'

/**
 * 認証状態を作って storageState に保存する。
 *
 * - development アダプタ（ローカルのモックモード）: ログイン画面が出ないので
 *   アプリシェルの表示を待つだけ。
 * - cognito-direct（本番・pkce-env なローカル）: ログインフォームに
 *   E2E_USERNAME / E2E_PASSWORD を入力して送信する。
 * - 複数テナントのアカウントではテナント選択画面が出る。E2E_TENANT_ID
 *   （id / slug / 表示名のどれでも可）で選び、未指定なら先頭を選ぶ。
 */
setup('サインインして認証状態を保存する', async ({ page }) => {
  await page.goto('/golf')

  const loginForm = page.locator('form.auth-login-form')
  const tenantList = page.locator('.tenant-list')
  const shell = page.locator('main.workspace-content')

  await expect(loginForm.or(tenantList).or(shell).first()).toBeVisible({ timeout: 30_000 })

  if (await loginForm.isVisible()) {
    const username = process.env.E2E_USERNAME
    const password = process.env.E2E_PASSWORD
    if (!username || !password) {
      throw new Error(
        'ログイン画面が表示されました。E2E_USERNAME / E2E_PASSWORD を環境変数で渡してください。'
          + '（ローカルでログインを省くにはモックモードの dev server を使う）',
      )
    }
    await loginForm.locator('input[name="username"]').fill(username)
    await loginForm.locator('input[name="password"]').fill(password)
    await loginForm.getByRole('button', { name: 'ログイン' }).click()
  }

  await expect(tenantList.or(shell).first()).toBeVisible({ timeout: 30_000 })

  if (await tenantList.isVisible()) {
    const tenantId = process.env.E2E_TENANT_ID
    const option = tenantId
      ? tenantList.locator('.tenant-option', { hasText: tenantId }).first()
      : tenantList.locator('.tenant-option').first()
    await option.click()
  }

  await expect(shell).toBeVisible({ timeout: 30_000 })
  await page.context().storageState({ path: STORAGE_STATE })
})
