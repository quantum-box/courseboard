# Desktopタブとアプリ内更新 設計

## 目的

macOS / Windows版Course Boardを、複数の業務画面を並行して保持できるデスクトップアプリにする。
同時に、利用者がアプリメニューから新しい配布版を確認し、その場で更新・再起動できるようにする。

## 設計

### タブ

macOS / WindowsでTauri v2のmultiwebviewを有効にし、native Windowは`main`の1枚を維持する。
初期WebViewを最初のタブとし、追加タブは同じWindowのchild WebViewとして生成する。
Reactは`MacOSWindowTabs`で状態を表示し、Tauri commandで追加、選択、終了、title更新を行う。
Windowsでは通常のnative title barを維持し、traffic light用余白を`0`にしてcontent先頭へ
同じタブコンポーネントを配置する。

新規WebViewは画面外で実サイズのまま描画し、React mount後の2 animation framesをreadyとする。
readyになってから新しいWebViewを表示し、以前のWebViewを隠す。選択中タブを閉じる場合も
後続WebViewを先に表示する。これによりWindow背景やWebViewの白いbacking layerを見せない。

### 更新

updater pluginは`web-distribution` featureに限定する。通常の開発、Web、mobile、他OSのbuildは
従来どおりupdaterを含めない。macOS配布buildだけが署名付き`.app.tar.gz`と`.sig`を生成し、
R2の`/releases/updater/latest.json`を参照する。

アプリメニューのAbout直後に`アップデートを確認…`を配置する。更新があればversionとnotesを
提示し、同意後にdownload/installして再起動する。同時実行は拒否し、手動確認では最新・失敗も
dialogで明示する。

## 代替案

- 複数native Window: 切替時にWindow自体が消えるframeを作りやすいため採用しない。
- React内だけの擬似タブ: 画面状態を分離したWebViewとして保持できず、デスクトップタブの要件を満たさない。
- 起動時の強制更新: 業務開始を阻害するため採用せず、明示的なメニュー操作を入口とする。

## セキュリティと運用

- child WebViewの初期URLはアプリ内pathだけに限定し、外部URLを受け取らない。
- capabilityはmacOS / Windowsとも`main`と`courseboard-tab-*`だけを対象にする。
- updaterは署名検証を必須とし、秘密鍵はGitHub environment secretからbuild時だけ渡す。
- 既存download manifestは維持し、Tauri updater manifestは別URLにする。

## 検証

- Rust: label一意性、ready gate、pending activation、close successor。
- React: route-title mapping、command接続、macOS / Windows以外で非表示。
- build: frontend type/test/build、通常Cargo check、macOS web-distribution Cargo check/test、Windows target check。
- release app: `+`、`⌘T` / `Ctrl+T`、`⌘W` / `Ctrl+W`、切替、長いtitle、更新メニューとdialog。

## ADR

既存のnative-ui標準パターンと現在のR2配布境界を適用する実装であり、新しい長期的な
アーキテクチャ判断は追加しないためADRは作成しない。
