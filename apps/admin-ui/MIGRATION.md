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
- [ ] **認証を Cognito-only に簡素化**：`src/app/auth.ts` の backend verify (`verifyAccessToken`/`AUTH_BACKEND_API_URL`) と password-session 層を削除。`accessToken` を JWT/セッションに載せるだけにする。
- [ ] **golf だけに間引き**：残すのは「認証 scaffold＋app shell」＋`src/app/(v1)/[tenant]/extensions/golf-course/caddies/*`（配車ボード）と `staff/*`（HRM）。非 golf のルート/feature を削除。
- [ ] **バックエンド向き先**：`TACHYON_FIELD_API_URL` を tachyon-field-api(:50056) に。golf REST(`/v1/erp/extensions/golf-course/*`, `/v1/erp/hrm/*`) は当面 tachyonfield ERP 側にあるのでそこを叩く。将来 courseboard(Rust) に移設。
- [ ] **Cognito 設定（Ao/AWS・1回）**：courseboard フロントの**コールバックURL登録**＋認可コードフロー有効化。courseboard 用の `COGNITO_CLIENT_ID/_SECRET/_ISSUER/_DOMAIN/_REGION`、`AUTH_SECRET`、`AUTH_URL` を環境に設定。
- [x] **デプロイ先決定 → Cloudflare Workers**（tachyonfield `fieldadmin` と同型）。vinext のまま。`tachyon.yaml` に frontend CloudApp `golfadmin` を追加済み・`wrangler.json` の name を `golfadmin` に変更済み。バック=AWS Lambda(既存)／フロント=Cloudflare Workers。build/secret は platform 連携で要検証。
- [ ] **ブランディング/不要物除去**：sentry/photon/その他 Field 固有設定の要否を整理。`public/` の Field アセットも golf 用に差し替え/削減。
- [ ] **ビルド検証**：`npm install` → `npm run build`（この sandbox では未実施）。

## セキュリティ対応済み
- コピーに含まれていた **実シークレットを除去**：`.env.local`・`.env.docker` を削除、`.env.sample` のシークレット値を `<set-per-environment>` に中和。`.gitignore` を `.env*`（`.env.sample` のみ許可）に強化。
- `deploy.values.yaml` は k8s `secretKeyRef` 参照のみ（実値なし）。courseboard 用に secret 名は要改名。
- **courseboard 用の認証値は Ao の Cognito 設定から環境変数で投入**（リポには置かない）。

## 由来
コピー元: `tachyonfield/apps/admin-ui` @ main `b94cfb3a`（2026-07-01 時点最新）。vinext ^0.1.6 / next ^14.2 / next-auth ^5(beta) / urql / Tailwind3 / Radix。
