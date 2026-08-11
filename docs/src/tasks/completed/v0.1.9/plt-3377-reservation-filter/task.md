# キャディ配置を予約 ID で上流絞り込みする

## 概要

予約取り消し時に対象予約のキャディ配置を読む経路で、CourseBoard は Field へ
`caddieProfileId`、`from`、`to` だけを送り、返却後に `reservation_id` を照合している。
Field が既に提供する `reservationId` filter を上流 request に渡し、取得量を予約単位へ縮める。
旧 Field が parameter を無視して全件を返しても別予約を操作しないよう、gateway と usecase の
返却後 filter は残す。

関連: PLT-3377

## fresh `origin/main` の実測

- 基準 commit: `b5b44fc1a46787af8f4183e96b722566d8affa8e`
- issue の記述と異なり、domain の `CaddieAssignmentQuery.reservation_id` は既に
  `Option<ReservationId>` として存在する。
- 予約取り消し usecase は既に `reservation_id: Some(...)` を指定し、返却後にも
  `covers_reservation` で照合している。
- gateway は `reservation_id` を受け取るが Field request へ渡さず、返却後の filter だけを行う。
- 単一予約を目的に配置を取得する呼び出しは予約取り消しの 1 箇所で、既に query 指定済みである。
- 予約 ID を照合する他の 2 箇所は、手動配置時の同日重複確認と自動配置時の全予約・全キャディ負荷計算である。
  どちらも日全体の配置が必要なので、予約単位に絞り込めない。

## スコープ

1. `FieldGolfOpsGateway::list_caddie_assignments` が `reservation_id` を
   `reservationId` query parameter として Field へ送る。
2. 実際に受信した URI を検査し、parameter の欠落を検知する gateway test を追加する。
3. Field が parameter を無視して複数予約を返しても、gateway が対象予約だけを返す契約を test で固定する。
4. 予約取り消し usecase が別予約の配置を更新しない既存 test を維持し、二段目の防御を固定する。

## 非スコープ

- Field API または database の変更
- CourseBoard 公開 HTTP API への `reservationId` parameter 追加
- 日全体の配置を必要とする手動配置・自動配置・給与・推薦経路の query 縮小
- gateway または usecase の返却後 filter 削除

## 完了条件

- [x] Field request の query string に `reservationId` が含まれる。
- [x] Field が filter を無視した応答からも対象予約だけが返る。
- [x] 予約取り消し usecase は別予約の配置を更新しない。
- [x] 対象 test、format、lint、build が成功する。
- [ ] Ready PR の CI が green になる。

## 検証記録

- `cargo +stable test caddie_assignment_query_forwards_reservation_id -- --nocapture`: pass
- `cargo +stable test caddie_assignment_query_filters_locally_when_field_ignores_reservation_id -- --nocapture`: pass
- `cargo +stable test a_caddie_on_another_group_is_left_where_they_are -- --nocapture`: pass
- `cargo +stable fmt -- --check`: pass
- `cargo +stable clippy --all-targets --all-features -- -D warnings`: pass
- `cargo +stable build --all-targets --all-features`: pass
- `cargo +stable test`: 473 pass、72 fail。失敗はすべて test TiDB admin pool への接続 timeout で、
  CI の TiDB service 上で再確認する。
- UI 変更がないため browser verification は対象外。
