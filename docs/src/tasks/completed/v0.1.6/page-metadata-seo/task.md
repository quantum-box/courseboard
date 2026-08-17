# ページごとのメタ情報を整える

## 概要

Course Board の React SPA はネイティブアプリのタブ名を画面ごとに更新しているが、ブラウザの `title` と meta 情報は全画面で初期 HTML の `Course Board` のままである。公開ダウンロード画面と、検索対象にすべきでないログイン・業務・個別決済画面を区別し、ルートと言語に追従するメタ情報を一か所で管理する。

## スコープ

- 画面ごとの `title` と `description` を設定する。
- 公開ダウンロード画面に canonical、Open Graph、Twitter Card を設定する。
- 認証画面、業務画面、個別決済画面、404 を `noindex, nofollow` にする。
- crawler 向けに公開範囲を示す `robots.txt` と `sitemap.xml` を追加する。
- ルート遷移と言語変更で古い meta 情報が残らないことを unit test する。

## 対象外

- SSR / SSG や Cloudflare Worker による HTML のルート別生成。
- ページ本文、ナビゲーション、認証、API の変更。
- OGP 専用画像の新規制作。

## 対象

- `desktop/src/App.tsx`
- `desktop/src/components/AppShell.tsx`
- `desktop/src/lib/pageMetadata.ts`
- `desktop/src/i18n/locales/*/download.ts`
- `desktop/vite.config.ts`
- `desktop/download.html`
- `desktop/index.html`
- `desktop/public/robots.txt`
- `desktop/public/sitemap.xml`

Linear issue は未登録。UI のメタ情報だけを変更し、DD / ADR は作成しない。

## 実装

1. ルートを公開・個別決済・認証付き業務画面・404 に分類する。
2. 既存のナビゲーション文言を再利用して、ページタイトルと説明を組み立てる。
3. React のルートと言語変更時に head 要素を同期し、不要になった canonical / OGP を除去する。
4. `/download` 専用 HTML entry と crawler 向け静的ファイルを用意し、保護ルートの SPA fallback は安全な `noindex` の初期値にする。
5. メタ情報の生成と DOM 反映を unit test する。

## 検証

- [x] `cd desktop && npm run type-check`
- [x] `cd desktop && npm run test`（80 files / 693 tests）
- [x] `cd desktop && VITE_BASE_PATH=/ npm run build`
- [x] Playwright MCP で `/download`、`/golf/ledger`、`/pay/:token` の実行後 head を確認する。
- [x] production build の raw HTML で `/download` が indexable、SPA fallback が `noindex` であることを確認する。

## 検証結果

- `/download`: `Course Board をダウンロード`、`index, follow`、本番 canonical、OGP/Twitter 画像を確認。
- `/golf/ledger`: `予約台帳 | Course Board`、ナビゲーション由来の description、`noindex, nofollow, noarchive`、canonical/OGP なしを確認。
- `/pay/:token`: 決済用 title/description、`noindex, nofollow, noarchive`、token を含む canonical/OGP なしを確認。
- `dist/download.html` と `dist/index.html` が別 entry として生成され、JavaScript 実行前から robots 方針が分離されることを確認。
- build の既存 large chunk warning は継続。今回の変更による新規エラーではない。
- Cloudflare へのデプロイと公開 HTTP response の確認は未実施。

## 完了条件

- 全ルートで画面名を含むブラウザタイトルが表示される。
- `/download` だけが indexable で canonical / OGP を持つ。
- 個別決済リンクと認証付き画面が検索対象にならない。
- 遷移と言語変更後も head が現在画面と一致する。

## リスクとフォローアップ

- Cloudflare Static Assets の `html_handling = "auto-trailing-slash"` が `/download` を `download.html` に解決することが前提。ローカル build artifact と preview で確認し、デプロイ後の HTTP response は PR の preview 環境で別途確認する。
