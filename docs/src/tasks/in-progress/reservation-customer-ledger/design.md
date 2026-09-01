# 予約と顧客台帳の紐付けの設計

## Links

- [taskdoc](./task.md)
- [PLT-3358: commerce customer: email を持たない顧客の登録と、名前・電話での検索に対応する](https://linear.app/issue/PLT-3358)（deploy 済み）
- [PLT-3373: 請求先を顧客と分けて持てるようにする](https://linear.app/issue/PLT-3373)
- [PLT-3375: commerce_customers を customers に改める](https://linear.app/issue/PLT-3375)
- [ADR-0005: CourseBoard と Field の責務分担](../../../architecture/decisions/ADR-0005-golf-domain-ownership.md)

## 目的

来場した人を、会員かビジターかを問わず顧客台帳の 1 行として持ち、予約から参照できる
ようにする。

いま予約に載っている顧客は文字列でしかない。代表者は予約の `customerName`、同伴者は
`golfParty` custom field の `players[].name` で、どちらもフリーテキストである。同じ人が
10 回来場すれば 10 個の独立した文字列になり、次のどれも成立しない。

- 会員が今年何回来場したかを数える
- ビジターの再来場に気づく
- 顧客ごとの客単価やキャンセル履歴を見る
- 会員番号の表記ゆれを名寄せする

## 責務分担

顧客台帳そのものは業種非依存の ERP capability であり、Field が既に持っている。
CourseBoard は台帳を作らず、ゴルフの意味づけだけを持つ。

Field が持つもの:

- `commerce_customers`（`/v1/commerce/customers`）— 顧客台帳の実体
- membership registry（`/v1/erp/membership/customers/{customer_id}`）— 会員プラン、
  プラン割当、資格情報、同意記録
- `reservations.customer_id` と `ReservationFilter.customer_id` — 予約と顧客の紐付け、
  および顧客単位の予約検索

CourseBoard が持つもの:

- 会員種別のゴルフ的解釈（正会員・平日会員・株主会員が、どの時間帯とどの料金で
  予約できるか）
- 会員番号の表示と照合ルール
- 組の中の誰が誰かという構造（`golfParty`）
- 顧客グレード、客単価、来場頻度の判定

CourseBoard の DB に顧客テーブルは作らない。物理的な顧客データは Field に残す。

## データの置き場所

- 顧客の実体: `commerce_customers`。会員もビジターも同じ台帳に載せる。会員かどうかは
  台帳の種別ではなく、membership plan の割当があるかどうかで決まる
- 会員種別: `membership_plans` と `membership_plan_assignments`。正会員・平日会員・
  株主会員を plan として定義する
- 会員番号: `customer_credentials` の `kind = "member_number"`。1 顧客が複数の会員資格を
  持つ場合も表現できる
- 予約の代表者: `reservations.customer_id`
- 組の各プレイヤー: `golfParty` custom field の `players[]` に `customerId` を足す

`golfParty.players[]` は現在 `name` / `tag` / `memberNumber` を持つ。ここに `customerId`
を optional で足し、名前は台帳から解決した表示名の snapshot として残す。台帳側で改名が
あっても過去の予約の見え方が変わらないほうが運用上安全であるため、名前は消さない。

## 紐付けの粒度

代表者だけでなく組の全プレイヤーを台帳に紐付ける。同伴のビジターも顧客であり、
再来場や客単価の対象になる。

- 予約作成時、各プレイヤー行で顧客を検索して選ぶ。該当が無ければその場で新規登録する
- 顧客を選ばずに名前だけ入れることも許す。電話で名前しか聞けていない予約は普通に
  あり、紐付けを必須にすると受付が止まる
- 未紐付けのプレイヤーは後から台帳に結びつけられる。予約は消えないので、精算前まで
  であれば受付が拾える

## Field 側の contract（PLT-3358、解決済み）

起票時点の Field は顧客解決が email に依存しており、電話予約とウォークインの顧客を
台帳に載せられなかった。tachyonfield #989 で次の形に決まった。

- `POST /v1/storekit/customers` の `email` は任意。`name` だけで登録できる
- `name_kana` が追加され、`GET /v1/storekit/customers` は `name`（表記・かなの部分
  一致）、`phone`（記号を無視した部分一致）、`email`（完全一致）で引ける
- 名前でも電話でも自動マージはしない。検索は候補提示に留まり、確定は呼び出し側
- email カラムは `NOT NULL` のまま残り、未取得は空文字で表す（本番マイグレーション
  gate が `NOT NULL → NULL` を destructive として拒否したため additive に倒した）。
  レスポンスの `email` も SDK 互換で必須文字列であり、空文字が「未取得」を意味する

最後の 1 点は上流の符号化都合なので、`FieldCustomerGateway` で `None` に正規化して
ドメインには持ち込まない。ダミー email を発行する回避策は取らない — 台帳の同一性
判定を壊し、後で必ず名寄せの負債になる。

## 経路

UI は Field を直接叩かず CourseBoard API を経由する（ADR-0004）。顧客は生の ERP 行
ではなくゴルフの意味づけを載せる対象なので、汎用 proxy の allowlist に穴を開けるの
ではなく `/v1/course/customers` を置き、gateway が Field の StoreKit 顧客 API に
翻訳する。

- `GET /v1/course/customers?name=&phone=&email=&limit=` → 候補一覧
- `POST /v1/course/customers` → 名前だけで登録
- 予約作成 `POST /v1/course/reservations` の `customerId` → Field の予約 `customerId`
- `golfParty.players[].customerId` → 組の各プレイヤーの台帳 ID

検索は空クエリを 400 で弾く。条件なしの検索はテナントの台帳を丸ごと列挙する形であり、
受付が使う操作ではない。

## Phase

### Phase 1 — 台帳と検索（実装済み）

- 顧客検索・その場登録の UI を CourseBoard に置く。Field admin を開かせない
- 予約作成時に代表者を台帳から選び、`customerId` を Field へ送る

### Phase 2 — 組の全プレイヤー（実装済み）

- `golfParty.players[]` に `customerId` を足す。既存データは `customerId` 無しとして
  読めるので migration は不要
- プレイヤー行に顧客検索を付ける
- 名前を入れた何人が台帳に紐付いたかを編集画面に出す

### Phase 3 — 会員（実装済み）

- 会員種別を Field の `membership_plans` として定義する。名前はテナントが決める
  フリーテキスト（正会員・平日会員・株主会員・法人会員…）。CourseBoard 側で enum に
  しない。次にコースが考える種別を拒否することになる
- 設定画面に会員種別の一覧・追加・編集を置く。販売終了は `active: false` であって
  削除ではない。株主会員の販売をやめても株主会員の会員は存在し続ける
- 顧客を選ぶと会員 / ビジターのバッジを出し、その場で会員種別を付与できる
- **会員かどうかの判定は 1 箇所（`CustomerMembership::is_member`）に置く。** API は
  `isMember` を返し、UI は plan の有無から再導出しない。2 箇所で判定すると必ずずれる

### Phase 4 — 請求先と売掛（PLT-3373 待ち）

ゴルフ場は「プレーするのは個人、請求は所属会社に月末締めの売掛」で回る。予約者と請求先
が別人であり、いまの Field はこれを表現できない。

- `invoices.client_id` は CRM の法人を指す名前だが、実際には予約の `customer_id`、
  無ければ**予約 ID** が入っている。CourseBoard のキャンセル料請求も
  `courseboard:{collection_id}` という合成文字列を入れている
- 結果、同じ会社宛の請求書が毎回別の `client_id` を持ち、`ar_ap_items.counterparty_id`
  も同じ問題を引き継ぐため、相手先別の未収残高が集計できない
- **CourseBoard 側で法人 ID を合成して `client_id` に入れる回避はしない。** いま Field が
  壊れているのとまったく同じことを一段重ねるだけで、移行時に区別できなくなる

PLT-3373 が解けたら、既存の `get_monthly_settlement` を請求先単位で締める形に広げる。

### Phase 5 — 顧客カルテ（実装済み）

- [x] 顧客ごとの来場履歴を `ReservationFilter.customer_id` で引いて表示する。
  `GET /v1/course/customers/{id}/visits`、顧客詳細の「来場履歴」パネル
- [x] 客単価、来場頻度、キャンセル／ノーショー履歴を CourseBoard 側で計算する
- [x] グレード判定。閾値は `golf_customer_grade_rules`（CourseBoard ローカル DB、
  ADR-0009）。`GET/PUT /v1/course/customer-grade-rules` と設定画面の「顧客グレード」
- [x] 会員番号を Field の `customer_credentials` に移した（`kind: member_number`）。
  `PUT /v1/course/customers/{id}/member-number`。顧客詳細でだけ編集できる。
  `golfParty.players[].memberNumber` は台帳未紐付けの行のためのフリーテキストとして残す
- [x] 会員種別ごとの料金。`golf_membership_discounts`（円引き／％引き）と
  `GET/PUT /v1/course/membership-discounts`。料金シミュレーターに会員種別の選択を足した
- [x] 会員種別ごとの予約可能日・時間帯。`golf_membership_play_windows` と
  `GET/PUT /v1/course/membership-play-windows`、設定画面の「会員のプレー可能日」。
  **警告であって拒否ではない**（下記）

### 顧客台帳からの削除

顧客詳細から `DELETE /v1/course/customers/{id}` を呼び、gateway が Field の
`DELETE /v1/storekit/customers/{id}` へ転送する。Field の実装は物理削除ではなく
`active = false` の論理削除で、削除後の顧客は一覧・検索・新しい予約の顧客選択に出ない。
既存予約、来場履歴、CourseBoard が持つ登録経路の記録は消さない。

誤操作を防ぐため、顧客名と影響を確認ダイアログに明記する。認可は既存の
独立action名前空間の `field_extension_golf:ManageCustomers` を usecase 冒頭で要求し、
同じ bearer を Field へ転送する。このactionはField extensionの有効・無効とは無関係。
CourseBoard ローカル DB に復元状態や削除フラグを二重管理しない。復元 API は Field に
存在しないため、本変更の non-goal とする。

読むときの注意が7つある。

- **履歴は予約者としての来場だけ。** Field は予約に顧客を1人しか持たず、
  `golfParty.players[].customerId` で絞ることはできない。他人の組に入って
  毎月来ている常連はここが空になるので、画面は「この顧客の名前で取った予約」だと
  明示する。空欄を「来たことがない」と読ませない
- **打ち切ったら通算だと言わない。** Field の一覧は総数を返さないので、gateway は
  `limit + 1` 件取って「まだ後ろがある」を判定する。打ち切られた場合、集計はその
  ページの範囲であって通算ではなく、初回来場日は返さない（読めていないため）
- **金額 0 は「無料」ではなく「未記録」。** 金額を CourseBoard 側へ通す前
  （PR #277 以前）の予約は 0 で入っている。客単価の分母から外し、除いた件数を
  画面に出す。平均に混ぜると常連の単価が半分に見える
- **集計は通算、表は直近だけ。** 来場回数も客単価も一生分の数字として読まれるので、
  usecase は Field を 500 件ずつページングして最後まで読む（`MAX_VISIT_HISTORY_ROWS`
  = 2000 で打ち切り）。表示だけ直近 50 件に切る。1 ページに収まる顧客は API 1 回で済む
- **グレードは通算でしか判定しない。** 打ち切られたら「判定できません」を返す。
  部分的な履歴で判定すると、いちばん高いグレードになるはずの長年の会員が
  いちばん低く出る。判定結果は 4 値（`graded` / `below_lowest` / `unknown` /
  `not_configured`）で、「クラブがグレードを設定していない」を顧客の属性として
  出さない
- **プレー可能日は警告で、予約は保存する。** 受付は例外を毎週取る（平日会員が土曜に
  ビジター料金で回る、支配人が代理で押さえる）。硬く止めると受付は CourseBoard を
  避けて Field admin で予約を作ることになり、それは CourseBoard が避けるために
  存在している事態そのもの。判定は予約を書いたあとに行い、会員種別の読み取りに
  失敗しても警告を出さない（売れたティータイムを落とさない）。曜日はコースの
  ローカル時刻で見る — JST 土曜 07:00 は UTC では金曜で、UTC で見ると平日会員に
  土曜を許してしまう
- **会員割引はグリーンフィーから引いてから課税する。** ゴルフ場利用税の等級は
  グリーンフィーで決まるので、会員は等級ごと下がることがある。合計から引くと
  会員にビジターの税額を出すことになる

## 会員判定を読むときの注意

`GET /v1/course/customers/{id}/membership` は、顧客に会員記録が無くても 404 ではなく
`isMember: false` を返す。受付は予約する全員についてこれを引くので、会員でないことを
エラーにすると通常の操作に失敗バナーが出続ける。

会員種別の取得は顧客を選んだ後に 1 件だけ引く。検索候補の一覧では引かない。Field の
顧客検索は membership を返さず、候補ごとに引くと N+1 になる。

## Non-goals

- CourseBoard DB への顧客テーブル追加。台帳の実体は Field に置く
- 会員の入退会フローや年会費の請求。membership registry と invoice の領域である
- 顧客の自動マージ。名寄せは候補提示に留め、統合は人が決める
- 既存予約の遡及的な名寄せ。過去のフリーテキストを機械的に顧客へ結びつけない
