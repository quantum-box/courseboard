# SCC-8 verification report

## Pre-fix production behavior on Sandbox

- Tenant: Field Golf Sandbox
- annual season setup read-back: `04-01` / `11-30`
- unrelated CourseBoard edit: capacity `1` → `2`
- Field read-back after CourseBoard save: capacity `2`, both season fields `null`
- 判定: 再現 PASS（未認識 field の消失を確認）

## Read-only tenant audit

- demo tenant: 8 courses / 10 resources / 64 schedule rules。annual season が設定された
  rule は 0。
- 札幌カントリー倶楽部 tenant: 0 courses / 0 resources。schedule audit 対象なし。
- 全 request は GET のみ。現在値から過去に消えた履歴までは判定できない。

## Automated verification

- `cargo +stable test schedule_save_round_trips_a_field_owned_unknown_field`: PASS
  - unknown nested field の保持
  - GET→PUT の呼び順
  - CourseBoard 編集 field の上書き
  - response-only metadata の除外
- `cargo +stable fmt -- --check`: PASS
- `cargo +stable clippy --all-targets --all-features -- -D warnings`: PASS
- `cd desktop && npm run type-check`: PASS
- `cd desktop && npm run test`: PASS（53 files / 441 tests）
- `cargo +stable test`: 400 PASS / 65 FAIL。全 65 件は test TiDB `127.0.0.1:4000`
  への `PoolTimedOut`。Docker socket に接続権限がなく local TiDB を起動できないため、
  DB-backed suite は PR CI の TiDB service で確認する。新 regression test は PASS。

## Post-fix behavior and full checks

PR branch の deploy 後に追記する。
