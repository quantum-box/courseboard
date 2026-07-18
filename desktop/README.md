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

先に repository root の Rust API を起動します。

```bash
cargo run -- \
  --dev-bearer-token=local-dev-token \
  --database-url=sqlite:///tmp/courseboard-local.db \
  --public-ui-base-url=http://127.0.0.1:8080/ui/index.html
```

別 terminal で Vite を起動します。

```bash
cd desktop
VITE_COURSEBOARD_AUTH_MODE=development \
VITE_COURSEBOARD_API_BEARER=local-dev-token \
npm run dev
```

`VITE_COURSEBOARD_AUTH_MODE=development` ではユーザー / テナントに加え、Field API の
参照データもクライアント側 fixture でモックします（設定・コース・キャディ・予算・
精算・キャンセル料の一覧など）。コースマップも Tauri の `ws://127.0.0.1:9001`
が無いときはブラウザ側モックでカートを動かします。ローカル Rust API / Tauri
simulator の実データを使う場合は `VITE_COURSEBOARD_MOCK_DATA=false` を付けてください。

Vite は `/field-api/*` を `http://127.0.0.1:8080` へ proxy します。別の API を使う場合は
`VITE_DEV_API_PROXY_TARGET` を指定します。この Rust proxy はローカル開発専用です。

production Web bundle は `desktop/web-host` の build 時に `/courseboard-ui/` へ組み込まれ、
Auth.js と同一 origin で配信されます。既存サイドナビのゴルフ関連7画面とキャンセル料は
`/courseboard-ui/index.html#/*` へ遷移します。

Rust imageの`/ui/index.html#/pay/*`はSMSから開く公開支払い専用です。Docker buildでは
operator routeをAuth.js hostへhard redirectするため、Rust static hostingを第二のoperator Web配布経路にはしません。

既存 Courseboard Web の Auth.js セッションを使って Vite を直接開発する場合は、
`desktop/web-host` を起動したうえで `VITE_AUTH_PROXY_TARGET=http://127.0.0.1:3001` を指定します。

実Tachyon/CognitoアカウントでローカルViteへログインする場合は、secretを持たない
PKCE対応public clientをTachyon Authに登録し、次のように起動します。画面で入力した
ユーザー名とパスワードをTachyon AuthのCognitoログインAPIへ送り、callback URIは
`http://127.0.0.1:5173/oauth/callback`を登録してください。

ログイン済みTachyon CLI profileからpublic clientを取得し、`.env.local`を自動設定できます。

```bash
cd desktop
npm run auth:env
npm run dev -- --host 127.0.0.1
```

別profileを使う場合は`npm run auth:env -- --profile field`、書き込まず確認する場合は
`npm run auth:env -- --dry-run`を使用します。このコマンドはclient secretを取得・保存しません。

```bash
VITE_COURSEBOARD_AUTH_MODE=browser-pkce \
VITE_COURSEBOARD_BROWSER_CLIENT_ID=tachyon_oc_... \
VITE_AUTH_PROXY_TARGET=https://courseboard.txcloud.app \
VITE_DEV_API_PROXY_TARGET=https://courseboard.txcloud.app \
npm run dev -- --host 127.0.0.1
```

パスワードは保存しません。authorization code、access token、refresh tokenはメモリだけに保持され、
client secretは発行・bundleしません。ユーザーとテナントはTachyon Authの`/v1/me`で確認します。
GoogleログインやCognito Managed Loginには依存しません。

## Tauri desktop

```bash
cd desktop
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

- Web は既存の HttpOnly Auth.js session (`/api/auth/session`) を確認してから保護画面を描画し、
  `/api/auth/courseboard-context` から認可済みユーザー・テナント情報だけを取得します。
  Cognito access token はbrowserへ返しません。
- Field API が 401 を返した場合は token refresh を1回だけ行い、再度失敗した場合は
  `expired` として logout します。403 は logout せず権限不足画面へ遷移します。
- 未認証、期限切れ、テナント選択、権限不足、認証設定不足を別々の画面として扱います。
- UI は `x-operator-id` と `x-platform-id` を付けて Course Board BFF の `/field-api/*` を呼びます。
- production の `/field-api/*` BFF はWebのAuth.js cookieまたはNativeのBearerを検証し、
  callerが操作できるテナントをサーバー側で照合します。browser由来のtoken・platform・operator scopeを
  upstreamへ転送せず、認可結果からheaderを作り直したうえで許可済みGolf ERP / invoice endpointだけを転送します。
- `VITE_COURSEBOARD_AUTH_MODE=development` と `VITE_COURSEBOARD_API_BEARER` はローカル開発専用です。
  production bundle に token や client secret を埋め込まないでください。
- Desktop / Mobile は Web 用 confidential client を流用しません。Web CryptoでPKCE verifier / challenge / stateを生成し、
  callbackのredirect URI・10分の有効期限・stateを検証してからpublic clientのtoken endpointへcodeを送ります。
  access token / refresh tokenは永続化せずアプリのメモリだけに保持します。
- Native productionは`VITE_COURSEBOARD_API_BASE_URL=https://courseboard.txcloud.app`を使い、
  Rust proxyではなくWebと同じ認可済みBFFを呼びます。Tachyon Authのauthorization/token endpointは
  `https://api.n1.tachy.one/oauth2/*`、profile BFFは`/api/auth/native-profile`です。
- Tauri opener / deep-link pluginでsystem browserを開き、`courseboard://oauth/callback`を
  Desktop / iOS / AndroidでRust側の受信queueへ渡します。Desktopはsingle-instance連携により、すでに起動中のappへcallbackを転送します。
  OS schemeは`src-tauri/tauri.conf.json`から各bundleへ生成されます。macOSのdevelopment確認はbundleを`/Applications`へinstallして行ってください。
  iOS simulatorは`xcrun simctl openurl booted 'courseboard://oauth/callback?...'`、Android emulatorは
  `adb shell am start -a android.intent.action.VIEW -d 'courseboard://oauth/callback?...' com.quantumbox.courseboard`でscheme受信を確認できます。
  認証以外の外部リンクはRust command `open_external_url`を使い、credentialを含まないHTTPS URLだけをsystem browserへ渡します。
- `.env.example`の`VITE_COURSEBOARD_NATIVE_*`を設定し、public client・profile BFF・deep linkの配備完了後にだけ
  `VITE_COURSEBOARD_NATIVE_DEEP_LINK_READY=true`を設定します。`VITE_COURSEBOARD_NATIVE_CLIENT_SECRET`が存在するbuildは明示的に拒否します。
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
