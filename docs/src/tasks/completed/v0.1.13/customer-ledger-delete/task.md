# 顧客台帳から顧客を削除できるようにする

## Links

- [顧客台帳全体の taskdoc](../../../in-progress/reservation-customer-ledger/task.md)
- [顧客台帳の設計](../../../in-progress/reservation-customer-ledger/design.md)
- [ADR-0005: CourseBoard と Field の責務分担](../../../../architecture/decisions/ADR-0005-golf-domain-ownership.md)

## 目的

誤登録した顧客を CourseBoard の顧客詳細から台帳に出ない状態へ変更できるようにする。
Field admin を開かせず、顧客名と影響を確認してから実行する。

## 実装

- `DELETE /v1/course/customers/{customer_id}` を追加し、同じ bearer を Field の
  `DELETE /v1/storekit/customers/{customer_id}` へ転送する。
- usecase 冒頭で独立action名前空間の
  `field_extension_golf:ManageCustomers` を要求する。Field extension の有効・無効とは
  無関係である。
- Field の `active = false` による論理削除を利用し、予約・来場履歴・登録経路の記録は
  削除しない。
- 顧客詳細に顧客名と影響を示す確認ダイアログを追加する。
- 開発モック、OpenAPI、認可ルート網羅、日英・やさしい日本語を更新する。

## 検証

- [x] `cargo fmt --all -- --check`
- [x] `cargo check --all-targets --all-features`
- [x] `cargo clippy --all-targets --all-features -- -D warnings`
- [x] `cargo test delete_customer`
- [x] `cargo test every_registered_route_is_classified`
- [x] `npm run type-check`
- [x] `npm run test`（107 files / 920 tests）
- [x] `npm run build`
- [x] mock UI の削除フローを component test で確認
- [ ] この checkout の実ブラウザ確認。起動中の `:5173` は別 worktree
  (`worktrees/5065/courseboard`) を配信していたため未実施。
- [ ] PR Preview と実 Field API で論理削除後に一覧・検索から消えることを確認する。

## バージョン

- API: `0.1.12` → `0.1.13`（patch）
- Desktop UI: `0.1.8` → `0.1.9`（patch）
