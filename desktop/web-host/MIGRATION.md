# admin-ui 移植メモ（courseboard フロントエンド）

> 作成: 2026-07-01 / ブランチ: `feature/admin-ui-frontend`

## これは何
tachyonfield の `apps/admin-ui`（vinext + React + NextAuth v5 + Cognito）を**最新 main からそのままコピーした base**。
これを courseboard 用の **golf 特化・単体ログイン管理画面**に育てる。バックエンドは courseboard(Rust) のまま、フロントだけ追加するフルスタック化。

## 決まっている方針
- **単体アプリ化**：courseboard 自体にログインして使う（Field と同じ立ち位置）。
- **認証 = Cognito のみ**（Ao 確認済み）。Field と同じユーザープールで普通にログイン。
  → **バックエンドの verify は使わない**。移植時に `src/app/auth.ts` の `AUTH_BACKEND_API_URL` (`/auth/v1beta/verify`) 呼び出しは**削除**して Cognito ログイン＋トークン検証だけにする。
- **認可 = ユーザートークン転送（方式A）**。golf 画面は server action から `/v1/erp/...` を**ユーザーの Bearer トークン**で直接叩く（今の admin-ui と同じ）。専用サービスアカウント不要。
- **コピー方式**（共有パッケージ化はしない）。golf 以外は間引く。

## 残作業チェックリスト
- [x] **認証を Cognito-only に簡素化**：`src/app/auth.ts` の jwt callback から backend verify (`verifyAccessToken`/`AUTH_BACKEND_API_URL`) 呼び出しを削除し、Cognito の token/profile claims から `resolveJwtUser` で解決（`verifiedUser: undefined`、id は `sub`/`cognito:username` fallback、role 既定 GENERAL）。**tsc で新規エラーゼロを確認**。※ role を Cognito groups から解決するのは follow-up。password-session 層は Cognito ログインに無害なので温存。
- [x] **standalone tsconfig**：`courseboard/tooling/tsconfig/{base,nextjs}.json` を追加（monorepo 相対 extends の解決）。
- [~] **非golf 間引き（scope B・一次）**：非golf 17バーティカル(accounting/analytics/audit-logs/billing/billing-accounts/consumer-orders/deals/invoices/quotations/reports/saas-subscriptions/store/inventory/tenants/library/products/agent)＋document-pdf を削除、**tsc 0エラー**。残置: dashboard/home/photon/settings/reservations/cancellation-fees/erp/extension-host/apps と orders/procurement/imports（kept ページが `_lib`/`action` を共有）。**finer な golf-only 抽出（共有lib切り出し・汎用ERPページ要否）は follow-up（要プロダクト判断）**。
- [x] **本番ビルド 成功**：`pnpm install`（native build 承認は `pnpm-workspace.yaml` の `allowBuilds`）→ `vinext build` が **5/5 environment 完走、`dist/server/index.js`＋`dist/client`(171 files)＋`dist/standalone/` 生成**。`pnpm-lock.yaml` をコミット（CI 再現性）。※ ローカルは npm が optional-deps バグで不安定だったため **pnpm に統一**（元 admin-ui も pnpm）。courseboard の deploy build コマンドも npm→pnpm に合わせるべき（tachyon.yaml 要調整）。
- [ ] **バックエンド向き先**：`TACHYON_FIELD_API_URL` を tachyon-field-api(:50056) に。golf REST(`/v1/erp/extensions/golf-course/*`, `/v1/erp/hrm/*`) は当面 tachyonfield ERP 側にあるのでそこを叩く。将来 courseboard(Rust) に移設。
- [ ] **Cognito クライアント発行（自己発行・1回／手動プロビジョニング不要）**：auth-platform の
  `POST /v1/auth/oauth2-clients`（`tachyoncli` が叩くエンドポイント）で**ログイン用クライアントを丸ごと発行**する。
  実装確認済み（tachyon-apps `packages/auth/src/interface_adapter/axum/oauth2_client_handler.rs`）: リクエストは
  `redirect_uris`(コールバックURL) / `allowed_scopes` / `grant_types`(`authorization_code`/`refresh_token`) を受け取る。
  ```jsonc
  { "name": "courseboard-web",
    "redirect_uris": ["https://<courseboardホスト>/api/auth/callback/cognito",
                       "http://localhost:3001/api/auth/callback/cognito"],
    "allowed_scopes": ["openid","profile","email","aws.cognito.signin.user.admin"],
    "grant_types": ["authorization_code","refresh_token"] }
  // → 返却 client_id/secret を COGNITO_CLIENT_ID / COGNITO_CLIENT_SECRET へ（secret store）
  ```
  唯一の変数は `redirect_uris` の **courseboard ホスト名**（Cloudflare Worker のドメイン確定後）。
  `AUTH_SECRET` はこちらで生成。**旧「Ao/AWS 手動プロビジョニング」ランブックは不要になったため破棄。**
- 認可(authz)は作業なし：方式A（ユーザートークン転送）で tachyonfield が本人の Field 権限で認可。
- [x] **デプロイ先決定 → Cloudflare Workers**（tachyonfield `fieldadmin` と同型）。vinext のまま。`tachyon.yaml` に frontend CloudApp `courseboard` を追加済み・`wrangler.json` の name を `courseboard` に変更済み。バック=AWS Lambda(既存)／フロント=Cloudflare Workers。build/secret は platform 連携で要検証。
- [ ] **ブランディング/不要物除去**：sentry/photon/その他 Field 固有設定の要否を整理。`public/` の Field アセットも golf 用に差し替え/削減。
- [ ] **ビルド検証**：`npm install` → `npm run build`（この sandbox では未実施）。

## セキュリティ対応済み
- コピーに含まれていた **実シークレットを除去**：`.env.local`・`.env.docker` を削除、`.env.sample` のシークレット値を `<set-per-environment>` に中和。`.gitignore` を `.env*`（`.env.sample` のみ許可）に強化。
- `deploy.values.yaml` は k8s `secretKeyRef` 参照のみ（実値なし）。courseboard 用に secret 名は要改名。
- **courseboard 用の認証値は Ao の Cognito 設定から環境変数で投入**（リポには置かない）。

## 由来
コピー元: `tachyonfield/apps/admin-ui` @ main `b94cfb3a`（2026-07-01 時点最新）。vinext ^0.1.6 / next ^14.2 / next-auth ^5(beta) / urql / Tailwind3 / Radix。

## 稼働チェックリスト（2026-07-06 時点の残依存）

本番 https://courseboard.txcloud.app は認証・全画面レンダリング・CI(ユニットテスト含む)まで完了。
データ表示までの残りは下記 3 点のみ（いずれもプラットフォーム/tachyonfield 側のオペレーション）。

| # | 依存 | 内容 | 解けたら行う courseboard 側の作業 |
|---|------|------|-----------------------------------|
| 1 | 522 恒久対応（方針転換あり 2026-07-06） | 旧: PLT-2442=field-api を hosting tenant 登録（#6379, closed）。新: **Field 関連を tn_01ks18 に集約**（CEO 指示, tachyon-apps#6407）+ fieldadmin 段階カットオーバー (tachyon-apps#6418) + 522 真因調査 (tachyon-apps#6416)。courseboard の扱い（tn_01ks18 へ移すか）は要確認 | 確定後に PR #29 を再構成 or クローズ。検証は https://courseboard.txcloud.app/api/smoke/field-api-subrequest が `ok:true` |
| 2 | 本番 DB migration 適用（〜20260618000000, DDL のみ） | `staff_members.hired_at` 等の不足で `/v1/erp/staff` が 500 | なし（自動で直る）。スタッフ/HRM 画面で確認 |
| 3 | 本番 DB migration 適用（20260627010000〜, PLT-2343 ガードレール=CPO/CEO 承認要） | `golf_courses` 等の golf テーブル群が未作成で golf 拡張 API が 500 | なし（自動で直る）。キャディ配車/コース/予約商品/予算画面で確認 |

補足:
- golf_course 拡張は tenant `tn_01ks18…` で **有効化済み**（2026-07-06, `POST /v1/erp/extensions/golf_course/enable`）。無効化は `/disable` で可逆。
- データ層の疎通はトークン直叩きで検証済み: orders / reservations / purchase-orders / vendors / resources / reservation-types / extensions / extensions-audit = 200。
- 522 の切り分け用診断: courseboard/fieldadmin 両方に `/api/smoke/field-api-subrequest`（public）。
