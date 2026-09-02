# キャンセル料の期限超過判定と入金状態操作を正す

## 概要

CourseBoard 本番では、支払期限を過ぎた `Sent` の請求が存在しても、一覧の
「期限すぎ」が 0 件と表示される。画面が Field の保存済み `Overdue` 状態だけを
数え、テナントの業務日付と `dueDate` を比較していないためである。また、詳細画面の
通常の状態変更で `Paid` を選べるため、Stripe 入金と根拠のない手動操作を区別できない。

このタスクでは表示上の期限超過判定を統一し、通常操作から `Paid` への変更を外す。
手動入金の新しい会計 contract や Stripe webhook は Field 側の後続課題で扱う。

## Links

- [PLT-4120](https://linear.app/issue/PLT-4120)
- [親課題 PLT-4116](https://linear.app/issue/PLT-4116)
- [設計](./design.md)
- [PLT-4117: Field の決済確定と冪等性](https://linear.app/issue/PLT-4117)
- [PLT-4121: 実決済 E2E](https://linear.app/issue/PLT-4121)

## 対応

1. テナント timezone の今日と `dueDate` から、未入金請求の表示状態を
   `Overdue` と判定する。
2. 一覧、状態絞り込み、集計、詳細表示で同じ判定を使う。
3. 通常の状態変更から `Paid` を除外し、入金済み請求の状態も変更不可にする。
4. 表示判定と状態操作の回帰テストを追加する。

## 対象外

- Stripe test mode の実決済
- Webhook による入金確定
- 監査付き手動入金 contract
- legacy `cancellation_fee_collections` の撤去
- Field の invoice API 変更

## 検証

- `desktop` の対象 Vitest
- `npm run type-check`
- 本番デモテナントを読み取り専用で開き、期限を過ぎた未入金請求が
  「期限すぎ」に含まれることを確認する
- `Paid` の通常変更操作が表示されないことを確認する

## 完了条件

- 期限超過件数と絞り込み結果がテナント業務日付に一致する。
- Stripe または監査付き手動入金の根拠なしに `Paid` へ変更できない。
- 既存の請求作成、通知、支払いリンク表示を壊さない。

## 後続課題

- PLT-4117: Field invoice の決済確定、Webhook、冪等性
- PLT-4118: 月次突合用の汎用 invoice report
- PLT-4119: legacy collection 撤去と producer 整理
- PLT-4121: Stripe 実決済 E2E

## 実装結果

- [x] テナントの業務日を基準に、支払期限を過ぎた未入金 invoice を表示上 `Overdue` と判定する
- [x] 一覧、フィルター、集計、詳細で同じ表示状態を使う
- [x] 通常の状態更新候補から `Paid` を除外し、入金済み invoice の操作を無効化する
- [x] 表示上の `Overdue` を Field へ意図せず PATCH しないよう、表示用と更新用の invoice を分離する
- [x] 期限前、期限当日、期限後、入金済み、不正な日付、フィルター・集計をテストする

## 検証結果

- `node node_modules/vitest/vitest.mjs run src/features/cancellation-fees/models.test.ts --no-cache`: 18 tests passed
- `node node_modules/typescript/bin/tsc -b --noEmit`: passed
- `node node_modules/typescript/bin/tsc -b && node node_modules/vite/bin/vite.js build`: passed（既存の chunk size warning のみ）
- `node node_modules/@playwright/test/cli.js test --project=app --grep='キャンセル料'`: 6 tests passed
- 本番反映後の認証済みブラウザ確認は未実施。PR、デプロイ後に PLT-4121 と合わせて確認する

## Field 側の判断

この変更は既存の invoice contract だけで完結するため、PLT-4120 に Field 変更は不要。
実決済の冪等化、Webhook による入金確定、汎用レポート、generic PATCH からの `Paid`
制限は Field/Tachyon API の contract 変更を伴うため、PLT-4117 と PLT-4118 の別 PR で扱う。
