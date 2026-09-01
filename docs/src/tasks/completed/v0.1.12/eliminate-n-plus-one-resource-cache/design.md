# N+1 除去と resource cache の設計

## Links

- [taskdoc](./task.md)
- [ADR-0005: ゴルフドメイン知識は CourseBoard が所有する](../../../../architecture/decisions/ADR-0005-golf-domain-ownership.md)
- [予約と顧客台帳の紐付けの設計](../../../in-progress/reservation-customer-ledger/design.md)
- [ページ遷移キャッシュの設計](../../v0.1.3/cached-page-navigation/design.md)

## Context

顧客一覧は Field の汎用 customer contract を使うが、このレスポンスに membership は含まれない。
現在の UI は表の各行に `MembershipBadge` を置き、`GET
/v1/course/customers/{id}/membership` を表示行数だけ並列実行している。この API は
CourseBoard API から Field membership API へ転送されるため、一覧 1 回を 20 回の上流 I/O で
補う N+1 である。

既存の顧客台帳 DD は、会員情報を顧客選択後に 1 件だけ取得し、検索候補一覧では取得しないと
定めている。既存の `useResource` は tenant / platform scoped のメモリキャッシュを持つが、
`MembershipBadge` は利用しておらず、同一 key の同時 loader も共有していない。

## Goals

- 一覧の件数に比例する API / Field / DB I/O をなくす。
- 再訪時は直近の成功値を即表示し、loading へ戻さない。
- 同一 resource の同時取得を 1 本へまとめる。
- mutation 後の値をキャッシュへ反映し、古い再取得結果で上書きしない。

## Options

### A. CourseBoard API に batch endpoint を追加する

不採用。Field に一括 contract がない状態では、N+1 をブラウザから API サーバーへ移すだけで
上流 I/O は減らない。Field に汎用 batch capability が必要なら別 issue とする。

### B. 顧客一覧から会員列を外し、選択後だけ取得する

採用。既存 DD と Field contract に一致し、一覧の N+1 を発生源からなくす。予約入力で顧客を
選択した後と顧客詳細では単件取得を維持する。

### C. クライアントキャッシュだけを追加する

単独では不採用。再訪時の loading は消せるが、初回の N+1 と background revalidate の N+1 は
残る。B と組み合わせ、正当な単件取得だけをキャッシュする。

## Proposed design

1. 顧客台帳の `membership` column と行ごとの `MembershipBadge` を削除する。
2. `MembershipBadge` は `useResource` を使い、`customer:membership:{customerId}` を cache key
   とする。既存の scope prefix により tenant / platform をまたいで共有しない。
3. 会員付与・会員番号変更の成功レスポンスを `resource.setData` へ渡し、in-flight の古い GET
   より mutation 結果を優先する。
4. 会員種別候補は既存の `membership:plans:active` cache を共有する。
5. `useResource` は scoped cache key ごとに in-flight promise を保持する。同時 mount、Strict
   Mode、複数画面部品が同じ key を要求しても loader は 1 回だけ実行する。
6. promise は成功・失敗のどちらでも in-flight map から外す。成功値だけを既存 LRU cache に
   保存し、失敗をキャッシュしない。
7. 会員種別の作成・更新後は `membership:plans:active` を無効化し、販売中一覧を次回取得する。
8. 監査で別の行単位取得が見つかった場合は、一覧 resource の共有、一括 contract、または一覧
   からの除外の順で判断する。

## 監査で確認した別経路

### 顧客来場履歴の guest reservation

`GetCustomerVisitsUseCase` は check-in が参照する予約 ID を最大 100 件集め、Field の予約詳細を
ID ごとに取得している。Field の予約一覧には ID 集合 filter がないため、CourseBoard だけでは
初回 N+1 を解消できない。ゴルフ文脈を外した `GET /v1/erp/reservations` の汎用 filter として
Field に起票し、deploy 後に `ReservationGateway` を一括取得へ切り替える。プロセス内 cache
だけで初回 N+1 を隠す変更はしない。

### tenant profile の legacy extension source

旧 `/v1/erp/me` 経路は tenant ごとに platform ID を補完するため最大 20 回の operator lookup
を行う。ADR-0011 の policy source は platform `/v1/me` が返す platform ID を使い、この N+1
自体を廃止する。既存の `tenant-selection-policy-check` の rollout 対象であり、切替前の経路へ
短命な別 cache を追加して存続させない。

### 選択済みプレイヤーと書き込み fan-out

予約の選択済みプレイヤーは最大 4 人で、候補一覧ではなく一人を選んだ時点で各人の会員情報を
1 回読む。共有 cache と in-flight dedupe を適用するが、Field の一括 membership filter がない
間は独立した選択操作の取得として維持する。複数顧客登録、複数日の希望保存、assignment 更新は
行ごとの成功・失敗を持つ write contract であり、一覧読み取り N+1 と分けて扱う。

## Error and cache behavior

- cache miss の失敗は従来どおり「確認できませんでした」と表示する。
- cache hit の再検証が失敗しても直近の成功値を表示したままにする。
- logout、tenant 切替、tenant authorization denial は既存どおり全 resource cache を消す。
- 顧客 ID が同じでも tenant / platform が異なれば別 cache entry とする。

## Test plan

- `useResource`: 同じ key の同時 mount は loader 1 回、異なる key は別取得、失敗後は再試行可能。
- `MembershipBadge`: cache hit は loading を表示せず、会員付与・会員番号変更で cache を更新する。
- `CustomersPage`: 100 件の一覧でも membership endpoint を呼ばず、ページ切替でも増えない。
- `MembershipPlansPage`: 保存後に active plans cache を無効化する。
- `npm run type-check` と対象 Vitest。
- production の顧客台帳を再読み込み・ページ切替し、membership GET が 0 本であることを確認する。

## ADR decision

API、DB、provider、認可、ドメイン責務は変更しない。ADR-0005 と既存のキャッシュ設計を実装へ
適用する修正であり、新しい ADR は不要である。
