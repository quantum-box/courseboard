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
  // 本番相手は同時接続を絞る。
  // CI も数を固定する。既定の「CPU 数の半分」は os.cpus() を見るが、
  // tachyoncloud の runner は pod なので返るのはノードのコア数で、pod の
  // 2 vCPU ではない。32 コアのノードに載ると 16 並列の Chromium が 2 vCPU を
  // 取り合い、遷移だけで 20〜40 秒かかって全テストがタイムアウトする
  // （16 workers の run は全滅、8 workers の run は 3〜4 分で通っていた）。
  workers: target === 'prod' ? 2 : process.env.CI ? 4 : undefined,
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
  //
  // CI だけビルド済みの成果物を配る。dev server はページを開くたびに必要な
  // モジュールを変換して返すが、このアプリはルートを遅延ロードしていないので
  // 1 ページ目でアプリ全体の変換が走る。並列のワーカーが一斉に冷えたサーバーへ
  // 来ると変換待ちで navigation が 30 秒を超え、重いルート（シフト表・台帳・
  // タイムライン）から順に落ちる。リトライだけ通っていたのは変換キャッシュが
  // 温まった後だから。preview は静的配信なので、この待ち自体が無くなる。
  // ローカルは編集して即やり直したいので dev server のまま。
  webServer: manageLocalServer
    ? {
        command: process.env.CI
          ? 'npm run build && npm run preview -- --port 5173 --strictPort'
          : 'npm run dev',
        url: baseURL,
        // ローカルは起動済みの dev server を殺さず再利用する。CI は必ず自前で起動する
        reuseExistingServer: !process.env.CI,
        // ビルドを挟むぶん CI は起動が遅い
        timeout: process.env.CI ? 180_000 : 60_000,
        env: {
          ...process.env,
          // ビルドの既定 base は Tauri の file:// 向けの相対パス。HTTP で配ると
          // /golf/ledger のような 2 階層のリンクが /golf/assets/... を取りに行って
          // 404 になり、真っ白なまま title が既定のままになる。
          VITE_BASE_PATH: '/',
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
