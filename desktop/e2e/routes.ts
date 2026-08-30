/**
 * E2E スイートの共有定義。
 *
 * ルート一覧は desktop/src/App.tsx の RouteContent と
 * desktop/src/components/AppShell.tsx の routeTitle に対応する。
 * タイトルは ja ロケール（Playwright 側で locale: 'ja-JP' を固定）。
 */

export const APP_NAME = 'Course Board'

export const STORAGE_STATE = 'e2e/.auth/state.json'

export type E2eTarget = 'local' | 'prod'

export function e2eTarget(): E2eTarget {
  return process.env.E2E_TARGET === 'prod' ? 'prod' : 'local'
}

export function e2eBaseUrl(): string {
  if (process.env.E2E_BASE_URL) return process.env.E2E_BASE_URL
  // ローカルは 127.0.0.1 ではなく localhost。vite.config.ts の server.host は
  // TAURI_DEV_HOST が無いと false（= localhost）で、環境によっては IPv6 の
  // [::1] にしかバインドしないため、IPv4 直指定だと webServer 待ちが通らない。
  return e2eTarget() === 'prod' ? 'https://courseboard.txcloud.app' : 'http://localhost:5173'
}

/** API の healthz 確認先。ローカルのモックモードでは API が無いので undefined。 */
export function e2eApiUrl(): string | undefined {
  if (process.env.E2E_API_URL) return process.env.E2E_API_URL
  return e2eTarget() === 'prod' ? 'https://courseboard-api.txcloud.app' : undefined
}

/**
 * playwright.config.ts 自身が起動したモックモードの Vite を相手にしているか。
 *
 * `E2E_TARGET=prod` 以外はすべてローカル扱いになるが、`E2E_BASE_URL` や
 * `E2E_API_URL` で接続先を差し替えられていると、その先がモックである保証は
 * どこにも無い。**読み取りだけのスイートと違い、書き込みを伴う検証は
 * 差し替え先が実バックエンドだった場合に本物のデータを作ってしまう**ので、
 * その判定にこれを使う。
 */
export function e2eManagedMockServer(): boolean {
  if (e2eTarget() === 'prod') return false
  // 差し替え先がモックであることを呼び出し側が知っている場合の逃げ道。
  // :5173 が塞がっていて別ポートへモックモードの Vite を手で立てたときに使う。
  if (process.env.E2E_MOCK_MODE === '1') return true
  return !process.env.E2E_BASE_URL && !process.env.E2E_API_URL
}

export interface AppRoute {
  /** テナント無しのルートパス（router.ts の ROUTE_ROOTS により最後に使ったテナントへ解決される） */
  path: string
  /** document.title の「| Course Board」より前の部分 */
  title: string
  /** サイドバーに表示される場合のラベル（navigation.spec.ts が使う） */
  sidebarLabel?: string
}

export const appRoutes: AppRoute[] = [
  { path: 'golf', title: 'ホーム', sidebarLabel: 'ホーム' },
  { path: 'golf/ledger', title: '予約台帳', sidebarLabel: '予約台帳' },
  // タイムラインはサイドバー非表示（sidebarHiddenRoutes）だが直リンクは有効
  { path: 'golf/timeline', title: 'タイムライン' },
  { path: 'golf/customers', title: '顧客台帳', sidebarLabel: '顧客台帳' },
  { path: 'golf/customers/reception', title: '受付用紙から顧客を登録する' },
  { path: 'golf/products', title: 'プレー商品', sidebarLabel: 'プレー商品' },
  { path: 'golf/courses', title: 'コース', sidebarLabel: 'コース' },
  { path: 'golf/caddies', title: 'キャディ名簿', sidebarLabel: 'キャディ名簿' },
  { path: 'golf/caddies/dispatch', title: 'キャディの配置', sidebarLabel: 'キャディの配置' },
  // attendance は名簿画面内のタブなのでタイトルは名簿のまま
  { path: 'golf/caddies/attendance', title: 'キャディ名簿' },
  { path: 'golf/caddies/shifts', title: 'シフト表', sidebarLabel: 'シフト表' },
  { path: 'golf/caddies/payroll', title: '給与', sidebarLabel: '給与' },
  { path: 'staff', title: '社員名簿', sidebarLabel: '社員名簿' },
  { path: 'golf/budgets', title: '売上目標', sidebarLabel: '売上目標' },
  { path: 'golf/settlement', title: '月次精算', sidebarLabel: '月次精算' },
  { path: 'golf/simulator', title: '料金計算', sidebarLabel: '料金計算' },
  { path: 'golf/policy', title: '予約ルール' },
  {
    path: 'golf/reservation-report-import',
    title: '予約表をとりこむ',
    sidebarLabel: '予約表をとりこむ',
  },
  { path: 'cancellation-fees', title: 'キャンセル料', sidebarLabel: 'キャンセル料' },
  { path: 'cancellation-fees/new', title: 'キャンセル料' },
  { path: 'course-map', title: 'コースマップ' },
  { path: 'settings', title: '設定' },
  { path: 'settings/advanced', title: 'システム連携の詳細' },
  { path: 'settings/members', title: 'メンバーと権限' },
]

export const NOT_FOUND_TITLE = '画面が見つかりません'

/**
 * モックデータの基準日（src/dev/mockFieldApi.ts の MOCK_FIXTURE_DATE と同値）。
 * mockFieldApi は import.meta.env に依存していて Playwright の Node からは
 * import できないため、ここに複製している。
 */
export const MOCK_FIXTURE_DATE = '2026-07-18'
