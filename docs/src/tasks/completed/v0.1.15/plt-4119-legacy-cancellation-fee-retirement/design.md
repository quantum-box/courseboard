# PLT-4119 詳細設計: legacy cancellation fee producer の段階停止

## Context

現行のキャンセル料画面は Field の `POST /v1/invoices` を直接利用しており、
legacy `POST /cancellation-fee-collections` の利用者は残存する古い公開支払い
リンクだけである。legacy producer を残したままにすると、CourseBoard の local
collection と Field invoice が二重に作られ、公開 PaymentIntent の再試行時にも
冪等性を保証できない。

## Decision

まず legacy producer だけを停止する。`POST /cancellation-fee-collections` は
認証・入力抽出後、外部 Field 呼び出しと local DB insert の前に `410 Gone` を返す。
応答の error code は `gone`、message は Field invoice API への移行を案内する固定文とする。

既に発行済みの token を救済するため、次の public route と route authorization は
この段階では残す。

- `GET /public/cancellation-fees/:token`
- `POST /public/cancellation-fees/:token/stripe-payment-intent`
- `POST /public/cancellation-fees/:token/confirm`

local collection の取得、Field の paid 同期、既存 PaymentIntent の確認挙動は変更しない。
既存リンクの棚卸し・Field payment URL への誘導・traffic zero の確認後に、別段階で
PaymentPage と public compatibility route を撤去する。

## Scope

- `src/cancellation_fees.rs`: legacy create handler の停止
- `src/lib.rs`: `Gone` error contract と route test の追加
- `src/course_authz.rs`: 既存 public token route の分類回帰テスト
- `docs/src/tasks/completed/v0.1.15/plt-4119-legacy-cancellation-fee-retirement/`: 実行記録

Field / Tachyon の PaymentIntent 冪等性、期限・取消 contract、Webhook は本段階の対象外で、
PLT-4117 で扱う。local `cancellation_fee_collections` table の削除も、既存 token の
排出と会計保持期間の確認後に別段階で行う。

## Rollout

1. 先に現行 UI が Field invoice producer のみを使うことと、旧 public endpoint の traffic を棚卸しする。
2. この変更で legacy create を `410` にする。Field API と local DB には到達させない。
3. 既存 rows は Field invoice ID を正として照合し、未払い token は Field の payment URL へ移行する。
4. due date、再試行、会計保持期間を経過し legacy traffic が zero になった後、public compatibility route と local table を撤去する。

## Security / Billing

- 410 応答は二重 invoice / 二重 PaymentIntent の新規作成を防ぐ。
- old token は現段階で revoke しない。削除前に token と Field invoice の対応を監査用に保存する。
- CourseBoard から Field の generic payment contract を直接変更しない。

## Test plan

- legacy create が `410 Gone` と固定 JSON を返すこと
- 停止時に Field endpoint を呼ばないこと
- 3 本の既存 public token route が `Public` として分類されること
- 既存の authz route 網羅テストと Rust format/check を通すこと
