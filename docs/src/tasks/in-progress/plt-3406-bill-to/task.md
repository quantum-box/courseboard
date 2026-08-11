# CourseBoard のキャンセル料請求へ型付き請求先を渡す

## Links

- [設計](./design.md)
- [PLT-3406](https://linear.app/issue/PLT-3406)
- [PLT-3409](https://linear.app/issue/PLT-3409)
- [tachyonfield #1012](https://github.com/quantum-box/tachyonfield/pull/1012)

## 状態

PLT-3406 の項目 1 だけを実装中。項目 2（所属会社 UI）、項目 3（予約 `billTo`）、項目 4
（月次精算の売掛残高）は対象外。

Field の `POST /v1/invoices` typed `billTo` contract は tachyonfield #1012、merge commit
`45f6428121cbd5c4a75422ecc1cca3320ad8d3a3` で main に入った。ただし 2026-08-11 時点で Field
production への反映は未確認である。

## 実装

- [x] allowlist 付き BFF を使うキャンセル料画面が Field `POST /v1/invoices` に `billTo` を送る。
- [x] legacy `POST /cancellation-fee-collections` が型付き `bill_to` を受け、Field request の
  `billTo` に写像する。
- [x] 2 経路とも legacy `clientId` と `courseboard:{reference}` の合成 ID を送らない。
- [x] 個人 `{kind: customer, customerId}` と法人
  `{kind: client, clientId, affiliationId}` を扱う。
- [x] 2 経路の Field request body を直接検査する regression test を置く。
- [x] Field merge commit 上で、同じ typed client 宛の 2 invoice が同じ counterparty identity を持つ
  test を実行した（1 passed）。
- [x] Field #1012 の CI log で、`GET /v1/erp/ar-ap/balances` が同じ typed client 宛の 2 invoice を
  `counterparty_id` 1 行・`item_count = 2` に集約する test の PASS を確認した。ローカル再実行は DB
  pool timeout で完走しなかったため、ローカル PASS とは記録しない。
- [ ] CourseBoard の required checks が green になる。
- [ ] Field production に #1012 の contract が到達したことを CPO が確認する。

## Merge gate

- PR は作成してよいが、この作業者は merge しない。merge は CPO が行う。
- Field production に `billTo` contract が到達したことを確認するまで merge しない。未到達の Field に
  CourseBoard が `billTo` を送ると、production のキャンセル料請求が 400 になる可能性がある。
- production 反映を実測できない間は PASS と記録しない。

## Non-goals

- プレーヤーの所属会社の登録・変更 UI
- 予約作成・変更時の `billTo`
- 月次精算での相手先別売掛残高の表示
- 既存 invoice / AR/AP の再分類
- production の設定変更またはデータ書き込み
