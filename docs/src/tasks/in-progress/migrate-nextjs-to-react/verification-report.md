# 検証レポート

実施日: 2026-07-20

## 実装結果

- Web Cloud Appを`desktop/`のReact/Vite静的成果物へ変更し、Cloudflare PagesのSPA fallbackを追加した。
- ブラウザ/Tauri認証をplatform-ui互換のReactパスワードフォーム＋Tachyon JSON PKCEへ統一し、Hosted UI adapterを削除した。
- Reactから`courseboard-api`へBearer token付きで直接接続し、本番React originをAPIのCORS allowlistへ追加した。
- Next.js/Vinext/Auth.js/BFFの実装と依存、旧`desktop/web-host/`ディレクトリを削除した。PDF用日本語フォントはReact assetsへ移した。
- `/download`と請求書PDF生成をReactへ移した。PDFは既存の請求データと日本語フォントを使用してブラウザ内で生成する。

## Host-side checks

| 対象 | コマンド | 結果 |
| --- | --- | --- |
| React型 | `npm run type-check` | 成功 |
| React test | `npm test` | 19 files / 118 tests 成功 |
| React production build | `npm run build` | 成功。PDF用dynamic chunkの500 kB警告あり |
| Rust format | `cargo fmt --check` | 成功 |
| Rust test | `cargo test` | 67 testsとdoc testsが成功 |
| Rust lint | `cargo clippy --all-targets --all-features -- -D warnings` | 成功 |
| Docker UI build | `docker build --target ui_builder -t courseboard-ui-check .` | 成功 |
| Manifest parse | Ruby `YAML.load_file` | 成功 |
| Manifest dry-run | `tachyon compute apps apply -f tachyon.yaml --app courseboard --environment preview --dry-run` | 成功 |
| API manifest dry-run | `tachyon compute apps apply -f tachyon.yaml --app courseboard-api --environment preview --dry-run` | 成功 |
| Diff whitespace | `git diff --check` | 成功 |
| Browser QA | headed `agent-browser` CLI（Chromium/CDP） | 実ユーザーのReact内ログイン、施設選択、token claims、実API request、`/download`を確認 |

Tachyon CLIの現在の接続先ではapp一覧が空だったため、両dry-runは既存app更新ではなく`CREATED <new app>`として評価された。manifestの解決確認のみで、applyやdeployは実施していない。

## Live確認

- in-app Browserの利用可能なbrowser一覧は空だったため、ユーザー指定のheaded `agent-browser` CLIでローカルViteを確認した。React内のユーザー名・パスワードフォームから`api.n1.tachy.one`のlogin/authorize/token APIを使い、外部画面へ遷移せず実ユーザーでログインできた。
- 保存tokenはissuer `https://api.n1.tachy.one`、audience `5oafg9ptonbjumdh1pc7khirp1`で、有効なaccess tokenとrefresh tokenを持つことをtoken本体や個人情報を出力せず確認した。profile取得と施設選択も成功した。
- 運用タイムラインは`courseboard-api`へ4本の実リクエストを送信したが、現在の本番APIは新issuer/client verifier設定が未反映のため`401 authorization failed`を返した。manifestとRust側の変更はこのissuer/clientへ更新済みであり、本番apply/deploy後に再確認が必要。
- `/download`はmacOS/Windows配布リンクとrelease metadataリンクを表示し、`/oauth/callback`への直接アクセスもReactへ到達した。未認証画面とダウンロード画面はスクリーンショットでもレイアウトを確認した。
- Cloudflare Pages上のSPA fallbackと、本番`courseboard-api`の新verifierによる200応答はdeploy後に確認する。
- 本番apply、build trigger、deployは実施していない。
