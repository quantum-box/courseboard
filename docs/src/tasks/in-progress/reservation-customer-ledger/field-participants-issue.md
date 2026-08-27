# Field 起票案：予約の参加者を汎用 contract として持つ

CourseBoard からは実装せず、Field 側に起票して待つもの（CLAUDE.md の責務分担）。
Linear MCP が未認証のためこのセッションからは起票できないので、本文をここに置く。
そのまま Linear（PLT-…）に貼れる粒度で、ゴルフの語彙は剥がしてある。

## 背景

`reservations` は顧客を 1 人しか持たない（`reservations.customer_id`）。予約を取った
人であって、その予約で実際にサービスを受ける人たちではない。

1 予約に複数人が参加する業種では、この 1 対 1 が「誰が何回来たか」を壊す。予約者に
なった回だけが履歴に残り、同伴者として参加した回は誰の履歴にも載らない。

CourseBoard は参加者を予約の custom fields に自前で持っている
（`golfParty.players[].customerId`）。読み書きはできるが、**Field に検索させられない**。
`GET /v1/erp/reservations?customerId=…` は予約者しか当たらないため、
「この顧客が参加した予約」を引く方法が無い。custom fields を全件走査するしかないが、
`/v1/erp/reservations` は limit を黙って 500 に丸め総数も返さないので、
数年分の予約表に対しては静かに欠ける。

## 求める contract

業種非依存の「予約の参加者」。ゴルフに限らず、レッスン・診療・ツアー・会議室で
同じ形が要る。

- `reservation_participants`（予約 1 : 参加者 N）
  - `reservation_id`
  - `customer_id`（nullable。名前だけで受けた同伴者は顧客レコードを持たない）
  - `display_name`（nullable。`customer_id` が無いときの表示名）
  - 並び順
- `GET /v1/erp/reservations?participantCustomerId={id}` — その顧客が
  **参加者として含まれる**予約を返す。既存の `customerId`（予約者）とは別のパラメータ。
  両方指定されたら OR ではなく AND で解釈する（曖昧さを残さない）
- 一覧の総数。`items` だけでは「まだ後ろがあるか」がクライアントから判定できない。
  `total` か、せめて `hasMore` が要る

## 求めないもの

- 参加者に対する課金・請求の按分。CourseBoard は求めていない
- 参加者ごとの status。来た / 来ないは予約単位で足りる
- ゴルフの語彙（組、プレイヤー、キャディ付き）。それは CourseBoard が
  この汎用構造に与える意味であって、Field に入れるものではない（ADR-0005）

## Field が入るまでの CourseBoard 側

`GET /v1/course/customers/{id}/visits` は「その顧客の名前で取った予約」だけを返す。
画面はそう明示していて、空欄を「来たことがない」と読ませない。参加者検索が入ったら
この usecase に 2 本目の読みを足して統合する。
