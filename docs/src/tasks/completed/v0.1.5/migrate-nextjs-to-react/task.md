# Next.jsからReact/Viteへの移行

## 概要

Course BoardのTauri UI自体はReact/Viteで実装済みだが、本番Web配信にはNext.js/VinextのWorkerが残り、Auth.js、APIプロキシ、PDF生成を所有している。WebとTauriで同じReactアプリを配信し、認証はplatform-ui互換のReactパスワードフォーム＋Tachyon JSON PKCEへ統一する。業務APIとField APIへのゲートウェイは`courseboard-api`が所有し、フロントエンド用の常駐サーバーを廃止する。

## スコープ

- `desktop/`のReact/ViteアプリをWeb Cloud Appの配信成果物にする。
- ReactからTachyon User PoolのJSON PKCEで取得したBearer tokenを`courseboard-api`へ送る。
- `courseboard-api`に本番Web/Tauri/ローカル開発origin向けCORSを設定する。
- Next.jsのAuth.js、BFF、PDF routeを配信経路から除去する。
- 請求書PDFとダウンロード案内をReact側へ移す。
- `tachyon.yaml`と開発ドキュメントを新しい責務境界へ更新する。

## 対象外

- Tachyon User PoolとOAuth clientの新規作成・変更（既存public clientを再利用する）。
- GitHubリポジトリやCloudflare routeの直接変更。
- Field APIが所有する業務データモデルの変更。

## 対象モジュール

- `desktop/src/`、`desktop/vite.config.ts`、`desktop/package.json`
- `src/lib.rs`
- `tachyon.yaml`
- `desktop/web-host/`の旧Next.js実装

## 関連情報

- Linear issue: なし
- [設計](design.md)
- [ADR-0001: production Cognito client allowlist](../../../../architecture/decisions/ADR-0001-production-cognito-client-allowlist.md)
- [ADR-0002: React SPAとcourseboard-apiを独立配信する](../../../../architecture/decisions/ADR-0002-react-spa-courseboard-api-boundary.md)

## 実装フェーズ

1. [x] React/ViteのWeb build、Reactログイン＋JSON PKCE、API base URLを整備する。
2. [x] Next.jsが担っていたPDF・ダウンロード機能をReactへ移す。
3. [x] `courseboard-api`のCORSを更新する。
4. [x] Cloud App manifestとドキュメントを更新する。
5. [x] Frontend/Rustのformat、lint、型、test、buildを実行する。
6. [x] Cloud Apps previewを反映し、build/live smokeとproduction gateを記録する。

## 検証計画

- React: `npm run type-check`、`npm test`、`npm run build`、`git diff --check`。
- Rust: `cargo fmt --check`、`cargo test`、`cargo clippy --all-targets --all-features -- -D warnings`。
- Manifest: YAML parseと`tachyon compute apps apply ... --dry-run`。
- Browser: headedローカルViteでReactログイン、JSON PKCE、token claims、施設選択、API request先、`/download`、PDF生成を確認する。credentialはユーザーが直接入力し、検証出力へ含めない。

実行結果は[検証レポート](verification-report.md)に記録する。

## 完了条件

- production Web buildにNext.js/Vinext/Auth.jsが含まれない。
- ReactがTachyon JSON PKCEを開始・復元でき、`courseboard-api`へBearer付きで直接接続する。
- `courseboard-api`が許可originのpreflightと実リクエストへ正しいCORS headerを返す。
- 既存の請求書PDFダウンロードとアプリ配布案内がReactで利用できる。
- 選定したhost-side quality checksが成功する。

## リスクとフォローアップ

- Worker Static AssetsのSPA fallbackはpreview deploymentで確認済み。
- 既存OAuth public clientを再利用し、本変更ではprovider設定を操作しない。
- production applyでは作業者がchange-control approval値を明示する。サーバー発行secretではなくCLI内だけで確認されるため、merge後に承認済み作業として同じmanifestを反映する。
- branch名ベースのAPI preview deploymentはLambda alias lease競合が発生したため、PR番号ベースで再実行する。
