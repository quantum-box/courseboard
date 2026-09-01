# Field 起票案: 予約 ID の集合で予約一覧を取得する

## 起票フィールド

- Team: `プラットフォーム事業`
- Priority: `medium`
- Assignee: なし
- Due date: なし
- Title: `reservation list: ids filterで複数予約を一括取得できるようにする`

## Description

### 背景

予約 ID を外部参照として持つ汎用クライアントが、複数の予約詳細をまとめて解決できない。
現在の `GET /v1/erp/reservations` は `customerId`、期間、resource 等では絞れるが、予約 ID の
集合を受け取らない。そのため参照先が N 件あると `GET /v1/erp/reservations/{id}` を N 回
呼ぶ必要がある。

これはゴルフ固有ではない。check-in、通知、請求、外部連携など、予約 ID の集合を後から予約
レコードへ解決するすべての consumer に共通する reservation query capability である。

### 要件

- `GET /v1/erp/reservations` に予約 ID の集合を指定できる filter を追加する。
- 最大 100 ID。空 ID を拒否し、重複を正規化する。
- tenant scope と既存の reservation list authorization を維持する。
- 存在しない ID や参照できない ID は一覧に含めない。入力順への並び替えは consumer 側で
  行えるため、既存一覧の安定した sort contract を維持する。
- repository / SQL は `WHERE id IN (...)` 相当の一括 query とし、handler 内で detail
  repository を ID ごとに呼ばない。
- 既存 filter と併用する場合は AND 条件とする。
- OpenAPI、repository test、API contract testを更新する。

### 受け入れ条件

- 100 ID を指定しても reservation repository query は 1 回である。
- 複数 tenant の ID を混ぜても、要求 tenant 以外の予約を返さない。
- 重複 ID、存在しない ID、空入力、上限超過の挙動が contract test で固定されている。
- 既存の ID filter なしの一覧・ページング・期間絞り込みに回帰がない。

### CourseBoard の利用箇所

`GET /v1/course/customers/{customer_id}/visits` は、顧客が他人の予約に同伴した check-in を
予約 ID から解決する。現在は最大 100 本の detail GET を並列実行している。Field deploy 後、
CourseBoard の `ReservationGateway` を本 filter へ切り替え、1 回の一覧取得にする。
