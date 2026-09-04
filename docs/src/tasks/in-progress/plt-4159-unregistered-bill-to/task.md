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
- [ ] 実 Field を通した通し確認

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

## Merge gate

- **Field production に `e903804b` が届いてから merge する。** 未到達の Field に
  `unregistered` の `billTo` を送ると、`kind` を読めず 400 になる。
  `idempotencyKey` 側は unknown field として無視されるだけなので、劣化するのは冪等性だけ。

## Non-goals

- 何日前なら何割、という料金表そのもの
- 予約・顧客カルテからのキャンセル料請求導線（PLT-4159 の範囲外）
- 電話番号による顧客の名寄せ・統合
