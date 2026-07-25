# Desktopタブとアプリ内更新

## 概要

Course BoardのmacOS / Windowsアプリに、複数画面を1つのウインドウ内で扱うタブと、
配布済みバージョンの更新確認・インストール機能を追加する。タブは
`@tachyon-sdk/native-ui`の`MacOSWindowTabs`と標準Tauri child WebView構成を使い、
更新は既存のdesktop release / R2配布経路へTauri updater成果物を追加する。

## Scope

- macOS / Windowsでのタブ追加、切替、終了、`⌘T` / `Ctrl+T`、`⌘W` / `Ctrl+W`。
- routeに連動するタブタイトルと、描画完了後に切り替えるちらつき防止。
- 各タブ内の戻る・進むボタンと、macOS / Windowsのキーボードショートカット。
- ナビゲーションの`⌘/Ctrl+クリック`によるbackground tab表示。
- macOSアプリメニューからの更新確認、確認後のdownload/install/restart。
- desktop releaseでの署名付きupdater artifactとmanifest配布。
- Web、Linux、iOS、Androidの既存単一画面動作は維持する。

## Links

- [設計](./design.md)
- `quantum-box/native-ui/docs/tauri-macos-tabs.md`

## Plan

- [x] native-uiと既存Tauri updater実装を調査する。
- [x] task-local設計に沿ってRust/Tauri shellを実装する。
- [x] React adapterとnative-ui依存を更新する。
- [x] desktop releaseへupdater artifact生成・公開を追加する。
- [x] Rust unit test、frontend test/buildを確認する。
- [ ] 署名済みrelease appでmacOS / Windows操作と実配布endpointを確認する。

## 検証結果

- `npm run type-check`: 成功。
- `npm test -- --run`: 22 files / 127 tests成功。
- `npm run build`: 成功。既存のlarge chunk warningのみ。
- `cargo check --manifest-path src-tauri/Cargo.toml`: 成功。
- `cargo test --manifest-path src-tauri/Cargo.toml --features web-distribution`: 8 tests成功。
- `cargo clippy --manifest-path src-tauri/Cargo.toml --features web-distribution --all-targets -- -D warnings`: 成功。Rust 1.95で顕在化した既存`ws_server.rs`の不要な変換も修正した。
- `npm run tauri:build -- --debug --no-bundle --features web-distribution --config src-tauri/tauri.updater.conf.json`: 成功。updater設定を含むmacOS binaryを生成した。
- `cargo check --target x86_64-pc-windows-msvc`: Windows依存の解決・compileを進め、Course Board build scriptがmacOS host上の`llvm-rc`不足で停止。Windows CI runnerでの最終確認が必要。
- macOS dev appでユーザーがタブ追加・切替、production courseboard-api接続、real-user loginを確認した。
- Computer Use serviceは起動できなかったため、画面操作の自動化はユーザー目視で代替した。

### スキップした確認と理由

- release `.app` / Windows installerのタブ目視操作とupdater smokeは、署名済みの
  protected release buildが必要なためローカルでは未実施。release workflow実行後に確認する。
- `npm run tauri:dev`でmacOSアプリ起動とWebSocket simulatorのlistenを確認したが、
  Computer Use serviceが3回とも`Sky Computer Use service startup request failed`で起動できず、
  CUAによるタブ操作は未実施。dev appは確認後に終了した。

## 完了条件

- macOS / Windows release appでタブ操作時にWindowや白いWebViewが露出しない。
- `Course Board > アップデートを確認…`から最新確認と更新適用ができる。
- 通常のWeb/mobile buildにmacOS専用機能を持ち込まない。

## リスクと残タスク

- release publishには既存のApple署名に加えてTauri updater署名鍵が必要である。
- 実配布endpointを使う更新確認は、署名済みrelease公開後に最終確認する。
