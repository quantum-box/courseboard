# キャンセル料の作成・通知・支払状態E2Eを追加する

## 概要

キャンセル料画面には一覧・詳細・新規フォームの表示確認だけがあり、請求作成から通知、
支払いリンク表示までの操作と、期限超過・入金済み状態の制約を回帰検知できなかった。
PLT-4121ではローカルモックをセッション内で状態遷移させ、外部通知やStripe決済を発生させずに
CourseBoardの一連の画面操作を検証する。

## Links

- [PLT-4121](https://linear.app/issue/PLT-4121)
- [親課題 PLT-4116](https://linear.app/issue/PLT-4116)
- [PLT-4120](../plt-4120-cancellation-fee-state/task.md)

## 対応

1. 保存状態が`Sent`の期限超過fixtureと`Paid` fixtureを追加する。
2. mock Field APIへinvoice作成、fulfill、更新のセッション内状態遷移を追加する。
3. 期限超過・Paid filter、通常操作にPaidがないこと、作成から通知・支払リンクReadyまでを検証する。
4. Paid invoiceの状態変更と再送が無効であることを検証する。

## 対象外

- Stripe test modeでの決済
- メール・SMS providerへの実送信
- 本番invoiceの作成・更新

## 検証結果

- `node node_modules/@playwright/test/cli.js test --project=app --grep='キャンセル料'`: 6 passed
- `npm run type-check`: passed
- `git diff --check`: passed

## 完了条件

- 請求作成から通知・支払リンク表示までをブラウザテストで再現できる。
- 期限超過の導出とPaidの操作禁止をブラウザ境界で検知できる。
- テストがStripe・通知providerへ到達しない。

## 残タスク

- デプロイ後、認証済み環境で本番APIの読み取り確認を行う。
- 明示承認されたStripe test modeデータでPaymentIntent冪等性とWebhook入金確定を確認する。
