# CourseBoard の請求先と法人売掛の連携設計

> 2026-08-11 更新: 本文は PLT-3409 より前の全体設計記録を含む。今回の実装範囲は PLT-3406 の
> 項目 1 だけである。Field の manual invoice typed `billTo` は tachyonfield #1012
> (`45f6428121cbd5c4a75422ecc1cca3320ad8d3a3`) で main に入ったが、production 反映は未確認である。
> 項目 2 / 3 / 4 に関する設計は今回実装しない。

## Links

- [taskdoc](./task.md)
- [PLT-3406](https://linear.app/issue/PLT-3406)
- [PLT-3373](https://linear.app/issue/PLT-3373)
- [tachyonfield #1001](https://github.com/quantum-box/tachyonfield/pull/1001)
- [PLT-3358 の CourseBoard 側設計](../reservation-customer-ledger/design.md)
- [ADR-0005: CourseBoard と Field の責務分担](../../../architecture/decisions/ADR-0005-golf-domain-ownership.md)

## 結論

CourseBoard の予約作成は、すでに Field の admin surface
`POST /v1/erp/reservations` を使っている。顧客台帳だけが
`/v1/storekit/customers` である。そのため今回の surface 選択は、CourseBoard の予約経路を
storefront から admin へ全面変更する話ではない。

実際の選択肢は次の 2 つである。

1. 既存の admin reservation create に `billTo` を同送し、予約と請求先を 1 回の Field request で
   確定する。
2. 予約は請求先なしで作り、別の担当者または後続作業が admin reservation update で `billTo` を
   設定する。

技術的には、顧客と所属が予約時に判明している場合は 1 を主経路にし、2 を訂正・未確定時の
補助経路にするのが最も不整合を少なくできる。ただし、法人売掛を予約受付担当が確定してよいか、
月末の経理担当が証憑を見て確定するかは現場運用であり、最終判断を要する。

データの正本は Field に置く。CourseBoard DB に customer、client、affiliation、bill-to、AR/AP の
複製を作らない。CourseBoard が持つのは次だけである。

- Field の typed contract をゴルフの言葉へ変換する domain / gateway / usecase
- 「プレーする人」「所属会社」「今回の支払者」を選ぶゴルフ場運用 UI
- 後付け案を選ぶ場合に限り、請求先確認待ちを表すゴルフ固有の運用状態
- 月次精算で Field の売掛をどう見せ、何を締めるかというゴルフ固有の workflow

ただし、tachyonfield #1001 は CourseBoard の 4 項目をすべて実装可能にする最終 contract ではない。
手動 invoice の typed input、法人検索、所属変更、invoice から AR/AP への確実な転記、月末時点残高に
不足がある。これらを CourseBoard 独自データで補わず、Field の業種非依存 contract として解く必要が
ある。

## 調査基準と安全境界

調査日は 2026-08-11。CourseBoard は fetch 後の fresh `origin/main`
`75d90463b2cfb22763c138078acc02022a8416a7` を基準にした。専用 branch の HEAD と merge-base は
ともに同 commit で、調査開始時に差分はなかった。

Field は #1001 の merge commit
`ae685723afa26ff64bf78b63598a762444979bdd` のコード、OpenAPI、taskdoc を読んだ。依頼時点では
PLT-3403 の並行 deploy 競合により main deployment が `PreconditionFailedException` で失敗しており、
#1001 の code は production runtime に未到達である。このため runtime 疎通を受け入れ証跡にはしない。

今回、許可された demo tenant / Field Golf Sandbox を含め実データにはアクセスしていない。コードと
contract だけで設計判断に必要な事実を確認できたためである。実顧客 tenant には読み書きとも
アクセスしていない。

## 1. CourseBoard 現行実装の実測

### 1.1 顧客台帳と PLT-3358

PLT-3358 の上に、次がすでに実装されている。

- `FieldCustomerGateway` は `/v1/storekit/customers` を検索・取得・作成する。
- `POST /v1/course/reservations` は optional な `customerId` を受ける。
- 代表者の `customerId` は Field reservation の `customerId` に送る。
- 同伴者は `golfParty.players[].customerId` として reservation custom fields に保存する。
- 予約 editor と組編集に `CustomerPicker` があり、名前だけの予約も引き続き許す。
- 顧客詳細には会員種別を表示・編集するが、所属会社や請求先の UI はない。

予約確定後の `RegisterNamesDialog` は未登録名を顧客台帳へ登録する。プレイヤーは custom fields に
`customerId` を書き戻せるが、代表予約者の `reservations.customer_id` は Field update contract が
受け付けないため、この予約には後付けできない。コード上も PLT-3379 待ちと明記されている。

これは bill-to 後付け案に直結する。法人 bill-to は reservation customer と affiliation の customer が
一致しなければならないため、予約時に代表者を紐付けなかった予約は、台帳登録だけ後から行っても
法人を請求先にできない。

### 1.2 予約 surface

`FieldReservationGateway` の現行経路は次のとおりである。

| CourseBoard 操作 | Field path | surface |
| --- | --- | --- |
| 予約一覧 | `GET /v1/erp/reservations?limit=2000` | admin |
| 予約取得 | `GET /v1/erp/reservations/{id}` | admin |
| 予約作成 | `POST /v1/erp/reservations` | admin |
| プラン・組情報変更 | `PATCH /v1/erp/reservations/{id}` | admin |
| 顧客検索・登録 | `/v1/storekit/customers` | storefront / StoreKit |

予約作成 body は `customerId` までを送るが、`billTo` は domain、HTTP request、gateway body の
いずれにもない。予約 read model も bill-to を decode しない。CourseBoard 上には「請求先」という
概念がまだ存在しない。

したがって、issue にある「CourseBoard は `/v1/storekit/*` を使っている」は顧客台帳については
正しいが、予約作成については fresh `origin/main` と一致しない。storefront schema が `billTo` を
拒否することは重要な security boundary だが、現在の CourseBoard 予約作成を阻む boundary ではない。

### 1.3 invoice の生成・参照

CourseBoard には 3 つの請求経路が残っている。

| 経路 | 生成 / 参照 | 現行の請求先 |
| --- | --- | --- |
| 月次精算の未収キャンセル料 | `POST /v1/erp/reservations/{id}/billing-invoice` | Field が reservation から解決 |
| キャンセル料画面 | `POST /v1/invoices`、`GET/PATCH /v1/invoices*` | 入力 `clientId`。空なら `courseboard:{reference or UUID}` |
| legacy collection API | `POST /cancellation-fee-collections` から Field `POST /v1/invoices` | `courseboard:{reference or collection_id}` |

現在の desktop が使うキャンセル料画面は 2 番目である。3 番目も route と public payment flow が
残っており、呼ばれれば同じ synthetic ID を新規作成する。片方だけ直すと汚染が続く。

`field_proxy` の allowlist は reservation billing invoice と invoice CRUD を許すが、affiliation、
reservation の一般 GET/PATCH、AR/AP balance は許していない。新連携を proxy の prefix 開放で
追加するのではなく、CourseBoard の `/v1/course/*` と専用 gateway を通すべきである。

### 1.4 月次精算

CourseBoard の月次精算は Field の
`GET /v1/erp/extensions/golf-course/monthly-settlement` と CSV export を呼ぶ。取得するのは次である。

- 予約売上、入金、返金、未収額、予約数
- キャディフィー
- 未収キャンセル料
- Square 入金・返金・未照合数
- drilldown 用の reservation ID と未収キャンセル明細

CourseBoard は reservation ID を全予約一覧へ join して、氏名・日時・コースを表示する。画面から
未収キャンセル料 invoice を発行するが、`/v1/erp/ar-ap/balances` は呼ばず、相手先別売掛残高を
domain / API / UI / CSV のどこにも持たない。

また、現行画面が発行するのは未収キャンセル料の reservation invoice である。完了した法人プレーを
月末にまとめて請求する invoice producer は存在しない。typed bill-to を予約に付けるだけでは、
「会社宛の月末請求」は完成しない。

## 2. tachyonfield #1001 の実 contract

### 2.1 affiliation

| API | contract | 追加権限 |
| --- | --- | --- |
| `GET /v1/erp/customer-client-affiliations?customerId=...` | 顧客別一覧 | `field:ListReservations` と `accounting:ListInvoices` |
| `POST /v1/erp/customer-client-affiliations` | 期間付き所属を作成 | `field:ManageReservations` と `accounting:CreateInvoice` |

作成 input は `customerId`、`clientId`、`relationshipType`、`validFrom`、optional `validTo`、optional
`billingAllowed` である。Field は同一 tenant の active customer と非 archive client を検証する。

今回追加されたのは create と customer 別 list だけである。update / close / delete はない。一覧は
`clientId` を返すが client 名や請求連絡先を展開しない。従って「会社を検索して所属を登録し、退職時に
終了日を設定し直す」UI は #1001 の REST contract だけでは作れない。

### 2.2 reservation bill-to

admin の reservation create / update は optional `billTo` を受ける。

```json
{ "kind": "customer", "customerId": "cus_..." }
```

```json
{
  "kind": "client",
  "clientId": "cl_...",
  "affiliationId": "ccaf_..."
}
```

Field の invariant は次のとおりである。

- `customer` は reservation の `customerId` と一致しなければならない。
- `client` は reservation に `customerId` が必要である。
- affiliation の customer / client が request と一致し、両 master が active でなければならない。
- affiliation は reservation 日を tenant timezone に直した日付で有効かつ `billingAllowed` でなければ
  ならない。
- `selectedAt` と `selectedBy` は Field が保存する。
- invoice link 後の bill-to 変更は 409 で拒否する。
- 未発行予約の日付変更は、保存済み affiliation を新日付で再検証する。
- storefront create / update schema は `deny_unknown_fields` で `billTo` を拒否する。
- `billTo` が未指定なら新しい検証を呼ばず、従来の本人宛挙動を維持する。

明示 bill-to のある admin create / update だけ、通常の予約権限に加えて
`accounting:CreateInvoice` を要求する。CourseBoard は inbound bearer を Field にそのまま転送するため、
この差は CourseBoard service の固定権限ではなく、操作している利用者の権限差として現れる。

### 2.3 invoice typed bill-to の境界

reservation billing invoice は、保存済み bill-to が client なら real client の ID・名称・email snapshot と
affiliation evidence を invoice に引き継ぐ。同じ client 宛の複数 invoice は同じ `client_id` と
`bill_to_client_id` を持つ。

#1001 の phase 1 では manual invoice input が未対応だったが、PLT-3409 / tachyonfield #1012 で
`POST /v1/invoices` の `CreateInvoiceRequest` に optional `billTo` が追加された。形は reservation と同じで、
`billTo` があれば `Invoice::create_with_bill_to` を通る。`clientId` は compatibility 用に optional となり、
`billTo` だけの request では typed identity から補われる。`billTo` なしの既存呼び出しは従来挙動を保つ。

今回の CourseBoard 実装では legacy `clientId` を併送せず、2 つのキャンセル料 producer がどちらも
`billTo` を request body に載せる。Field production への #1012 反映確認は merge gate として残す。

### 2.4 AR/AP balance の境界

`GET /v1/erp/ar-ap/balances?as_of=YYYY-MM-DD` は `accounting:GetDashboardSummary` を要求し、
receivable / payable の相手先別 total、settled、outstanding、overdue、件数を返す。

ただし次の制約がある。

- invoice を作っただけでは AR/AP item は自動作成されない。
- `POST /v1/erp/ar-ap/from-invoice/{id}` を別に呼んだときだけ invoice の `client_id` が
  `counterparty_id` へ伝播する。#1001 の regression test もこの関数単位の伝播を保証する。
- balance query は `kind, counterparty_id, counterparty_name` で GROUP BY する。同じ client ID でも
  invoice snapshot の名称が変わると複数行になる。
- `as_of` は `issue_date <= as_of` と overdue 判定には使うが、item の `settled_amount` は現在値である。
  月末後に入金すると過去月末の再表示も変わり得るため、会計上の historical as-of snapshot ではない。
- 最大 500 行で、source type / golf extension / currency の絞り込みを持たない。Field の他用途の売掛を
  CourseBoard 月次精算へ混ぜるかを判断せず、ゴルフ売上に加算してはならない。

よって「balance API を読む」だけでは月次締めは成立しない。invoice から AR/AP へいつ誰が転記するか、
過去月末残高をどう固定するか、CourseBoard に表示すべき source scope を先に決める必要がある。

### 2.5 legacy 原文と resolution

#1001 は `invoice_legacy_bill_to_refs` と `invoice_bill_to_resolutions` の schema、および insert-only
repository を追加した。legacy reference は既存の `client_id`、名称、email と capture metadata を原文の
まま保持する。resolution は解決先の customer / client、actor、理由、証憑、時刻を追記し、訂正時も
先行 resolution を `supersedes_resolution_id` で参照する新 record を append する。

ただし第 1 段階では既存 invoice の capture、再分類、resolution workflow の公開 API を導入していない。
resolution を追加しても invoice 原本と captured raw value を更新しない、という将来 contract の土台だけが
入った状態である。CourseBoard は旧 `courseboard:` 値を名称や prefix から自動解釈せず、既存データの
再分類も今回の scope に入れない。

## 3. surface 選択肢

### 案 A: 予約作成と同時に bill-to を確定する

既存の CourseBoard API request に bill-to 選択を追加し、`NewReservation` と
`FieldReservationGateway::create_reservation` が同じ admin POST に `billTo` を含める。

| 観点 | 評価 |
| --- | --- |
| 整合性 | 予約と請求先を 1 回の Field create で保存できる。途中状態がない |
| invoice 競合 | invoice が先に発行され、後から変更できなくなる事故を避けやすい |
| 受付速度 | 法人検索・所属確認を必須にすると、PLT-3358 が避けた「台帳入力が予約を止める」問題が戻る |
| 権限 | 法人 bill-to 選択時は受付担当にも `accounting:CreateInvoice` が必要。無いと予約自体が 403 になる |
| 未特定客 | `customerId` が無い電話予約では法人を選べない。名前だけの予約は従来どおり bill-to 無しで作る |
| 監査 | 明示選択なら Field の `selectedAt` / `selectedBy` が残る |
| surface | 現在も admin create なので surface 移行は不要。追加権限だけが変わる |

この案を採る場合も、法人選択を全予約の必須操作にはしない。「本人宛（従来どおり）」を既定にし、
法人売掛を希望する予約だけ customer と affiliation を選ぶ。

### 案 B: 予約後に bill-to を設定する

予約は現行どおり bill-to 無しで作り、予約詳細または月次締め前の確認 queue から
`PATCH /v1/erp/reservations/{id}` に `billTo` を送る。

| 観点 | 評価 |
| --- | --- |
| 受付速度 | 枠の確保を請求先確認から切り離せる。権限を受付と経理で分離できる |
| 整合性 | 2 request になり、予約済み・請求先未確認の期間が必ず生じる |
| invoice 競合 | 先に invoice が link されると Field が bill-to 変更を拒否する。締め前の漏れ検知が必須 |
| 未特定客 | 現 contract は reservation `customerId` を後付けできないため、PLT-3379 が解けるまで法人選択不能 |
| 意味の曖昧さ | `billTo = null` は「未確認」ではなく正当な従来 default でもある。値だけでは両者を区別できない |
| 運用状態 | pending / confirmed-personal / confirmed-client と確認者・時刻が別途必要 |
| 権限 | 予約担当は従来権限のまま、後続担当だけ accounting 権限を持てる |

後付け案の運用状態は CourseBoard のゴルフ固有 workflow なので、Field にゴルフ語彙を足さない。
一方、CourseBoard DB に bill-to を複製もしない。必要なら reservation custom fields 内の
CourseBoard-owned namespace に「確認状態・確認者・確認時刻」だけを置き、payer identity は Field の
typed `billTo` だけを正とする。custom fields は全置換 API なので、既存の `golfParty` と
`golfCourseId` を壊さない read-merge-write と競合検知が必要である。

### 推奨する組み合わせ

設計上の推奨は A を主経路、B を補助経路にする hybrid である。

- 予約時に customer と有効な affiliation が判明し、操作権限もある場合は同じ create で確定する。
- 名前だけの電話予約、証憑未確認、経理権限のない担当による予約は従来どおり作成する。
- 後続 queue で customer の紐付けと bill-to を確定する。ただし代表者後付けは PLT-3379 が前提。
- invoice 発行 action は、請求先確認待ちを fail-loud にする。

これを採るか、すべて経理後付けにするかはプロダクト責任者が決める。後付けを選ぶ場合は、運用状態と
締め前 queue を scope から外せない。

## 4. CourseBoard に必要な設計要素

### 4.1 domain と gateway

CourseBoard 内には Field DTO を直接流さず、最低限次を置く。

- `BillToParty = Customer(CustomerId) | Client(ClientId, AffiliationId)`
- `CustomerClientAffiliation` — 期間、relation type、billing 可否
- `AccountsReceivableBalance` — counterparty identity、表示名、残高、延滞額、件数
- affiliation gateway — 顧客別一覧と登録
- reservation gateway — bill-to の read/create/update
- receivable gateway — balance read と、採用時だけ invoice から AR/AP への posting
- client lookup gateway — 法人 ID を人が選べる表示へ変換する

Field が保存する `selectedAt` / `selectedBy`、invoice snapshot、legacy resolution は CourseBoard DB に
コピーしない。CourseBoard の API response に必要な範囲だけ写像する。

### 4.2 CourseBoard API

UI は `desktop/src/api.ts` 経由で、例えば次の CourseBoard API を使う。

- `GET /v1/course/customers/{id}/affiliations`
- `POST /v1/course/customers/{id}/affiliations`
- `PATCH /v1/course/reservations/{id}/bill-to`
- 予約作成 request の optional `billTo`
- `GET /v1/course/monthly-settlement` response 内の独立した `accountsReceivable` section

生の Field proxy に affiliation / AR/AP prefix を開けない。CourseBoard gateway が bearer、
`x-operator-id`、`x-platform-id` を転送し、Field 4xx を利用者が直せる応答へ、上流障害を 424
`provider_error` へ正規化する。

### 4.3 顧客台帳 UI

PLT-3358 でできた顧客詳細ページに「所属・請求先」panel を足すのが自然である。

- 現在と将来・過去の所属、期間、請求可否を表示する。
- 会社名で候補を検索し、client master を選んで affiliation を作る。
- 同名法人を名称だけで同一視しない。real client ID を選択する。
- 予約画面では master を編集せず、登録済み所属から今回の payer を選ぶ。
- 所属の新規登録と、退職・転籍等による期間変更は権限を分けられるようにする。

ただし #1001 REST API は client 名を返さず、client 検索と affiliation update もない。既存 Field GraphQL
client surface を CourseBoard gateway から使うのか、Field に REST の検索・取得と所属終了 API を足すのかを
先に決める。Field UI を利用者に開かせる案は採らない。

### 4.4 予約 UI

予約時に customer が選ばれたら、プレー日で billing eligible な所属を読み、請求先 selector を出す。

- 既定: 「予約者本人（従来どおり）」
- 候補: 有効な所属会社
- 表示: 会社名、relation type、有効期間。内部 ID だけを見せない
- 法人選択: `clientId` と `affiliationId` を組で保持する
- customer 名を編集して紐付けが外れたら、選択中の法人 bill-to も外す
- reservation read model に保存済み bill-to を含め、後編集画面と月次確認から同じ値を見せる

一組の reservation が持てる bill-to は 1 つである。同伴者ごとに別会社へ分割請求する運用があるなら、
#1001 の reservation contract では表現できないため現場確認事項とする。

### 4.5 invoice とキャンセル料

予約に紐づくキャンセル料は、可能な限り Field の reservation billing invoice を唯一の producer に
寄せれば、保存済み typed bill-to を自動で引き継げる。現在の月次精算画面はすでにこの経路である。

一方、キャンセル料画面の direct invoice と legacy collection API は reservation と独立している。
次のどちらかが必要である。

1. reservation ID があるケースを reservation billing invoice へ統合し、独立請求だけを manual invoice に
   残す。
2. Field の direct/manual invoice typed `billTo` input（PLT-3409 / #1012）を使う。

旧 `clientId` へ real client ID を送るだけの実装は行わない。2 producer を同時に `billTo` へ切り替え、
synthetic fallback を削除する。runtime 到達前に merge しないことで contract の deploy 順を守る。

### 4.6 月次精算と売掛

月次精算には、既存のゴルフ KPI と混ぜず「売掛残高」section を追加する。

- 選択月末日を基準日として receivable だけを表示する。
- 相手先 ID、法人名、請求総額、入金額、未収、延滞、件数を表示する。
- invoice / AR/AP posting 失敗または未実行件数を別に表示し、残高 0 を成功と誤認させない。
- CSV も既存 golf settlement CSV に無理に横結合せず、contract が固まるまでは別 section / 別 export とする。
- AR balance を予約売上や未収額へ加算しない。同じ取引の別 projection であり二重計上になる。

「月末締め」が一予約一 invoice の残高集計を指すのか、法人ごとに 1 枚の合算 invoice を発行するのかで
実装は大きく変わる。#1001 が保証するのは複数 invoice が同じ client ID を共有することまでで、月次合算
invoice の生成は提供しない。

## 5. 追加で必要な Field contract

CourseBoard から勝手に Field 実装を書かず、次は業種非依存 contract として Field issue にする。

| 不足 | CourseBoard への影響 |
| --- | --- |
| client の検索・ID 指定取得、または affiliation response の client summary | 会社名で所属を選べない |
| affiliation の終了・訂正 API と競合制御 | 「登録・変更」UI の変更側を作れない |
| reservation update の `customerId`（PLT-3379） | 名前だけで作った予約を後から法人 bill-to にできない |
| ~~manual invoice の typed bill-to create~~ | PLT-3409 / #1012 で解消。今回の項目 1 で利用する |
| invoice 発行から AR/AP item への transactional / retryable projection | balance API が invoice を網羅する保証がない |
| balance の ID 単位 grouping | 同一 client が名称変更で複数行になる |
| settlement 日を考慮した historical as-of | 過去月末残高が後日の入金で変わる |
| source / currency scope | CourseBoard 対象外売掛や異通貨を安全に区別できない |
| 月次合算 invoice contract（現場が合算を選ぶ場合） | 一法人一請求書の月末締めを表現できない |

短期的に CourseBoard が `POST /v1/erp/ar-ap/from-invoice/{id}` を明示的に呼ぶ案は実現可能だが、
invoice 成功・AR posting 失敗という partial failure を持つ。採用するなら source key による retry、未転記一覧、
再実行 action を受け入れ条件にする。推奨は Field の invoice 発行 transaction / outbox から AR/AP へ投影し、
CourseBoard は状態を読み取る形である。

## 6. ゴルフ場の運用導線

### 6.1 予約時に分かる場合

1. 受付が代表者を PLT-3358 の顧客台帳から選ぶ。
2. CourseBoard がプレー日に有効な billing-enabled affiliation を表示する。
3. 受付が「本人」または「会社」を明示選択する。
4. 案 A なら reservation create に同送する。案 B なら予約後 queue に送る。
5. 会社選択は予約詳細と月次精算の対象行に常時表示する。

所属が 1 件だけでも会社宛へ自動選択しない。所属登録によって本人払いの既存挙動を黙って変えないためで
ある。

### 6.2 予約時に分からない場合

名前だけで予約を成立させる従来挙動を守る。その後、次を別作業にする。

1. 顧客の特定または新規登録
2. reservation 代表者への customer ID 後付け
3. 所属会社の登録・証憑確認
4. bill-to の確定

2 は PLT-3379、3 は affiliation update / client lookup contract が前提である。完了まで「請求先未確認」を
見える状態にし、invoice 発行前に止める。名前だけ予約を禁止する回避は取らない。

### 6.3 予約後の変更

- invoice 未発行なら予約詳細から変更できる。
- 日付変更時は Field が affiliation を再検証する。失効なら日付変更と bill-to の再選択を同じ利用者導線で
  解決する。
- invoice link 後は Field が変更を拒否する。誤請求先の訂正は invoice の取消・再発行・credit note の運用で
  あり、reservation だけを書き換えない。
- affiliation がプレー後に終了しても、発行済み invoice の snapshot と reservation 選択を自動変更しない。

### 6.4 月末

1. 対象月の「請求先未確認」「invoice 未発行」「AR 未転記」を 0 件にする。
2. 法人ごとの当月請求または残高を確認する。
3. 現場ルールに従って締め、請求書を送付する。
4. 入金後は AR/AP settlement を記録し、翌月以降の繰越残高へ反映する。

月次画面の既存 checklist に売掛を追加する場合、単に balance row が取得できたことではなく、未確認・
未発行・未転記が 0 件であることを完了条件にする。

## 7. 判断が要る点

### 7.1 プロダクト責任者が決められるもの

1. 案 A、案 B、または A 主経路 + B 補助経路のどれを採るか。
2. 法人 bill-to を選べるのは customer が reservation に紐付いた場合だけ、と明示すること。
3. 後付け案で CourseBoard-owned の請求先確認状態を reservation custom fields に持つこと。
4. 顧客詳細を所属の正規編集場所、予約画面を今回 payer の選択場所にすること。
5. affiliation / AR/AP を生 proxy ではなく CourseBoard domain gateway で公開すること。
6. reservation 由来キャンセル料を billing-invoice に寄せるか、direct invoice を残すか。
7. Field の AR 自動投影を待つか、CourseBoard が暫定的に `from-invoice` を orchestrate するか。
8. balance contract が直るまで、月次精算では参考表示に留めて締め確定機能を作らないこと。

### 7.2 Field 側 issue / contract 判断になるもの

1. client lookup を既存 GraphQL で正式 contract とするか、REST を追加するか。
2. affiliation の終了・訂正を update と append-only history のどちらで表すか。
3. manual invoice typed input と legacy free-text input の廃止順序。
4. invoice → AR/AP を outbox で自動化するか、明示 command の状態を可視化するか。
5. balance を stable identity、settlement date、source、currency でどう query するか。
6. 月次合算 invoice を汎用 invoice capability として提供するか。

### 7.3 現場に聞かないと決まらないもの

1. 所属会社を誰が、どの証憑で、いつ登録・終了するか。受付、会員担当、経理のどこか。
2. 予約受付担当が会社払いを確定してよいか、経理承認が必要か。
3. 本人払いから会社払い、会社払いから本人払いへの override を誰に許すか。
4. 一予約一 invoice を月末にまとめて送るのか、法人ごとに一枚へ合算するのか。
5. 締め日、支払期限、休日調整、締め後訂正、翌月繰越の規則。
6. プレー代、飲食、物販、キャンセル料を同じ請求書に載せるか分けるか。
7. 一組を一社へ請求するだけでよいか、同伴者ごとの複数会社・個人との分割請求があるか。
8. 予約時に有効だった所属がプレー前に終了した場合、予約時の payer を維持するか再承認するか。
9. 法人の請求担当者、請求住所、適格請求書情報、部門・コストセンターをどこから取得するか。
10. 月次締め後の入金をどの日付で過去残高と当月残高へ反映するか。

## 8. 項目 1 の merge gate

PLT-3409 / #1012 が main に merge されたため、CourseBoard の項目 1 は実装できる。PR は作成してよいが、
次を満たすまで merge しない。

- #1012 を含む Field production deployment が成功し、`POST /v1/invoices` の `billTo` contract が対象
  runtime に到達したことを確認する。
- CourseBoard の 2 producer がともに request body に `billTo` を載せ、synthetic `clientId` を送らない
  regression test が green である。
- merge は CPO が行う。
- legacy invoice / AR/AP の再分類を今回 scope に含めない。

## 9. 将来の検証計画

- bill-to 無指定の予約が従来と同じ request / invoice 結果になる。
- 個人 A の予約に法人 X と affiliation を指定し、reservation read back が同じ identity を返す。
- X 宛の複数 reservation invoice が同じ real client ID を返す。
- 他 tenant、期限外、billing 不可、archive client、customer 不一致を拒否する。
- invoice link 後の変更を 409 として利用者に説明する。
- accounting 権限の無い予約担当が通常予約は作れ、法人選択だけ拒否される。
- 後付け案では未確認、未発行、未転記が月次 checklist に残る。
- invoice 発行成功・AR posting 失敗を 0 残高として隠さず、retry で重複計上しない。
- client 名変更後も同じ ID の残高が二重行にならない。
- 月末後の入金を登録しても、確定済み月末残高の再表示が合意した規則どおりになる。
- CourseBoard bundle が Field / Tachyon platform API を直接参照しない。
- Field の上流失敗を 424 `provider_error` として返す。

## 10. 非目標

- CourseBoard DB への customer / client / affiliation / invoice / AR/AP table の追加
- Field admin を開かないと完了しない運用
- 既存 invoice の自動再分類、legacy raw value の更新、resolution の上書き
- 名称やメールによる法人の自動名寄せ
- tachyonfield #1001 未 deploy runtime に対する先行実装
- 項目 2（所属会社 UI）、項目 3（予約 `billTo`）、項目 4（月次精算の売掛残高）の API / UI 変更
- migration、tenant data の変更

## 参照した実装

CourseBoard `origin/main`:

- `src/course/infrastructure/field_gateway.rs`
- `src/course/infrastructure/field_customer_gateway.rs`
- `src/course/infrastructure/field_commercial_gateway.rs`
- `src/course/infrastructure/party_custom_fields.rs`
- `src/course/interfaces/http_commercial.rs`
- `src/field_proxy.rs`
- `src/cancellation_fees.rs`
- `desktop/src/features/golf/ledger/NewReservationEditor.tsx`
- `desktop/src/features/golf/ledger/RegisterNamesDialog.tsx`
- `desktop/src/features/golf/customers/CustomerDetailPage.tsx`
- `desktop/src/features/golf/SettlementPage.tsx`
- `desktop/src/features/cancellation-fees/CancellationFeesPage.tsx`

tachyonfield #1001 merge commit:

- `apps/api/src/bill_to_api.rs`
- `apps/api/src/reservation_api.rs`
- `apps/api/src/reservation_billing.rs`
- `apps/api/src/handler/ar_ap.rs`
- `apps/api/src/ar_ap/repository.rs`
- `apps/api/src/invoice_api/dto.rs`
- `apps/api/tachyon-field.openapi.yaml`
- `packages/reservation/src/bill_to.rs`
- `packages/invoice/src/bill_to.rs`
- `docs/src/tasks/completed/v0.1.9/plt-3373-bill-to/design.md`
