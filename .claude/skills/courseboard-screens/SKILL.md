---
name: courseboard-screens
description: CourseBoard の desktop 画面（desktop/src/features/**）を作る・直すときの画面構成の決まり。一覧・詳細・登録シート・戻る導線・空状態・i18n の置き方と、直しやすい間違い。新しい画面を足すとき、既存画面のレイアウトや余白を直すとき、一覧にページャや検索を付けるときに読む。
---

# CourseBoard の画面構成

ゴルフ場の受付が一日中触る業務画面。行の密度と1画面の情報量が優先で、
タッチ向けの余白（44px ターゲット、16px フォント）は当てない。

## 骨格

上部のワークスペースバーが画面名を出す（`AppShell` が担当）。**画面側で見出しを
繰り返さない。** `PageHeader` は旧世代で、残っているのは数画面だけ。

```tsx
<div className="page-stack">
  <Panel title="…" description="…" actions={<Button …/>}>
    …
  </Panel>
</div>
```

- `.page-stack` — 画面の縦積み。`display: flex; flex-direction: column; gap: 12px`
- `.page-narrow` — 読み物系だけ `max-width: 1080px` を足す
- `.page-toolbar` — 右寄せの操作の帯。**ボタン1つのために使わない。**
  ワークスペースバーと最初のパネルの間に空白の帯ができる。1つなら `Panel` の
  `actions` に入れる（[CustomersPage](../../../desktop/src/features/golf/customers/CustomersPage.tsx) がこの形）
- `.toolbar-row` — パネルの中に並べる操作。フィルタが複数あるときはこちら

`.page-stack` は子を stretch するので、**直下に置いたボタンは自動で
`align-self: flex-start`**（styles.css で一括指定済み）。戻るボタンにクラスは要らない。
全幅にしたいボタンだけが自分で `width: 100%` を言う。

## 一覧は DataTable

自前の `ul` を書かない。他画面と列・並べ替え・ページャの見た目が揃わなくなる。

```tsx
<DataTable
  rows={rows}
  columns={columns}          // useMemo。header は t()、cell は ReactNode
  rowKey={row => row.id}
  onRowClick={row => navigate(`golf/customers/${row.id}`)}
  pageSize={20}              // 名簿系はこの刻み
  empty={<EmptyState title="…" description="…" />}
/>
```

- 並べ替えは列に `sortValue` を足したときだけ有効。`cell` は ReactNode なので比較できない
- 値が無いセルは **ダッシュではなく空**。「まだ聞けていない」が普通の状態の項目が多い
- ページングはクライアント側。サーバーから取る件数の上限が実質の天井になるので、
  上限があるなら画面に文言で書く（顧客台帳は「新しく登録した順に100人まで」）
- 検索がサーバー側にあるなら `searchable` は使わない。二重の検索箱になる

## 詳細画面

一覧の下のパネルではなく自分のルートを持つ。リンクで開けて、リロードで生き残る。
先頭に戻るボタン（`<ChevronLeft />` か `<ArrowLeft />` + `t('…:detail.back')`）を
`.page-stack` 直下に置く。

## 登録は Sheet

一覧の脇でさっと足すものは `Sheet`。ルートを増やさない。保存したら
**その場に留まって結果を見せる**。詳細ページへ飛ばすと、戻ったとき一覧が
初期状態になり「保存できていない」ように見える。

## 空・読み込み・失敗

- 空 → `EmptyState`（`DataTable` の `empty` に渡す）
- 読み込み中 → `LoadingState`
- 上流が落ちた → `Notice tone="danger"` を出しつつ**画面は使えるままにする**。
  台帳が読めなくても登録はできる、が受付の要求
- API の失敗は 424 `provider_error` で返る（Cloudflare が 5xx を CORS 無しの HTML に
  差し替えるため）

## i18n

`desktop/src/i18n/locales/ja/*.ts` が原本。`en` と `ja-plain` は `DeepPartial` で、
**キーを足したら3つとも足す**。文言は画面の言葉で書く（「顧客」「予約」「キャディ」）。
数を含む文は `{{count}}` を渡して数字を文言に埋め込まない。

## データの取り方

- fetch は `desktop/src/api.ts` 経由（`courseboardApiJson`）。Tachyon platform API を直接叩かない
- 一覧の再取得は `useResource`、検索は debounce 付きの専用フック
  （[useCustomerSearch](../../../desktop/src/features/golf/customers/useCustomerSearch.ts) が手本。
  世代カウンタで古い応答を捨てている）

## 動作確認

モックだけで済ませない。実 Field のレスポンス形状のズレはモックでは出ない。

```
prod Field API → local courseboard API (:8080) → local UI (:5173)
```

- `cd desktop && npm run pkce:env` … ログイン付き（実ユーザー）。`.env.browser-pkce`
- `cd desktop && npm run field:env` … CLI JWT の近道。JWT は約1時間で失効
- どちらも `DATABASE_URL` が `sqlite://` で書かれる。MySQL/TiDB に直す
  （`mysql://root@127.0.0.1:4000/courseboard_local`）
- 変更後は `npm run type-check` と、触った feature の `vitest`
