# React/Vite Web配信とcourseboard-api責務分離設計

## 背景

TauriとWebで共有するUIは`desktop/`のReact/Viteに実装済みである。一方、本番Webは`desktop/web-host`のNext.js/Vinext WorkerがReact成果物を内包し、Auth.js、API BFF、PDF生成、静的ページを提供している。この二重構成は認証状態とAPI経路を分岐させ、Tauri/Web間の挙動差とデプロイ依存を増やしている。

## 目標

- TauriとWebが同じReact/Vite成果物を使う。
- Web/Tauri認証をReactパスワードフォーム＋Tachyon JSON PKCEとして完結させる。
- 業務サーバー処理とField APIの制限付きproxyを`courseboard-api`へ集約する。
- フロントエンド配信にNode.js/Next.jsサーバーを要求しない。

## 提案設計

### 配信

`courseboard` Cloud Appは`desktop/`をrootとするVite/Cloudflare Pages appへ変更する。production buildはbase path `/`、Tachyon JSON PKCE、公開client ID、`https://courseboard-api.txcloud.app`をbuild-time公開設定として受け取る。秘密値とOAuth client secretはフロントエンドへ渡さない。

### 認証

Reactはplatform-uiと同じく`/oauth2/login`へユーザー名・パスワードを送り、短期session tokenを受け取る。S256 PKCE challengeとstateを付けたJSON `/oauth2/authorize`で認可codeを取得し、`/oauth2/token`へcode verifierを送る。外部browser redirectとCognito Hosted UIは使用しない。`courseboard-api`は`https://api.n1.tachy.one` issuerとpublic client audienceを検証する。Auth.js cookieとNext.js sessionは使用しない。

### API境界

Reactの保護API base URLは`courseboard-api`のHTTPS originとする。`/v1/course/*`、`/field-api/*`、Course Board固有endpointはすべて同じAPIへ送る。`courseboard-api`は許可されたWeb、Tauri、ローカル開発originへCORS responseを返し、引き続きJWT署名、issuer、client IDを検証する。Field API proxyは既存のpath/method allowlistを変更しない。

### PDFと静的ページ

請求書データは`courseboard-api`の制限付きField proxyから取得する。PDFの描画はReact bundle内の`pdf-lib`で行い、サーバーrouteを廃止する。`/download`はReactのpublic pageとして表示し、認証gateより前で判定する。

## セキュリティ

- ブラウザbundleへCognito client secret、Auth.js secret、API secretを含めない。
- CORSは認証の代替にせず、すべての保護routeでBearer JWT検証を継続する。
- API URLはproductionでHTTPSのみ許可する。
- Field proxyは任意URL/proxyにせず、pathとmethodのallowlistを維持する。
- localStorageのtoken取り扱いは既存BrowserPkceAdapterを継続し、将来のtoken storage強化は別タスクとする。

## 移行

1. Reactをcross-origin API接続対応にし、API CORSを先に検証する。
2. PDFと`/download`をReactへ移す。
3. `tachyon.yaml`の`courseboard` appをVite/Pagesへ変更する。
4. Next.js/Vinext/Auth.js packageとserver routesを削除する。
5. preview buildでReactフォームの実ユーザーログインとAPI bearer forwardingを確認してからproductionへ反映する。

## 代替案

- Next.js Workerを静的配信+BFFとして残す案: 同一origin APIとHttpOnly sessionを維持できるが、Tauri/Webの経路差とサーバー依存が残るため不採用。
- ReactからField APIを直接呼ぶ案: Course BoardのAPI責務とField allowlistをブラウザへ漏らし、API統制が分散するため不採用。
- PDFをRustへ再実装する案: サーバー責務として一貫するが、現行の日本語フォント・テンプレート描画を別ライブラリで再実装するコストが高い。PDFは表示成果物であり、認証済みデータ取得はAPI経由のままReactで描画する。

## 検証

- React単体testでbrowser-pkce mode、cross-origin API URL、PDF生成を確認する。
- Rust testで許可/拒否originとpreflight headerを確認する。
- Vite production build成果物にNext.js server chunkが存在しないことを確認する。
- previewでReactフォームからの実ユーザーログインを確認する。

## 未解決事項

- JSON authorizeはredirectしないが、登録済みredirect URIとrequest値の完全一致を維持する。
- 本番の旧Worker環境変数・secret削除はmanifest reconcile結果をdry-runで確認する。
