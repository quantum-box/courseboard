# 予約を顧客台帳に紐付ける

## Links

- [設計](./design.md)
- [Field 起票案：予約の参加者](./field-participants-issue.md)
- [PLT-3358](https://linear.app/issue/PLT-3358)

## 状態

PLT-3358 は Done（tachyonfield #989）。email 任意の顧客登録と、名前・かな・電話での
部分一致検索が Field に入ったため blocker は解けた。

CourseBoard 側は Phase 1〜3（台帳・組の全員・会員種別）と Phase 5（顧客カルテ）を
実装済み。Phase 5 は来場履歴・集計・グレード判定・会員番号の `customer_credentials`
移設・会員種別ごとの料金割引・プレー可能日まで入った。Phase 4（請求先と売掛）は
PLT-3373 待ち。

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
- [x] prod Field API に対して疎通を確認した（テナント tn_01kxd5…、API :8081 + DB
  courseboard_cust）。顧客一覧・来場履歴・グレード・会員割引・料金計算・会員番号の
  登録／改番／取り消しまで通した。会員番号のテストデータは archive して戻してある。
- [ ] PLT-3375 deploy 後、`/v1/storekit/customers` の扱いが決まったら gateway を追従させる。
- [ ] PLT-3373 deploy 後、月次精算を請求先単位で締める形に広げる。
- [x] 顧客ごとの来場履歴を `ReservationFilter.customer_id` で引いて表示する
- [x] 来場履歴を実 Field API に対して確認した。テナントに予約が1件・customerId 無しの
  ため履歴は空だが、Field が `customerId` と `offset` を実際に絞り込みに使っている
  ことを、フィルタ有無の件数差で確認した（無指定 1 件 / 指定 0 件）。
- [ ] 組のプレイヤーとしての来場も履歴に出す。Field に予約の参加者という概念が無く、
  `customerId` 検索は予約者しか当たらない。起票本文は
  [field-participants-issue.md](./field-participants-issue.md) にある（Linear 未起票）。
- [x] 会員種別を料金シミュレーターに繋ぐ。`golf_membership_discounts` に円引き／％引きを
  持ち、グリーンフィーから引いてから課税する（利用税の等級が変わるため）。
- [x] 会員番号を `customer_credentials` に移す（`kind: member_number`）。
- [x] グレード判定。閾値は `golf_customer_grade_rules`。通算が読めないときは判定しない。
- [x] 会員種別ごとのプレー可能日・時間帯。条件外は警告のみで予約は保存する。
- [ ] 料金シミュレーターの見積もりをモックにも実装する（mock 未対応。実 API では
  ビジター 7,500円→等級A・税400 に対し、正会員は 2,500円→等級D・税200 まで
  確認済み）。
- [ ] プレー可能日の警告を実 Field で確認する（テナントに会員種別が無く、予約作成が
  本番書き込みになるため未実施。ユニットテストとモック UI では確認済み）。

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
