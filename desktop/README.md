# Course Board native frontend

Course Board のゴルフ運用とキャンセル料請求を、1つの React 19 + Vite アプリとして提供します。
同じ `dist/` を Web、Tauri desktop、Tauri iOS / Android で利用します。UI コンポーネントは
[`@tachyon-sdk/native-ui`](https://github.com/quantum-box/native-ui) の固定 revision を使用します。

## 対象機能

- ゴルフアプリ: Extension 状態と各運用画面への入口
- コース管理: 一覧、作成、編集、削除、営業時間、ホール数、スタート間隔
- ゴルフ予約商品: Extension config、商品、曜日別 slot、キャディ供給量の反映
- キャディ管理: 配車、プロフィール、staff 紐付け、勤怠、推薦、自動割当、所属コース、
  稼働希望、評価、給与、CSV
- 予算マスタ: 日別予算、達成状況、CSV import
- 予約ポリシー: 受付制御、セルフ枠、客単価判断
- 月次精算: KPI、CSV、未収キャンセル料、Square invoice 発行
- キャンセル料: 一覧、集計、請求作成、Stripe link、メール / SMS、同意確認、再送、入金確認
- コースマップ: Tauri desktop のローカルカート simulator。Vite のみの開発時は
  ブラウザ側モックへフォールバック（`VITE_COURSEBOARD_MOCK_DATA` と同じゲート）
- 公開支払い: `/#/pay/{token}` の Stripe Payment Element（既存リンク互換）

## セットアップ

```bash
cd desktop
npm install
```

`native-ui` は npm publish 版ではなく、`package.json` で GitHub revision を固定しています。

## Web

### Happy path（モック UI）

ゴルフ運用画面（タイムライン・コース・キャディ・予約商品・設定関連）をすぐ見るなら、
クライアント fixture だけで十分です。Rust API は不要です。

```bash
cd desktop
VITE_COURSEBOARD_AUTH_MODE=development \
VITE_COURSEBOARD_API_BEARER=local-dev-token \
VITE_COURSEBOARD_TENANT_ID=courseboard_id \
VITE_COURSEBOARD_MOCK_DATA=true \
npm run dev -- --host 127.0.0.1
```

開く URL: `http://127.0.0.1:5173/#/golf/timeline`

`VITE_COURSEBOARD_AUTH_MODE=development` では、Field / course-api 参照もデフォルトで
クライアント側 fixture に短絡します（`VITE_COURSEBOARD_MOCK_DATA` 未指定時も ON）。
コースマップは Tauri の `ws://127.0.0.1:9001` が無いときもブラウザ側モックで動きます。

### Live local（Rust course-api）

ローカルの course-api は **常に Field に接続**します。`TACHYON_FIELD_API_URL` 未設定時は
production（`https://tachyon-field-api.txcloud.app`）が使われます。
`empty://local`（空リストショートカット）は通常起動では使いません。

推奨（mise）:

ローカル補助スクリプトは `desktop/scripts/` に集約しています。

- env 生成: `node scripts/configure.mjs <auth|pkce|field|prod-api|prod-api-pkce>`（npm alias: `pkce:env` / `prod-api:pkce-env` など）
- 起動: `desktop/scripts/dev.sh <pkce|field|prod-api> [api|vite|both]`（mise task 名はそのまま）

```bash
# 初回 / bacon 未導入時
mise install

# terminal 1 — env 生成（初回 / public client・OIDC audience 更新時）
mise run courseboard:pkce-env

# terminal 1 — course-api :8080（bacon job `api` で Rust 保存時に rebuild+restart）
mise run courseboard:api

# terminal 2 — Vite :5173（既存の Vite HMR）
mise run courseboard:vite
```

`courseboard:api` は `.env.browser-pkce` を読み、`COURSEBOARD_DEV_BEARER_TOKEN` を空にしたうえで
`bacon api` を起動します（設定はリポジトリ直下の `bacon.toml`）。
すでに素の `cargo run` で API を動かしている場合は一度止めて、`mise run courseboard:api` に切り替えてください
（旧プロセスには hot reload は効きません）。watch なしで一度だけ起動する場合は
`mise run courseboard:api-once` です。

CLI JWT shortcut（ログイン UI なし）: `mise run courseboard:field-env` のあと
`mise run courseboard:field-api` / `mise run courseboard:field-vite`。

Vite は `/v1/course/*` と `/field-api/*` を `http://127.0.0.1:8080` へ proxy します。
別 upstream を使う場合は `VITE_DEV_API_PROXY_TARGET` を指定します。

実データには有効な JWT と `tn_…` テナントが必要です。オフライン UI だけならモック
（`VITE_COURSEBOARD_MOCK_DATA=true`）を使ってください。

### Local Vite → production courseboard-api

ローカルの Vite (:5173) だけを動かし、course-api をデプロイ済み本番
(`https://courseboard-api.txcloud.app`) に向けます。**local :8080 は不要**です。
`desktop/.env.local`（browser-pkce）は書き換えません。オーバーレイ
`desktop/.env.prod-api.local` を使います。

#### 推奨: Reactパスワードログイン（実ユーザー）

platform-uiのTauriアプリと同じReactフォームからTachyon User Poolへログインします。

```bash
# 1) JSON PKCE overlay（.env.local は触らない）
mise run courseboard:prod-api-pkce-env
# 別 tenant: cd desktop && npm run configure -- prod-api-pkce --tenant-id tn_01…

# 2) courseboard-apiをapi.n1.tachy.one issuerと表示されたclient idでredeploy

# 3) 既存の Vite (:5173) を自分で止めてから再起動
#    （エージェントは :5173 を kill しません）
mise run courseboard:vite-prod-api
```

開く URL: `http://127.0.0.1:5173`。React内のユーザー名・パスワード欄から
ログインし、表示名が実ユーザー（**Local operatorではない**）になることを確認します。

Redirect URI（クライアント登録必須）: `http://127.0.0.1:5173/oauth/callback`

- Manifest: `.tachyon/manifests/courseboard-local-prod-pkce-oauth-client.yaml`
- または Tachyonコンソールでpublic client
  `courseboard-local-prod-pkce` に上記 redirect を追加

#### 代替: CLI JWT（Local operator）

```bash
mise run courseboard:prod-api-env
mise run courseboard:vite-prod-api
```

`AUTH_MODE=development` + CLI Cognito JWT。UI は **Local operator** と表示されます。
JWT は約1時間で切れるので `prod-api:env` を再実行してください。

要点:

- Reactは`VITE_COURSEBOARD_API_BASE_URL`の本番`courseboard-api`を直接呼びます。
  Vite/Next.jsのBFFは使いません。
- 本番course-apiのOIDCは`https://api.n1.tachy.one`、`EXPECTED_AUDIENCE`と
  `EXPECTED_CLIENT_ID`は`courseboard-local-prod-pkce`のpublic client IDです。
- Cognito Hosted UI、Auth.js、外部browser redirectは使用しません。
- そのデプロイの Field upstream は本番 Field です（local Field ではありません）。
- `courseboard-api`は`http://127.0.0.1:5173`と本番Web originへCORSを許可します。
- `/healthz` が 200 でも `/v1/course/*` が Cloudflare 502、または
  `/field-api/*` が `TACHYON_FIELD_API_URL is invalid` になる場合は、
  **ローカル設定ではなく本番 courseboard-api デプロイ側**の問題です。

テンプレート: `desktop/env.prod-api.local.example`

### Live local → production Field（推奨・browser-pkce）

ローカルの course-api (:8080) と Vite (:5173) を本番 Field
(`https://tachyon-field-api.txcloud.app`) に繋ぎ、**実ユーザーでログイン**する手順です。
**Auth.js / Cognito Hosted UI / 旧`web-host` (:3001) は削除済みです。**

platform-ui と同じ Tachyon JSON PKCE です（ADR-0022）:

```
UI password form
  → POST https://api.n1.tachy.one/oauth2/login          (session_token)
  → POST https://api.n1.tachy.one/oauth2/authorize      (JSON + PKCE, no redirect)
  → POST https://api.n1.tachy.one/oauth2/token          (access + refresh)
  → GET  https://api.n1.tachy.one/v1/me
  → Authorization: Bearer <Tachyon access> を local course-api へ
  → course-api が OIDC (iss=https://api.n1.tachy.one) で検証
  → 同じ inbound bearer を prod Field へ転送（CLI Cognito dual-token なし）
```

Field の `verify_user` は Tachyon Auth `POST /auth/v1beta/verify` に委譲します。
Auth 側が Tachyon 発行 OAuth access token（`iss=api.n1.tachy.one`）を受け付ける必要が
あります（`/v1/me` と同じ順序）。セッション切れは UI で再ログインしてください。
`TACHYON_FIELD_API_BEARER_TOKEN` / 毎時の `api-refresh` は不要です。

```bash
# 0) Tachyon CLI にログイン済みであること（初回の public client 作成用のみ）
tachyon auth login --profile admin

# 1) gitignored env を生成（prod Field URL + OIDC audience。CLI Field bearer は書かない）
mise run courseboard:pkce-env
# 別 tenant: cd desktop && npm run configure -- pkce --tenant-id tn_01…

# 2) course-api :8080 — bacon hot-reload（OIDC inbound、prod Field outbound）
mise run courseboard:api

# 3) Vite :5173
mise run courseboard:vite
```


開く URL: `http://127.0.0.1:5173`

ログイン画面で Tachyon User Pool の username / password を入力します。
テナントは `/v1/me` の一覧から選びます（`tn_…`。ローカルデモ用 `courseboard_id` は不可）。

登録必須の redirect URI（JSON authorize ではリダイレクトしませんが完全一致が必要）:

`http://127.0.0.1:5173/oauth/callback`

public client 名: `courseboard-local-pkce`（`npm run pkce:env` が作成/再利用）

重要:

- Vite は `/v1/course/*` と `/field-api/*` を **local course-api (:8080)** へ proxy します。
- course-api は inbound の `Authorization`（ログイン token）+ `x-operator-id` を Field へ転送します。
- `OIDC_ISSUER_URL=https://api.n1.tachy.one` + `EXPECTED_AUDIENCE=<public client id>` で
  Tachyon `/oauth2/token` の access token（`iss`/`aud`）を検証します。Cognito issuer では検証できません。
- Field / Tachyon Auth がログイン token を拒否すると、course-api は **502** を返します
  （401 をそのまま返さないので UI はセッション失効でログアウトしません）。再ログインしてください。
- `TACHYON_FIELD_API_BEARER_TOKEN` は任意の静的 override（admin/service）のみ。browser-pkce では不要です。
- ルート `.env` に `COURSEBOARD_DEV_BEARER_TOKEN` が残っていると静的 verifier が優先されます。
  `export COURSEBOARD_DEV_BEARER_TOKEN=` で空にしてください。
- 旧`VITE_AUTH_PROXY_TARGET`は使用しません。`npm run pkce:env`は残存値を空にします。

#### CLI JWT shortcut（ログイン UI なし）

パスワードログインなしで Field だけ見る場合:

```bash
mise run courseboard:field-env
mise run courseboard:field-api
mise run courseboard:field-vite
```

`VITE_COURSEBOARD_AUTH_MODE=development` + CLI access token で即 authenticated になります。

#### Tauri認証

Desktop / MobileもWebと同じ`BrowserPkceAdapter`とReactログインフォームを使います。
JSON authorizeは認可codeをresponse bodyで返すため、system browserやdeep linkは使用しません。

## Tauri desktop

```bash
cd desktop
# Prefer field:env first, then:
npm run tauri:dev

# Or explicit local-dev (empty Field / mock-friendly):
VITE_COURSEBOARD_API_BASE_URL=http://127.0.0.1:8080 \
VITE_COURSEBOARD_AUTH_MODE=development \
VITE_COURSEBOARD_API_BEARER=local-dev-token \
npm run tauri:dev

npm run tauri:build
```

desktop だけが `127.0.0.1:9001` のカート位置 simulator を起動します。iOS / Android では
ローカル TCP listener を起動しません。

## Tauri mobile

```bash
cd desktop

# 初回のみ
npm run tauri:ios:init
npm run tauri:android:init

# simulator / device
npm run tauri:ios:dev
npm run tauri:android:dev

# archive / bundle
npm run tauri:ios:build
npm run tauri:android:build
```

iOS は Xcode toolchain、Android は JDK 17、Android SDK / NDK が必要です。生成される
`src-tauri/gen/` は Tauri CLI から再生成できるため gitignore 対象です。

## API と認証

- Web/TauriはReact内でplatform-ui互換のパスワードログイン＋JSON PKCEを実行し、
  `https://api.n1.tachy.one/v1/me`からユーザー・テナント情報を取得します。
- ReactはTachyon Auth access tokenをBearerとして`courseboard-api`へ直接送り、
  `/v1/course/*`、`/field-api/*`、Course Board固有endpointを呼びます。
- Field API が 401 を返した場合は token refresh を1回だけ行い、再度失敗した場合は
  `expired` として logout します。403 は logout せず権限不足画面へ遷移します。
- 未認証、期限切れ、テナント選択、権限不足、認証設定不足を別々の画面として扱います。
- UIは`x-operator-id`と`x-platform-id`を付けて`courseboard-api`の
  制限付き`/field-api/*` proxyを呼びます。proxyは許可済みGolf ERP / invoice endpointだけを転送します。
- `VITE_COURSEBOARD_AUTH_MODE=development` と `VITE_COURSEBOARD_API_BEARER` はローカル開発専用です。
  production bundle に token や client secret を埋め込まないでください。
- Desktop / Mobile / Webは同じpublic clientを使います。Web CryptoでPKCE verifier / challenge / stateを生成し、
  JSON authorizeが返したcodeをpublic clientのtoken endpointへ送ります。client secretは使用しません。
- Native productionも`VITE_COURSEBOARD_API_BASE_URL=https://courseboard-api.txcloud.app`を使います。
  Tachyon Authのauthorization/token endpointは`https://api.n1.tachy.one/oauth2/*`、
  profile endpointは`https://api.n1.tachy.one/v1/me`です。
- 認証画面はReact内に留まり、Cognito Hosted UIやTauri opener/deep-link bridgeは使いません。
- authorization / token / profile endpointを追加するときは、そのHTTPS originを`src-tauri/tauri.conf.json`のCSP
  `connect-src`にも最小範囲で追加してください。

## Checks

```bash
npm run type-check
npm run test
npm run build
npm run tauri:build
```

Android / iOS は、それぞれの toolchain を用意したうえで `tauri:android:build` /
`tauri:ios:build` も実行します。
