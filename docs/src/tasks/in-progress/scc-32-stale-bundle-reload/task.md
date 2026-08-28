# SCC-32: 旧バンドルが動き続ける問題への新バージョン検知バナー

Linear: SCC-32

## 背景

受付端末は予約台帳などを長時間（日をまたぐことも）開きっぱなしで運用する。
CourseBoard の SPA は Cloudflare Workers Static Assets（`desktop/wrangler.toml`、
`not_found_handling = "single-page-application"`）または axum 埋め込み配信で、
デプロイのたびに Vite がハッシュ付きファイル名で新しい JS バンドルを生成する
（`desktop/vite.config.ts`）。ページを開いたまま新しいデプロイが行われても、
すでに読み込み済みのタブは古いバンドルのまま動き続け、SCC-27 で撤去した
はずの予約ブロックのような修正済みの挙動が残り続ける。

## 検知方式の選定

**採用: `index.html` の定期ポーリング + 現在読み込み中の module script の `src` 比較**

- ページ読み込み時に、DOM 上の `<script type="module">` の `src`
  （Vite がビルド時に埋め込むコンテンツハッシュ付きファイル名、例:
  `/assets/app-C9x2Kq.js`）を「現在動いているバンドルの識別子」として保持する。
- 数分おきに `fetch(basePath, { cache: 'no-store' })` で `index.html` を
  取り直し、レスポンス中の同じ `<script type="module">` の `src` を正規表現で
  抜き出して比較する。値が変われば新しいデプロイが起きたと判定し、
  非モーダルバナーを表示する。
- `not_found_handling = "single-page-application"` により、ルートパス
  （Workers では `/`、axum 埋め込みでは `/ui/` = `BASE_URL`）への GET は
  常にそのデプロイの `index.html` を返す。これは既存の SPA フォールバック
  設定そのものなので、検知のために新しいサーバ側の仕組みを何も追加しない。

### 検討した代替案と不採用の理由

1. **専用の `version.json` をビルド時に生成してポーリングする。**
   ビルドスクリプト（`package.json` の `build`）に生成ステップを追加する
   必要があり、CI/デプロイ環境で git sha 等が確実に取れる保証がない。
   `index.html` 自体がすでに Vite のコンテンツハッシュを含んでいるため、
   同じ情報をもう一箇所に複製するだけで検知の正しさは変わらない。
2. **`/healthz`（course-api）をポーリングする。**
   `readinessProof: /healthz` は course-api（Rust/Lambda）のヘルスチェックで、
   フロントの静的配信（`courseboard` Worker）とはデプロイ単位が別（同じ
   `tachyon.yaml` 内でも別 app）。API が健全でもフロントの静的アセットが
   更新されたとは限らず、逆もあり得るため、SPA バンドルの新旧判定には使えない。
3. **Service Worker で `skipWaiting` + `controllerchange` を使う。**
   確実だが、キャッシュ戦略・更新ライフサイクル・オフライン挙動まで
   巻き込む大掛かりな変更になる。タスクの指示どおり今回は見送る。

### ポーリング対象外にするケース

- Tauri（`'__TAURI_INTERNALS__' in window`）および `file://` 起動時
  （`desktop/src/lib/router.ts` の `usesHashLocation` と同じ判定）は
  `index.html` をディスクから読み込んでおり、サーバへの再フェッチ自体に
  意味がない。加えてデスクトップアプリは `scripts/create-updater-manifest.mjs`
  による別の更新経路をすでに持つため、この検知はブラウザ配信
  （Cloudflare Workers / axum 埋め込み）専用とする。

## UI

- 非モーダルの浮動バナー（画面右下、`position: fixed`）。操作の妨げにならないよう
  クリックを奪わず、既存の `main` 領域のレイアウトを一切動かさない
  （`components/AppShell.tsx` の `Toaster` と同じ思想）。
- 文言: 「新しいバージョンがあります。再読み込みしてください。」+
  再読み込みボタン（`window.location.reload()`）+ 閉じるボタン（今回のセッション
  中だけ非表示。ポーリングの検知状態自体は保持するので、次にタブを見せたときの
  UX に影響しない）。
- i18n: `common:newVersion.*` を ja / ja-plain / en の 3 ロケールへ同期追加
  （`src/i18n/completeness.test.ts` の既存カバレッジで検証される）。

## ポーリング間隔・負荷配慮

- 既定 5 分間隔（`NEW_VERSION_POLL_INTERVAL_MS`）。
- タブがバックグラウンドの間は `setInterval` は動き続けるが、フェッチ自体は
  タブが `visible` に戻ったタイミングでも追加で 1 回発火させ、長時間放置後に
  すぐ検知できるようにする。ただし直近のチェックから間隔が短い場合は
  スキップし、タブの可視性が頻繁に切り替わっても連打しない。
- 新バージョンを一度検知したら、以降のポーリングは止める（同じ判定を
  繰り返す意味がないため）。
- フェッチ失敗（オフライン等）は「新バージョンあり」と誤判定しない。次回の
  ポーリングまで静かに待つ。

## 実装ファイル

- `desktop/src/lib/router.ts`: `basePath()` を export（Workers/axum 埋め込みの
  両方でマウント位置を合わせるため既存ロジックを再利用）。
- `desktop/src/lib/newVersion.ts`（新規）: `useNewVersionAvailable()` フック。
- `desktop/src/components/NewVersionBanner.tsx`（新規）: バナー本体。
- `desktop/src/components/AppShell.tsx`: バナーをマウント。
- `desktop/src/i18n/locales/{ja,ja-plain,en}/common.ts`: `newVersion.*` 追加。
- `desktop/src/styles.css`: `.new-version-banner` 系スタイル追加。

## ADR-0004 との関係

ADR-0004 は「UI の fetch は `desktop/src/api.ts` 経由」とし、対象は
platform API（tachyon-api / field-api）・courseboard-api への直接アクセスを
禁止するもの（UI の接続先を Cognito と courseboard-api の 2 つに固定する決定）。
今回の `fetch` は同一オリジンの自分自身の静的アセット（`index.html`）を
取得するだけで、`api.ts` が仲介する認可・bearer 委譲・テナントヘッダ付与の
対象である課金 API/業務 API のいずれにも該当しない。したがって `api.ts` を
経由せず素の `fetch` を使う。

## テスト

- `desktop/src/lib/newVersion.test.ts`（新規）: バージョン差分検知・
  変化なし・フェッチ失敗時の非検知・Tauri/`file:` 時のポーリング無効化。
- `desktop/src/components/NewVersionBanner.test.tsx`（新規、必要なら）:
  バナーの表示・再読み込みボタン・閉じるボタンの挙動。
- `desktop/src/i18n/completeness.test.ts`: 既存テストが 3 ロケール同期を検証。
- `npm run type-check` / `npm run test` を通す。

## 検証

- `cd desktop && npm run type-check && npm run test`
- リポジトリ規約: CLAUDE.md 参照。コミットは日本語 conventional commits。
- push / PR 作成はしない。
