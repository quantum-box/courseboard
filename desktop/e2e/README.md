# CourseBoard E2E テスト

Playwright で SPA の全画面が表示・遷移できることを検証するスモークスイート。
ローカルと本番の両方に対して実行できる。`desktop/` から実行する。

## 実行方法

```bash
# ローカル（既定）: モックモードの Vite を自動起動して実行
# バックエンド・Cognito・DB 不要。:5173 が起動済みならそれを再利用する
# （起動中の dev server は落とさない）
npm run e2e

# 本番（https://courseboard.txcloud.app）に対して実行
E2E_USERNAME=<Cognitoユーザー> E2E_PASSWORD=<パスワード> npm run e2e:prod

# HTML レポートを開く
npm run e2e:report
```

## 環境変数

- `E2E_TARGET` — `prod` で本番。未指定はローカル
- `E2E_BASE_URL` — 対象 URL を直接指定（指定時は dev server を自動起動しない）。
  ローカル既定は `http://localhost:5173`。`127.0.0.1` は使わない（Vite が環境によって
  IPv6 の `[::1]` にしかバインドせず、IPv4 直指定だと繋がらないため）
- `E2E_API_URL` — healthz 確認先 API。本番既定は `https://courseboard-api.txcloud.app`、ローカル既定は無し（スキップ）。ローカル API を検証するなら `http://localhost:8080`
- `E2E_USERNAME` / `E2E_PASSWORD` — ログイン画面が出る環境（本番、pkce-env なローカル）で必須
- `E2E_TENANT_ID` — テナント選択画面が出るアカウント用。id / slug / 表示名のどれでも部分一致で選ぶ。未指定なら先頭のテナント

## 構成

- `routes.ts` — 全ルートと期待タイトルの一覧（`src/App.tsx` の RouteContent と対応）。画面を追加したらここに 1 行足す
- `auth.setup.ts` — ログイン（不要な環境では素通り）して storageState を保存
- `pages.spec.ts` — 全ルートに直接アクセスし、タイトル・シェル表示・404 でないこと・未捕捉 JS エラーが無いことを確認
- `navigation.spec.ts` — サイドバーから各画面へ遷移できることを確認
- `content.spec.ts` — **ローカル専用。** モックデータ（`src/dev/mockFieldApi.ts`）を前提に、全画面の中身と操作（検索・フィルタ・詳細への遷移・受付用紙の読み取りなど）を検証。本番ターゲット時は config が除外する
- `public.spec.ts` — 認証不要の `/download` と API `/healthz`

## 方針

- **読み取り専用。** データを作る・変える操作は含めない（本番に対して安全に実行できることを優先）
- タイトル検証は ja ロケール前提（Playwright 側で `locale: 'ja-JP'` を固定）
- 認証済みプロジェクト（app）はテナント無し URL（`/golf/...`）を使う。router がログイン済みテナントに解決する

## モックデータの前提（content.spec）

- モックの基準日は `2026-07-18`（`MOCK_FIXTURE_DATE`）。日付き画面（台帳・タイムライン・配置・出勤）は
  `?date=2026-07-18` を付けないと空になる
- 金額は `Intl.NumberFormat('ja-JP')` の全角 `￥` で表示される
- モック未対応の操作（打刻・請求書発行・シミュレータ計算・請求の新規送信）は叩かない。
  表示の検証に留めている

## CI

`.github/workflows/ci.yml` の `e2e` job が PR ごとにローカル構成で実行する
（モックモードの Vite を自前で起動するので、バックエンドも認証情報も要らない）。
失敗時は HTML レポートとトレースが artifact `playwright-report` に上がる。

`tachyoncloud` runner に Playwright の実行環境が無い場合は
`npx playwright install --with-deps` が落ちる。そのときは job を
`container: mcr.microsoft.com/playwright:v<@playwright/test の版>-noble` に切り替える。

## 拡張するとき

- 画面の中身に踏み込む検証はモックデータ依存なので `content.spec.ts` に足す
  （本番ターゲットでは config が自動で除外する）
- 書き込みを伴うテストを足す場合は必ず sandbox テナントを使い、本番では実行しない
