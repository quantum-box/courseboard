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

## Post-fix behavior on Sandbox

- PR branch API build: `bld_01kzn9ez9wxrt3w0a1k34q10x4`
- PR branch API deployment: `dep_01kzn9kd33m294ds4psrbnc32w`（active / healthz 200）
- Field setup read-back: capacity `2`, annual season `04-01` / `11-30`, revision `2`
- CourseBoard branch API GET: 200、capacity `2`
- unrelated CourseBoard branch API PUT: capacity `2` → `3`、200
- Field read-back after save: capacity `3`, annual season `04-01` / `11-30`, revision `3`
- 判定: PASS。write と revision 更新が起きた条件で、CourseBoard が認識しない annual season が
  同値で保持された。

## Merged #192 production UI verification

- deployment gate: frontend / courseboard-api とも #192 merge commit を含む active deployment
  であることを操作前に確認した。
- Field setup read-back: capacity `3`、annual season `04-01` / `11-30`、effective range
  `2026-01-01` / `2026-12-31`。
- CourseBoard 本番 UI の変更: capacity `3` → `4`。保存 request は 200、UI は保存完了を表示。
- Field read-back after save: capacity `4`、annual season `null` / `null`、effective range
  `null` / `null`。rule ID も新しい値へ変わった。
- 判定: FAIL。season 固有ではなく、CourseBoard が知らない mutable field 一般が UI 保存で
  保持されていない。
- 原因: `CourseSchedulePage.toStoredRule` が既存 `id` を payload から除き、gateway の ID 対応
  付けを到達不能にしていた。branch API 直接確認では ID 付き request を送っていたため通った。

## UI identity follow-up automated verification

- `CourseSchedulePage` component save test: PASS
  - capacity input の変更から保存 button、CourseBoard API PUT までを通す。
  - 既存 rule ID が payload に含まれる。
  - raw Field state の annual season と effective range がどちらも保持される。
  - UI 追加 rule は ID なし、`isNew: true` になる。
  - 読み込んだ既存 rule の ID 欠落時は PUT せず明示エラーになる。
- CourseBoard API identity contract test: PASS
  - ID ありの既存と、`isNew: true` の ID なし新規を受理する。
  - ID なしで新規 intent もない曖昧な rule と、ID あり新規を 400 相当で拒否する。
- `cargo +stable fmt -- --check`: PASS
- `cargo +stable clippy --all-targets --all-features -- -D warnings`: PASS
- `cd desktop && npm run type-check`: PASS
- `cd desktop && npm run test`: PASS（56 files / 449 tests）
- `cargo +stable test`: 418 PASS / 72 FAIL。全 72 件は test TiDB `127.0.0.1:4000`
  への `PoolTimedOut`。非 DB test と今回追加した test は PASS。DB-backed suite は PR CI の
  TiDB service で確認する。

## Follow-up post-fix behavior on Sandbox

- frontend preview: build `bld_01kznf48482yy8z4a93029qv0r`、deployment
  `dep_01kznf7knvagp22pyfczhtpyes`（active）。
- API preview: build `bld_01kznf4k1asw0z2jr07zmhx1bg`、deployment
  `dep_01kznfcfy61pnbnybqrae1wzbd`（active、healthz 200）。
- 両 build とも commit `bed15556`。preview frontend の既定 API URL は production のため、
  検証 tab 内だけ request URL を PR #199 API へ差し替えた。network log で画面表示の GET と
  保存 PUT が `pr199--courseboard-api.txcloud.app` に到達したことを確認した。
- Field setup read-back: rule `ravr_01kzndv0ph8dre02c6c9b9da74`、capacity `4`、annual season
  `04-01` / `11-30`、effective range `2026-01-01` / `2026-12-31`、revision `2`。
- CourseBoard PR preview UI の変更: capacity `4` → `5`。画面の `Save hours` を操作した。
- 保存 payload: 既存 rule ID、weekday `1`、`07:00` / `12:00`、capacity `5`、interval `8`。
  PUT は 200。
- Field read-back after save: 同じ rule ID、capacity `5`、annual season `04-01` / `11-30`、
  effective range `2026-01-01` / `2026-12-31`、revision `3`。
- 判定: PASS。season と effective range の両方が、UI から別項目を保存した後も同値で残った。
- cleanup read-back: capacity `4`、annual season `null` / `null`、effective range `null` /
  `null`、revision `4`。検証前の値へ復元した。

## PR CI

追補 PR の最終 commit で確認する。
