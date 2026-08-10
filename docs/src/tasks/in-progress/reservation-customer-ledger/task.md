# 予約を顧客台帳に紐付ける

## Links

- [設計](./design.md)
- [PLT-3358](https://linear.app/issue/PLT-3358)

## 状態

PLT-3358 は Done（tachyonfield #989）。email 任意の顧客登録と、名前・かな・電話での
部分一致検索が Field に入ったため blocker は解けた。

CourseBoard 側は Phase 1〜3（台帳・組の全員・会員種別）を実装済み。Phase 4（来場履歴と
顧客カルテ）は未着手。

## Plan

- [x] 現状の顧客表現（`customerName` と `golfParty.players[].name`）と Field の
  `commerce_customers` / membership registry / `reservations.customer_id` を調べる。
- [x] Field 側のギャップを業種非依存の contract として PLT-3358 に起票する。
- [x] PLT-3358 の完了を確認し、`/v1/storekit/customers` の contract を読み取る。
- [x] `Customer` / `NewCustomer` / `CustomerSearchQuery` と `CustomerGateway` を足す。
- [x] `FieldCustomerGateway` で `/v1/storekit/customers` を読み書きする。
- [x] `GET/POST /v1/course/customers` を生やす。
- [x] 予約作成で `customerId` を Field へ送る。
- [x] `golfParty.players[]` に `customerId` を足し、組の全員を台帳に紐付ける。
- [x] 顧客検索・その場登録の UI（`CustomerPicker`）を代表者と各プレイヤーに置く。
- [x] 会員種別を `MembershipGateway` として繋ぎ、`/v1/course/membership-plans` と
  `/v1/course/customers/{id}/membership` を生やす。
- [x] 設定画面に会員種別の一覧・追加・編集を置く。
- [x] 顧客を選んだときに会員 / ビジターを表示し、その場で会員種別を付与できるようにする。
- [x] 請求先が顧客と分けて持てないことを PLT-3373 に、`commerce_customers` の改名を
  PLT-3375 に起票する。
- [ ] prod Field API に対して疎通を確認する（顧客登録・会員付与は実データを作るため要判断）。
- [ ] PLT-3375 deploy 後、`/v1/storekit/customers` の扱いが決まったら gateway を追従させる。
- [ ] PLT-3373 deploy 後、月次精算を請求先単位で締める形に広げる。
- [ ] 顧客ごとの来場履歴を `ReservationFilter.customer_id` で引いて表示する。
- [ ] 会員種別を料金シミュレーターに繋ぐ（いまは表示のみ）。
- [ ] 会員番号を `customer_credentials` に移す。

## 実装メモ

- 顧客の同一性判定は Field に委ねず、候補提示に留めている。Field も自動マージしない。
  同名別人・同一世帯の電話番号があるため、確定は受付の操作に残す。
- 紐付けは必須にしていない。名前だけの予約は従来どおり保存でき、`customerId` が
  無い予約・プレイヤーは「まだ特定していない」として読む。
- Field は email 未取得を空文字で返す（SDK 互換のため）。gateway で `None` に
  正規化しており、ドメインから上には空文字が漏れない。
- 名前を編集すると紐付けは外れる。前の名前に対する同一性を新しい名前に引き継ぐと、
  別人の来場履歴が付く。

## Non-goals

- CourseBoard DB への顧客テーブル追加。
- 会員の入退会フローと年会費請求。
- 顧客の自動マージと、既存予約の遡及的な名寄せ。
