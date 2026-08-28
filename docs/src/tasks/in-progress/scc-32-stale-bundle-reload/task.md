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
- 1 回の不一致では判定しない。ベースラインと異なる `src` が **2 回連続**で
  観測されたときだけ新バージョンありと確定する（間に一致が挟まったら
  カウントをリセット）。フェッチ 1 回に 10 秒のタイムアウト（`AbortController`）
  を設け、応答が返らない場合も次のポーリングへ確実に進む。

#### 前提（レビュー指摘への対応）: 部分配信・ロールバック時の誤検知

単発の不一致判定は、ローリング配信の途中で一部のエッジ/インスタンスだけが
新しい `index.html` を返している状態や、デプロイのロールバックで新→旧に
戻る瞬間を「新バージョンが出た」と誤検知し、しかもバナーは一度出ると
消えない（`detected` フラグで以降のポーリングを止める設計）ため、誤検知が
そのまま固定表示され続ける問題があった。2 回連続一致を要求することで、
1 回限りの揺れは吸収できる。

この対策が有効なのは、**現行の Cloudflare Workers Static Assets がアセット
一式を単一デプロイとして原子的に切り替える**（同じデプロイの `index.html` と
その `<script type="module">` が指すハッシュ付きファイルは常に同じ組で
配信される）という前提があるため。将来 axum 埋め込み配信を複数インスタンス
（ロードバランサ配下）へスケールする場合、インスタンスごとに古い/新しい
ビルドが混在したまま長時間並存し得る。その場合は「`src` が変わった」だけ
では新旧の順序を判別できない（ロールバックで旧 `src` に戻ったのか、複数
インスタンスが単に別デプロイを指しているのか区別がつかない）ため、
単調増加するデプロイ識別子（ビルド時刻・デプロイ連番など）を `index.html`
または専用エンドポイントに埋め込み、「新しい」を "異なる" ではなく
"より新しい" で判定する方式に変更する必要がある。

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

- 非モーダルの浮動バナー（画面左下、`position: fixed`）。操作の妨げにならないよう
  クリックを奪わず、既存の `main` 領域のレイアウトを一切動かさない
  （`components/AppShell.tsx` の `Toaster` と同じ思想）。
  - 右下ではなく左下: `Sheet`（`components/Sheet.tsx`、native-ui の
    `Dialog` を右アンカーに寄せたもの）は画面右側全体を覆い、その中の
    `.sticky-submit` は Sheet の下端に張り付く。右下固定だとバナーが
    Sheet の送信バーの真上に重なるため、既存の「ページ再読み込み」トースト
    （`AppShell.tsx` の `position: 'bottom-left'`）と同じ左下に統一した。
  - `z-index: 30`。台帳の右クリックメニュー（`.ledger-context-menu`、60）・
    盤面のみ表示（`.ledger-page.is-board-only`、40）・`Sheet`/`Dialog`
    （native-ui の `z-50`）のいずれよりも低くし、それらが開いている間は
    バナー側が上に乗って操作を奪うことがないようにする。
  - `bottom: calc(16px + env(safe-area-inset-bottom))` でホームインジケータ等の
    セーフエリアを避ける（`.sticky-submit` のモバイル用調整と同じ考え方）。
- 文言: 「新しいバージョンが公開されました。再読み込みすると最新の画面になります。」+
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
- フェッチ 1 回に 10 秒（`CHECK_TIMEOUT_MS`）のタイムアウトを `AbortController`
  で設ける。応答が返らない・ハングしたコネクションが `checking` フラグを
  永久に立てたままにしないため。アンマウント時も進行中のリクエストを
  `abort()` する（画面遷移後にバックグラウンドで応答が返り続けることを防ぐ）。

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

- `desktop/src/lib/newVersion.test.ts`: バージョン差分検知（2 回連続一致で
  確定・間に一致が挟まるとリセット）・変化なし・フェッチ失敗時の非検知・
  タイムアウトで `AbortController` が中断し `checking` が固定されないこと・
  アンマウント時に進行中リクエストを中断すること・`fetch` に `basePath()` と
  `cache: 'no-store'` が渡ること・`visibilitychange` の間隔制御・
  Tauri/`file:` 時のポーリング無効化。
- `desktop/src/components/NewVersionBanner.test.tsx`: バナーの表示・
  再読み込みボタン・閉じるボタンの挙動。
- `desktop/src/i18n/completeness.test.ts`: 既存テストが 3 ロケール同期を検証。
- `npm run type-check` / `npm run test` を通す。

## 検証

- `cd desktop && npm run type-check && npm run test`
- リポジトリ規約: CLAUDE.md 参照。コミットは日本語 conventional commits。
- push / PR 作成はしない。
