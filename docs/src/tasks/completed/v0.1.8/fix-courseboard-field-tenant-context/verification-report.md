# 検証レポート

## Host checks

- `cargo clippy --all-targets -- -D warnings`: 成功
- `cargo fmt --all -- --check`: 成功
- `cargo test course::infrastructure::field_gateway::tests::`: 7件成功
- `cargo test course::usecase::list_caddies::tests::`: 1件成功
- `cargo test tests::provider_errors_keep_json_and_cors_headers`: 1件成功
- `desktop/npm run type-check`: 成功
- `desktop/npm test -- --reporter=dot`: 21 files、123 tests成功
- `desktop/npm run build`: 成功。既存の500 kB超chunk warningのみ。
- `git diff --check`: 成功

## 全Rust test

`cargo test --lib`は72件中52件が成功し、20件が`connect test TiDB admin pool: PoolTimedOut`で失敗した。失敗は共通のtest DB setupで発生し、今回追加したField request header、timeout、CORS、caddie rosterのtestはすべて成功した。

## 実装証拠

- Field request builderが`Authorization`、`x-operator-id`、任意の`x-platform-id`を保持するtestを追加。
- platform headerを送らないlegacy client向けの互換性testを追加。
- Field requestへ15秒のdeadlineを設定。
- provider errorが本番origin向けCORSとJSON content typeを保持するtestを追加。
- キャディ名簿のstaff responseをcourse APIへ集約し、profile成功前は補助requestを開始しないload planを追加。

## Preview / production

- Preview frontend: `https://pr100--courseboard.txcloud.app` のdeploy成功。
- Preview API build: `bld_01ky6ad8mthbc8fvyv2vjht6x4`、commit `66a63120`、成功。
- Preview API deploy: `dep_01ky6b0a21bbb38x5gyjeghqp0`、失敗。Lambda candidate serving smokeが8回すべてtimeoutした。#98/#99とmainのTiDB移行後deployでも同型の失敗が継続しており、`pr100--courseboard-api` routeは作成されなかった。
- Browser: in-app browser sessionが利用できず、実ログイン検証は実施できなかった。
- Production: merge/deploy後にCourseboard tenantとField Golf Sandboxで実施する。
