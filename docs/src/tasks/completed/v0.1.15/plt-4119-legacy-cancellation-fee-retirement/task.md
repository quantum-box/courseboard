# PLT-4119: legacy cancellation fee producer を段階撤去する

## 概要

CourseBoard の現行キャンセル料画面は Field invoice を直接作成しているが、
legacy `cancellation_fee_collections` の create route と公開 token flow が残っている。
create route を残すと、同じ請求について CourseBoard local collection と Field invoice が
別々に増え、PaymentIntent の再試行も CourseBoard / Field の双方で安全に冪等化できない。

この段階では新規 legacy collection の作成だけを停止し、既に配布された payment token は
従来どおり読めるようにする。

## Links

- [PLT-4119](https://linear.app/issue/PLT-4119)
- [設計](./design.md)
- [PLT-4117: Field の決済確定と冪等性](https://linear.app/issue/PLT-4117)
- [PLT-4120: キャンセル料の期限超過判定と入金状態操作](../plt-4120-cancellation-fee-state/task.md)

## Scope

- `POST /cancellation-fee-collections` の新規作成停止
- `410 Gone` / `gone` error contract の追加
- 既存 public token route の互換性回帰テスト
- legacy create の Rust route test と taskdoc / DD

## 対象外

- 既存 token の即時失効や local table の削除
- `PaymentPage` と public compatibility route の撤去
- Field / Tachyon の PaymentIntent 冪等性、期限・取消、Webhook
- 本番 DB の棚卸し・データ移行

## 対応

1. 現行 producer が Field invoice direct route と reservation billing route であることを維持する。
2. legacy create handler を provider / DB 書き込み前に `410 Gone` で停止する。
3. `GET /public/cancellation-fees/:token`、PI 作成、confirm の route と public authz 分類は変更しない。
4. 既存 token の排出と traffic zero を確認してから、後続段階で公開互換 route と table を撤去する。

## 実装結果

- [x] `POST /cancellation-fee-collections` を `410 Gone` で停止
- [x] 停止時に Field API / local DB へ到達しない route test を追加
- [x] 既存 public token 3 route の `Public` 分類回帰テストを追加
- [x] 段階撤去の design doc を追加

## 検証

- `cargo fmt --check`: passed
- `cargo test --lib legacy_collection_creation_gate_is_closed`: passed
- `cargo test --lib public_and_bearer_only_routes_stay_reachable`: passed
- `cargo check --tests`: passed
- `cargo test --lib legacy_cancellation_fee_collection_creation_is_disabled`: passed（lazy pool で DB/provider 到達前の 410 を検証）
- `cargo clippy --all-targets --all-features -- -D warnings`: 未実行

## 残タスク

- 本番の local collection / Field invoice 対応表と旧 public endpoint traffic の読み取り専用棚卸し
- Field 側 PLT-4117 の PaymentIntent 冪等性・決済確定 contract
- 未払い旧 token の Field payment URL への移行と保持期間の決定
- traffic zero 確認後の `PaymentPage` / public route / local table 撤去
