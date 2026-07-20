# 検証レポート

実施日: 2026-07-20〜2026-07-21

## 実装結果

- Web Cloud Appを`desktop/`のReact/Vite静的成果物へ変更し、既存Cloudflare WorkerをStatic Assets専用hostとしてSPA fallbackを設定した。
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
| Worker dry-run | `npx --yes wrangler@4.100.0 deploy --dry-run` | 21 static assets、SPA設定を検証して成功 |

最終確認ではTachyon CLIから既存の`courseboard`/`courseboard-api` appを解決でき、preview applyとproduction dry-runを実施した。

## Live確認

- in-app Browserの利用可能なbrowser一覧は空だったため、ユーザー指定のheaded `agent-browser` CLIでローカルViteを確認した。React内のユーザー名・パスワードフォームから`api.n1.tachy.one`のlogin/authorize/token APIを使い、外部画面へ遷移せず実ユーザーでログインできた。
- 保存tokenはissuer `https://api.n1.tachy.one`、audience `5oafg9ptonbjumdh1pc7khirp1`で、有効なaccess tokenとrefresh tokenを持つことをtoken本体や個人情報を出力せず確認した。profile取得と施設選択も成功した。
- ローカルViteから運用タイムラインを開き、ローカル`courseboard-api`経由で4本の実リクエストを確認した。
- `/download`はmacOS/Windows配布リンクとrelease metadataリンクを表示し、`/oauth/callback`への直接アクセスもReactへ到達した。未認証画面とダウンロード画面はスクリーンショットでもレイアウトを確認した。
- preview applyで既存Worker appをPagesへ変換するとPages projectが存在せずbuild preflightで404になったため、既存app identityを保つWorker Static Assetsへ修正した。
- `courseboard` preview manifest applyとbuild `bld_01ky00ns1zpyv5mt7p529wnh7c`が成功し、`https://feature-nextjs-to-react--courseboard.txcloud.app`でReactログイン画面をheaded確認した。`/oauth/callback`も200で同一SPA HTMLを返した。
- 同preview URLで実ユーザーのReact内ログインと施設選択に成功し、ホーム画面まで到達した。保存JWTはtoken本体を出力せず、issuer `https://api.n1.tachy.one`、audience `5oafg9ptonbjumdh1pc7khirp1`、有効期限内であることを確認した。
- preview frontendはproduction API URLへ接続するため、運用タイムラインの4リクエストはpreview originがproduction APIのCORS allowlist外となりブラウザで遮断された。本番frontend origin `https://courseboard.txcloud.app`はallowlist済みであり、PR番号付きAPI preview aliasまたはmerge後のproduction URLでend-to-endを再確認する。
- `courseboard-api` preview build `bld_01ky00c8waa6bpfx24wt2968zm`と再build `bld_01ky00sz7eyjf8sb3bh6jmnnx7`は成功したが、同branch aliasのdeployment finalizationがlease競合した。PR番号付きpreview aliasで再実行する。
- production dry-runは既存`courseboard`/`courseboard-api` appの更新として成功した。CLIのchange-control approvalはサーバー発行secretではなく、production writeを行う作業者が明示的に渡す空でないローカル確認値で、値はAPIへ送信されない。feature codeが`main`へmergeされる前のproduction applyは新旧build設定が不整合になるため実行せず、production stateは変更していない。
