# 名前・電話番号・金額だけでキャンセル料を請求する

## Links

- [PLT-4159](https://linear.app/issue/PLT-4159)
- [tachyonfield #1292](https://github.com/quantum-box/tachyonfield/pull/1292)（merge commit `e903804b`）

## なにが問題だったか

キャンセル料の請求先は個人 (`customer`) か法人 (`client`) の二択で、どちらも台帳上の
識別子を要求していた。電話で「行けなくなった」と言われただけの相手には顧客 ID が無く、
受付は台帳に無い相手へ請求を出せない。回避すると存在しない ID を入れることになり、
`invoices.client_id` は FK の無い `VARCHAR(128)` なのでそれが通ってしまう。

## Field 側（実装ずみ）

`e903804b` で入っている。CourseBoard からは以下だけを使う。

- `POST /v1/invoices` の `billTo` に `{ kind: 'unregistered', name, phone?, email? }`。
  識別子を求めず、宛名と連絡先だけの写しを持つ。`clientId` を併せて送ると 400。
  電話は国内形式と E.164 の両方を受け、サーバ側で E.164 に畳む。
  この請求先から Field は顧客を作らない。
- `POST /v1/erp/customers` の `idempotencyKey`（body、128 バイトまで）。
  鍵とテナントから顧客 ID を導く。2回目以降は書き込まず `200 OK`。
- `billTo` の `client` variant は `affiliationId` が任意（PLT-3512）。
  「法人IDと所属IDを両方必須」は CourseBoard 側の制約だった。

## 実装

- [x] `InvoiceBillTo` に `unregistered` を足し、`invoiceBillTo()` の分岐を書く。
- [x] `client` の `affiliationId` を任意にする。
- [x] 請求作成フォームから `customerId` / `clientId` / `affiliationId` の `required` を外す。
      注文から来ていないときの既定は `unregistered`。
- [x] 「送信先を顧客台帳にも登録する」の任意チェック。チェック時だけ
      `POST /v1/erp/customers` を先に呼び、返った ID で `billTo: {kind:'customer'}` に切り替える。
- [x] 支払い期限は既定値（7日後）付きの編集可能な日付入力（既存）。
- [x] 送信前の確認：宛先・送り先・請求額（税込）・支払い期限・顧客台帳への登録有無。
- [x] 請求の `idempotencyKey` を **body** に入れる。Field は header を読んでいないので、
      これまで送っていた `idempotency-key` header は何も守っていなかった。
- [x] 鍵は画面ごとに1つ。リトライでも同じ鍵を使うので、顧客も請求も増えない。
      顧客登録が成功して請求が失敗した場合は、作成ずみ顧客 ID を握って再送する。
- [x] 請求が作れて送信だけ失敗した場合は `POST /v1/invoices/{id}/payment-link/resend` で
      送信だけ再試行する（請求は作り直さない）。
- [x] 台帳の候補提示（名前一致）。選ぶのは操作者だけで、電話番号一致での自動統合はしない。
      選ぶと請求先の種類が「登録ずみの個人」に切り替わり、あとは #329 の `CustomerPicker`
      に渡す。同じ紐付けを2通り持たない。
- [x] `desktop/src/dev/mockFieldApi.ts` に `unregistered` 請求先、`POST /v1/erp/customers`、
      `payment-link/resend`、請求の再送鍵リプレイを足す。

## 確認

- [x] `npm run type-check` / `npm run test` 1029 passed / `npm run build`
- [x] mock fixture で通し確認（`courseboard-mock`）: 台帳に無い相手 → 顧客登録あり →
      確認シート → 請求作成 → SMS 送信 → 請求詳細まで到達
- [x] 実 Field (production) を通した確認。テストテナント `courseboard`
      (`tn_01kxd5gdvm9thcbj8c2e8c6yhq`)、送信は全部切って実施。
  - 契約（書き込みなし）: `unregistered` は deploy 済み（unknown variant ではなく
    `missing field name` が返る）／`idempotencyKey` も deploy 済み（同意項目の検証より
    手前で `idempotencyKey must not be blank`）／`819012345678` は拒否／`clientId`
    併用は拒否
  - 正常系: 顧客登録 1回目 `201`・2回目 同じ鍵で `200` かつ同じ ID
    (`cus_710HTPAZ45G0T2VH44GMWZYEEE`)／`unregistered` の請求書は `clientId` 空・
    `clientName` が写しから補完・`billTo.snapshot.phone` が `+819000000000` に正規化・
    再送で同じ請求書 (`inv_01m1nc7pgna2hd4bjmm5z157rs`, `INV-CF-plt4159probe1`)
  - 見つかったギャップ: SMS を送らないと Field は `clientPhone` を埋めない。番号は
    `billTo.snapshot.phone` にしか無いので、請求詳細が写しも読むようにした。

## #329 との重なり

#329（`85c3c86` で main へ）が同じ請求先パネルを `CustomerPicker` に置き換え、
`invoiceBillTo` / `cancellationFeeInvoiceRequestBody` / `normalizePhone` を
`models.ts` へ出した。rebase して以下のとおり寄せた。

- 請求先の型とヘルパーは `models.ts` に置く。画面は再エクスポートするだけ。
- `idempotencyKey` は任意にした。一括徴収 (`CancellationsPage`) は意図的に鍵を
  持たない（2回目の押下は「通らなかったぶんを請求する」意味で、通ったぶんは
  `invoicedReservationIds` で外れる）。
- 一括徴収も `idempotency-key` header を送っているが、これも Field には届いていない。
  `saving` と `invoicedReservationIds` で実害は抑えられているので、この PR では触らない。

## 追いかけ (#330 の後)

`idempotencyKey` は Field で `INV-{鍵}` という請求番号になる。そこに気付かずに #330 は
生の UUID を送っていたので、請求番号が `INV-6913f82ce-8433-42bc-...` になっていた。
受付が電話口で読み上げる番号なので短くした（`INV-CF-1r0qvxh0f02pq1`）。

- [x] 鍵を短く読める形にする（`cancellationFeeIdempotencyKey`）。
- [x] 一括徴収も鍵を body で送る。header で送っていたものは Field に届いていなかった。
      鍵は「誰に・いつまでに・いくら・どの予約」から導く。押すたびに変わる鍵だと
      二重に請求し、人ごとに固定した鍵だと金額を直したときに直す前の請求書が返る。

## 追いかけ (請求先の指定)

「請求先の種類」で *先に* 台帳の有無を宣言させる形が残っていた。台帳にいるかどうかは
名前を入れるまで分からないので、受付は「登録ずみの個人」を選んでから台帳に無いと気付き、
エラー文（「顧客IDか取引先IDが要ります」）で止まる。画面には ID の入力欄すら無いので、
読んだ相手は「顧客IDが必須」と受け取る。

- [x] 種類は「個人／法人」の2択にする。個人は `CustomerPicker` 1つに寄せ、
      候補を選べば `billTo: customer`、選ばなければ `billTo: unregistered`。
      台帳の有無は操作者が宣言するものではなく、選んだ結果から導く。
- [x] チェックボックス側の候補一覧（`cancellation-fee-candidates`）は撤去。
      名前を打てば常に候補が出るので、同じ紐付けを2通り持たない。
- [x] `CustomerPicker` に `allowRegister` を足し、この画面では picker 内の
      「顧客台帳に登録」を出さない。登録は「送信先を顧客台帳にも登録する」が
      請求作成時に `POST /v1/erp/customers` でやる（2経路を作らない）。
- [x] `validation.billTo` の文言を、存在しない ID 入力欄を指さないものに直す。

## 追いかけ (一括徴収の請求先)

同じ制約が一括徴収（キャンセル一覧 → キャンセル料を請求）にも残っていた。
`planCancellationFees` は `customerId` の無い行を `unlinked` として請求対象から外し、
シートは「{{count}}件は台帳の顧客と結びついていないため、請求書を出せません」と告げるだけで、
その場で直す手段が無かった。電話だけで取った予約のキャンセルは1件も徴収できない。

- [x] `planCancellationFees` に `assignments`（予約IDごとの「台帳の顧客 or 名前と電話」）を渡す。
      請求先は宣言ではなく導出：行の `customerId`、無ければ選んだ顧客、無ければ入れた名前
      （`billTo: unregistered`）。名前も無い行だけが `unnamed` として残る。
- [x] グループ化は顧客IDのある行だけ人単位。台帳に無い行は**予約ごとに1通**にする。
      打ち込んだ名前が同じでも同一人物の証拠ではなく、1通にまとめると別人の料金が載る。
- [x] シートに「台帳と結びついていない予約」欄を足す。予約ごとに `CustomerPicker`
      （`candidatesOnFocus`、`allowRegister={false}`）と電話番号。選べばその顧客のグループに
      合流するので、紐付いた1件と紐付いていない1件で請求書は1通になる。
- [x] 電話番号は `normalizePhone` で E.164 に畳み、読めないものは請求書に載せずに欄の下で断る
      （請求そのものは止めない。Field は読めない番号で請求全体を弾く）。
- [x] 冪等キーはグループキーではなく請求先の実体（顧客ID、または `name:<名前>`）から作る。
      形が変わると、送信ずみのバッチに2通目を出してしまう。
- [x] `mockFieldApi.ts` に `/v1/course/reservation-cancellations` の GET と `/fees` の POST を足す。
      この画面はモックに無く、mock fixture で開けなかった。

台帳の顧客を選んだことを CourseBoard のキャンセル行（`reservation_cancellations.customer_id`）へ
書き戻すかは**やっていない**。予約と顧客の紐付けは Field の予約が正で、キャンセル行に写しを
作ると2つの正ができる。必要になったら Field 側の予約更新として起票する。

## Merge gate

- **Field production に `e903804b` が届いてから merge する。** 未到達の Field に
  `unregistered` の `billTo` を送ると、`kind` を読めず 400 になる。
  `idempotencyKey` 側は unknown field として無視されるだけなので、劣化するのは冪等性だけ。

## Non-goals

- 何日前なら何割、という料金表そのもの
- 予約・顧客カルテからのキャンセル料請求導線（PLT-4159 の範囲外）
- 電話番号による顧客の名寄せ・統合
