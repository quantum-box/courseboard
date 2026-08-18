import { defineConfig, devices } from '@playwright/test'
import { STORAGE_STATE, e2eBaseUrl, e2eTarget } from './e2e/routes'

const target = e2eTarget()
const baseURL = e2eBaseUrl()
// E2E_BASE_URL を明示されたら dev server の面倒は見ない（起動済み前提）
const manageLocalServer = target === 'local' && !process.env.E2E_BASE_URL

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // 本番相手は同時接続を絞る
  workers: target === 'prod' ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'e2e/playwright-report', open: 'never' }],
  ],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    // タイトル・見出しの検証は ja ロケール前提
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // 認証不要ページ（/download など）と API healthz
      name: 'public',
      testMatch: /public\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // 認証済みで全画面を回るスイート
      name: 'app',
      // content.spec はモックデータ前提なのでローカルのみ
      testMatch: target === 'prod'
        ? /(pages|navigation)\.spec\.ts/
        : /(pages|navigation|content)\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
  ],
  // ローカル既定: モックモードの Vite を自動起動（バックエンド・Cognito 不要）。
  // すでに :5173 が起動していればそれを使う（勝手に殺さない）。
  webServer: manageLocalServer
    ? {
        command: 'npm run dev',
        url: baseURL,
        // ローカルは起動済みの dev server を殺さず再利用する。CI は必ず自前で起動する
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        env: {
          ...process.env,
          VITE_COURSEBOARD_AUTH_MODE: 'development',
          VITE_COURSEBOARD_API_BEARER: 'local-dev-token',
          VITE_COURSEBOARD_TENANT_ID: 'courseboard_id',
          VITE_COURSEBOARD_MOCK_DATA: 'true',
          // .env.local の Cognito client id が残っていても development モードと衝突させない
          VITE_COURSEBOARD_BROWSER_CLIENT_ID: '',
        },
      }
    : undefined,
})
