---
title: "SCC-36 Field ローリング窓へのオプトイン 実装クロスレビュー"
type: "review"
emoji: "🔬"
topics:
  - "golf"
  - "field-integration"
linear: "SCC-36"
published: false
---

# SCC-36 実装クロスレビュー（別ベンダー視点）

レビュー対象: `scc-36-rolling-window-opt-in` の実装2コミット（`ee89e86`、`45c00bc`）。
`d4e049c`（docs）は対象外。差分は `git diff origin/main...45c00bc`。

参照: `task.md`、`design.md`（確定版）、`review-sol.md`、`review-sol-round2.md`、
および tachyonfield `4296bc2a` の
`docs/src/tasks/in-progress/plt-3361-slot-rolling-window/design.md` 4章と
同コミットの `apps/api/src/reservation_api/schedule_management.rs`。

## 判定

**軽微修正後マージ可**。

設計への忠実性は高い。三値契約（省略=維持 / `null`=解除 / 値=設定）の取り違えは無く、
`sync_rolling_window_opt_in` は単一 GET の DTO だけから PUT ボディを組み立てており、
重大2で問題になった「別時点のドメイン rules を `edited` として重ねる」経路は再導入されていない。
5秒 deadline も同期処理全体を1本で包み、超過しても台帳本体の取得へ進む。
round2 の軽微1〜3もすべて実装に反映されている。

ただし **CI をそのまま落とす1件（下記 M-1）** があり、これはマージ前に必ず直す必要がある。
残りは実装の妥当性を変えないテスト・スキャフォールドの粗さで、同時に直せば望ましいという水準。

### 修正一覧

| # | 重み | 箇所 | 内容 |
| --- | --- | --- | --- |
| M-1 | **必須（CI 赤）** | `src/course/infrastructure/field_gateway.rs:2290,2293` | `clippy::cloned_ref_to_slice_refs` が `-D warnings` で error になる |
| M-2 | 推奨 | `src/course/usecase/course_schedule.rs:957,994` | 使われないテスト用 delay フィールドが残っている |
| M-3 | 推奨 | `src/course/infrastructure/field_gateway.rs:2326-2384` | `rule_dto_to_put_json` が手書きしている5フィールドのエコーを検証していない |
| M-4 | 任意 | `src/course/infrastructure/field_gateway.rs:2246` | `replace_resource_schedule` 経由で数値が PUT に載る統合テストが無い |
| M-5 | 任意 | `src/course/usecase/course_schedule.rs:1546-1584` | 併走テストの逆順ケースが新しい Fake インスタンスを使っており、順序不変性を弱くしか見ていない |

## 検証環境と結果

toolchain は `~/.rustup/toolchains/1.95.0-aarch64-apple-darwin`（`~/.cargo/bin/cargo` は 1.87 で、
依存が要求する 1.88 を満たさずビルドできない）。TiDB は Apple Container の
`pingcap/tidb:v8.5.7` を起動し、`COURSEBOARD_TEST_DB_HOST` で接続。

| コマンド | 結果 |
| --- | --- |
| `cargo fmt --check` | ✅ 差分なし |
| `cargo clippy --all-targets --all-features -- -D warnings` | ❌ error 2件（いずれも本ブランチの新規テストコード。M-1） |
| `cargo test --all-features --lib`（TiDB あり） | ✅ 988 passed / 0 failed |

補足: TiDB 初回起動直後の1回目は 150 failed になったが、これはマイグレーション初期化の
コールドスタートによるもので、同じバイナリの2回目は 988 全通過。実装起因ではない。

新規・変更テスト30本（`course_schedule`・`field_gateway`・`http` の該当分）はすべて green。

## 指摘

### M-1（必須）clippy が `-D warnings` で落ちる

`src/course/infrastructure/field_gateway.rs:2290`
`src/course/infrastructure/field_gateway.rs:2293`

```
error: this call to `clone` can be replaced with `std::slice::from_ref`
2290 |         let omitted = schedule_replace_body(&[], &[edited.clone()], "Asia/Tokyo", None);
2293 |         let released = schedule_replace_body(&[], &[edited.clone()], "Asia/Tokyo", Some(None));
= note: `-D clippy::cloned-ref-to-slice-refs` implied by `-D warnings`
```

`.github/workflows/ci.yml:28,38-39` は `dtolnay/rust-toolchain@stable` で
`cargo clippy --all-targets --all-features -- -D warnings` を実行する。
`cloned_ref_to_slice_refs` は clippy 0.1.88 には存在せず（`--explain` が
`is not a valid error code` を返す）、1.95 には存在する。つまり実装時の手元 toolchain では
通り、CI の stable では落ちる種類の差分。**このままだと CI が赤になる。**

修正は `std::slice::from_ref(&edited)` への置換2行。3つ目（2296行、`Some(Some(90))`）は
`edited` を move しているので変更不要。

なお `origin/main` 側にこの lint の違反は無く（clippy が報告したのはこの2件のみ）、
本ブランチが持ち込んだ回帰。

### M-2（推奨）使われないテスト用 delay フィールド

`src/course/usecase/course_schedule.rs:957`（宣言）
`src/course/usecase/course_schedule.rs:994`（読み取り）

`FakeSchedules::rolling_window_sync_delay` は宣言され `sync_rolling_window_opt_in` 内で
読まれているが、**どのテストからも書き込まれていない**（`grep` でヒットするのはこの2箇所のみ）。
フィールドが読まれているため `dead_code` にはならず、静かに残る。

経緯は追える。design 11.5 は「`FakeSchedules::sync_rolling_window_opt_in` を
`tokio::time::sleep` してから返す実装に差し替え、短い deadline を渡して超過を再現する」と
書いていたが、実装は `run_rolling_window_sync_then` を直接テストする形
（`src/course/interfaces/http.rs:2893-2907`）に変えた。**この変更自体は妥当**で、
deadline 超過の分岐を Fake ゲートウェイ一式を組まずに正確に突けている。
delay フィールドだけが旧案の名残として取り残されている。削除するか、
実際にこれを使うユースケース層のテストを1本足すかのどちらかにしたい。

### M-3（推奨）エコーバックの検証が手書きフィールドを覆っていない

`src/course/infrastructure/field_gateway.rs:2326-2384`
（`rolling_window_sync_echoes_one_get_without_response_only_fields`）

このテストは `id`・`timezone`・`effectiveFrom`・`effectiveTo`・`season`・`solarWindow`・
`futureWritePolicy` の保持と response-only 4件の除去、GET が1回だけであることを確認している。
ここまでは design 11.2 と重大2の回帰検知として十分。

一方、`rule_dto_to_put_json`（`field_gateway.rs:1253-1259`）が `json!` リテラルで
**手書きしている** `dayOfWeek`・`startTime`・`endTime`・`capacity`・`slotIntervalMinutes` の
5フィールドに対するアサーションが無い。テストが実際に検証しているのは
`field_rule_passthrough_fields` 経由（=既存コードの再利用）で通る側だけで、
今回新しく書かれた側は素通りしている。

これらは Field 側の `ReservationAvailabilityRuleRequest` で必須かつ
`deny_unknown_fields` 下にあるため、キー名の打ち間違いは 400 に直結する。
design 11.2 も「GET の rules と PUT の rules が response-only を除いて**完全に**一致すること」を
求めていた。5行のアサーション追加で閉じられる。

### M-4（任意）gateway 越しに数値が PUT に載る統合テストが無い

`src/course/infrastructure/field_gateway.rs:2246`

design 11.2 は「`replace_resource_schedule` の統合テスト（既存テストの隣に追加）:
… `rolling_window_days: Some(Some(90))` を渡した呼び出しで `body["rollingWindowDays"] == 90`
を確認する」を挙げていた。実装は既存の統合テストに
`assert!(body.get("rollingWindowDays").is_none())`（2271行）を足しただけで、
`Some(Some(n))` を gateway に通す統合ケースが無い（`replace_resource_schedule(` の
テスト側呼び出しはこの1箇所のみ）。

実害は小さい。`schedule_replace_body` の単体テスト（2286-2299）が三値のボディ組み立てを、
usecase テスト（`course_schedule.rs:1248-1288`）が horizon → 三値のマッピングを覆っており、
両者の間に挟まる `replace_resource_schedule` は引数をそのまま渡すだけである。
テスト計画の項目として消化されていない、という水準の指摘。

### M-5（任意）併走テストの逆順ケースが弱い

`src/course/usecase/course_schedule.rs:1506-1584`
（`inventory_extension_and_rolling_window_sync_use_independent_schedule_operations`）

前半（1509-1544）は design 11.4 の意図どおり、**同一の** `FakeCatalog`/`FakeSchedules` に対して
Sync → Extend の順で実行し、`rolling_window_sync_calls` と `generated` がそれぞれ1件ずつで
互いを汚さないことを確認している。ここは良い。

後半の逆順ケース（1546-1584）は `reverse_catalog`/`reverse_schedules`/`reverse_watermarks` を
新規に作り直している。これだと「順序を入れ替えたとき、先に走った側が Fake に残した状態が
後の側に影響しないか」という、順序不変性の本来突きたい部分を見ていない
（前半と独立した2本のテストを並べているのと同じ）。

実装上は両ユースケースが触る `FakeSchedules` の Mutex が
`rolling_window_sync_calls` と `generated` で分かれており、
`ExtendCourseInventoryUseCase` の `watermarks` に `SyncRollingWindowOptInUseCase` は
一切触らない（`course_schedule.rs:469-473` に `watermarks` フィールドが無い）ため、
現時点で order-dependence は生じ得ない。テストの厳密さの話に留まる。

## 設計への忠実性（レビュー観点1）

すべて期待どおり。以下は確認済みという記録。

### `Days(1..=365)` のみ `Some`、366以上と `Through` は明示解除

`src/course/domain/schedule.rs:218-223`

```rust
pub fn field_rolling_window_days(&self) -> Option<i32> {
    self.days()
        .filter(|&days| (Self::MIN_DAYS..=Self::FIELD_ROLLING_WINDOW_MAX_DAYS).contains(&days))
        .map(|days| days as i32)
}
```

design 3章の擬似コードは `days <= FIELD_ROLLING_WINDOW_MAX_DAYS` だったが、実装は
`MIN_DAYS..=FIELD_ROLLING_WINDOW_MAX_DAYS` の範囲チェックにしている。
`BookingHorizon::Days` は `pub` な variant で `try_days` を経ずに構築できる
（テスト `schedule.rs:389-393` が実際にそうしている）ため、これは**設計より安全な方向への逸脱**。
そのまま採用でよい。

`schedule.rs:352-395` のテストは 1 / 180 / 365 / 366 / 399 / `Through` の各境界に加え、
`MIN_DAYS..=MAX_DAYS` 全域で「`Some` のとき常に `1..=365`」を確認しており、
design 6.1・11.1 が求めた全域プロパティテストになっている。

### 三値契約の取り違えが無いこと

`src/course/usecase/course_schedule.rs:137-140`

```rust
let rolling_window_days = horizon
    .as_ref()
    .ok()
    .map(BookingHorizon::field_rolling_window_days);
```

- `Err`（horizon が読めない）→ 外側 `None` → キー省略 → Field 側で維持
- `Ok(Days(90))` → `Some(Some(90))` → 設定
- `Ok(Days(399))` → `Some(None)` → 明示 `null`（365 へのクランプではない）
- `Ok(Through(_))` → `Some(None)` → 明示 `null`

`course_schedule.rs:1248-1288` の
`replace_schedule_maps_horizon_to_field_three_value_contract` が4ケースすべてを
ポート引数まで確認しており、`Err` のケースでは同時に `saved.rules.len() == 1` で
「horizon が読めなくても週の保存は止めない」既存不変条件も見ている。
重大1（クランプ）と軽微1（未設定 vs 明示解除）の取り違えは無い。

### `schedule_replace_body` の三値同送

`src/course/infrastructure/field_gateway.rs:1238-1242`

```rust
let mut body = json!({ "rules": rules });
if let (Some(object), Some(value)) = (body.as_object_mut(), rolling_window_days) {
    object.insert("rollingWindowDays".into(), json!(value));
}
body
```

外側 `None` でキーを挿入しない、`Some(None)` で `Value::Null`、`Some(Some(90))` で `90`。
`schedule_replace_body_distinguishes_omission_setting_and_release`（2286-2299）が
3分岐すべてを直接アサートしている。`rules` 側の既存の passthrough マージロジックは無変更。

（細かい点: ここは `body.as_object_mut()` が `None` のとき黙って何もしないのに対し、
`rule_dto_to_put_json`（1261-1263）は同じ状況で `.expect(...)` している。
どちらも `json!({...})` 直後なので到達しないが、防御スタイルが2箇所で揃っていない。
design の擬似コードをそのまま写した結果であり、直す必要は無い。）

### `sync_rolling_window_opt_in` が単一 GET の DTO から rules を構築していること

`src/course/infrastructure/field_gateway.rs:953-982`、`1271-1283`

GET は `fetch_resource_schedule_dto` の1回だけ。差分が無ければ `Ok(false)` で即 return し
PUT を打たない。差分があるときの PUT ボディは `rolling_window_sync_body(&current, ...)` が
**その同じ GET が返した `current.rules`** から組み立てており、ドメインの
`AvailabilityRule` は一切登場しない。`replace_resource_schedule` も呼んでいないので、
重大2が問題にした `GET A -> GET B -> PUT` は構造上起こり得ない。

`rolling_window_sync_skips_put_when_field_already_matches`（2301-2324）が
「差分なしなら PUT ゼロ回」、
`rolling_window_sync_echoes_one_get_without_response_only_fields`（2326-2384）が
`assert_eq!(*state.calls.lock(), vec!["GET", "PUT"])` で「GET はちょうど1回」を
モックサーバーの呼び出し順で固定しており、2段 GET へ戻る回帰を検知できる。

### `FIELD_RULE_RESPONSE_ONLY_FIELDS` の除外と可変フィールドの保持

`src/course/infrastructure/field_gateway.rs:1253-1268`

`rule_dto_to_put_json` は既存の `field_rule_passthrough_fields`（1245-1251）を再利用しており、
除外規則は保存経路と1箇所を共有している（design 5.4 の意図どおり）。

`FieldAvailabilityRuleDto`（`field_gateway.rs:1131-1146`）の named field は
`id`/`day_of_week`/`start_time`/`end_time`/`capacity`/`slot_interval_minutes` のみで、
`timezone` は `#[serde(flatten)] additional_fields` 側に落ちる。したがって
`timezone`・`effectiveFrom`・`effectiveTo`・season・`solarWindow`・Field が将来足す
未知の可変フィールドは passthrough でそのまま往復する。named field と
`additional_fields` はキーが排他なので `object.extend(...)` が手書き値を上書きすることも無い。

検証の穴は M-3 のとおり。

### 5秒 deadline が同期全体を包み、台帳本体を妨げないこと

`src/course/interfaces/http.rs:590`（定数）、`592-614`（ヘルパー）、`686-698`（配線）

`tokio::time::timeout` は1本だけで、コースごとの timeout の合算ではない。
`tokio::spawn` による detach もしていない。`Ok(Err(_))`（即時エラー）と `Err(_)`（超過）を
どちらも `tracing::warn!` に落として `ledger.await` へ進む。
`get_tee_ledger` の返り値は ledger 側の `Result` だけを `AppError::from` に通しており、
同期失敗が台帳のレスポンスに漏れる経路は無い。

design 7.3 が指定した「deadline を引数で受け取り、本番だけが定数を渡す」形にもなっており、
`http.rs:2893-2921` の2本のテストが超過ケース・即時エラーケースの両方で
ledger future が実行されることを固定している（`tokio::time::pause`/`advance` 不使用、
`Cargo.toml`/`Cargo.lock` 無変更 — round2 軽微2 のとおり）。

### round2 の軽微3点

| 指摘 | 反映箇所 | 判定 |
| --- | --- | --- |
| 軽微1: 呼出数を `2 + C + k`（最大 `2 + 2C`）へ | `http.rs:586-587` | ✅ 表と同じ式に統一済み |
| 軽微2: `test-util` を増やさず deadline 注入で検証 | `http.rs:592-614`、`http.rs:2893-2921` | ✅ `Cargo.toml`/`Cargo.lock` 無変更を差分で確認 |
| 軽微3: 肩代わりを「条件なしの保証」と書かない | `course_schedule.rs:322-324` | ✅ 「Authorization and upstream success are prerequisites; … does not promise a completion-time or course-fairness bound」を doc comment に追記済み |

## Rust 品質（レビュー観点2）

### ベストエフォート経路の `?` 漏れ

無い。

- `http.rs:686-698`: 同期の `Result` はヘルパー内で消費され、返るのは ledger の `Result` のみ。
- `course_schedule.rs:498-499`: `horizon?` / `resources?` は伝播するが、呼び出し元
  （`http.rs:592-614`）が warn に落とす。design 9章の3段階ベストエフォートの1段目。
  `rolling_window_sync_propagates_a_horizon_read_failure`（`course_schedule.rs:1303-1325`）が
  「horizon が読めないときは1件も同期を試みずに `Err` を返す」ことを、
  `rolling_window_sync_calls` が空であることまで含めて確認している。
- `course_schedule.rs:517-531`: コースごとの `Err` は `tracing::warn!` にしてループ継続。
  `rolling_window_sync_continues_after_one_failure_and_filters_resources`
  （`course_schedule.rs:1327-1442`）が、先頭コースが `Err` を返しても2件目が処理され
  `synced` に入ることを確認している。

### 所有権

`course_schedule.rs:502-516` の `courses: Vec<(ResourceId, CourseId)>` は
`resources` からの借用を `.cloned()` で切ってから await ループに入るため、
`resources` を跨いで借用が生きない。`ExtendCourseInventoryUseCase`（`Vec<(&Resource, CourseId)>`）と
形が違うが、あちらは await の中で `&Resource` を使わないので問題無く、
こちらの所有形も適切。

`BookingHorizon` は `Copy` なので `course_schedule.rs:137` の `.as_ref().ok()` と
後続の `build_window` での再利用が衝突しない。

`http.rs:662,674-677` の `catalog.clone()` は、最後の1つ（677行）だけ move で足りる
（`catalog` はこれ以降使われない）。`redundant_clone` は既定 deny ではないので CI は通る。
指摘するほどではない。

### テストの実質性

概ね良い。空アサートやスモークだけのテストは無く、モック axum サーバー側で
**実際の PUT ボディ**を捕捉して検証している（`ScheduleServerState::put_body`）。
`get_body` を注入可能にしたことで、GET レスポンスの形をケースごとに変えられるようになっており、
`spawn_schedule_server`（`field_gateway.rs:2153-2170`）への切り出しも既存テストと重複しない形。

`rolling_window_sync_returns_only_changed_courses_and_does_not_read_timezone`
（`course_schedule.rs:1276-1301`）が `catalog.timezone_reads == 0` を明示的に見ているのは良い。
design 7.2 の「タイムゾーン GET を呼ばない」という負荷上の主張が、
テストで固定された不変条件になっている。

`rolling_window_sync_continues_after_one_failure_and_filters_resources` は
design 11.3 が「それぞれ独立したケース」と書いていた3つのフィルタ
（`is_active() == false`・`kind() != Course`・`golf_course_id()` が `None`）を1本にまとめているが、
`rolling_window_sync_calls` に該当 `ResourceId` が現れないことを一括でアサートしており
検証の実質は落ちていない。

弱いのは M-3（エコーの部分検証）と M-5（逆順ケース）の2点のみ。

## 併走安全性（レビュー観点3）

`get_tee_ledger` の1リクエスト内で `ExtendCourseInventoryUseCase` → `SyncRollingWindowOptInUseCase`
→ `GetTeeLedgerUseCase` が直列に走る（`http.rs:662-698`）。相互作用を上流の実体まで追った。

- **触る Field エンドポイントが交わらない。** Extend は
  `POST .../reservation-resources/{id}/time-slots:generate` 相当（`generate_resource_time_slots`）、
  Sync は `GET`/`PUT .../reservation-resources/{id}/schedule`。
- **Field 側の schedule PUT は枠を再生成しない。** tachyonfield
  `apps/api/src/reservation_api/schedule_management.rs` の
  `replace_reservation_resource_schedule` は `repo.replace_resource_schedule(...)` を呼ぶだけで、
  `generate_resource_time_slots` を呼ばない。したがって Sync の PUT が Extend の生成結果を
  上書きしたり再計算させたりすることは無い。
- **エコーバック PUT は rules に対して真の no-op。** Field の
  `packages/reservation/src/sqlx_repository/schedule_management.rs` の `replace` は、
  desired と existing が `same_meaning` で一致し、かつ `existing.active` が真なら
  UPDATE を発行しない。CourseBoard は GET が返した値をそのまま返しているので一致する。
  結果として `revision`・`updated_at` も動かず、`store_id = NULL` のリセットも起きない。
  書き換わるのは `reservation_resources.rolling_window_days` だけ。
- **非アクティブ rule の復活は起きない。** Field の `get` は
  `WHERE ... service_id IS NULL AND active = TRUE` で絞る一方、`replace` は
  `service_id IS NULL` の全行（非アクティブ含む）をロードして desired に無いものを
  deactivate する。GET がアクティブ分だけを返し、それをそのまま送り返すので、
  非アクティブ rule は非アクティブのまま残る。
- **認可チェックの二重課金は起きない。** `SyncRollingWindowOptInUseCase::execute`
  （`course_schedule.rs:493`）は `MANAGE_COURSES` を要求するが、直前の
  `ExtendCourseInventoryUseCase`（`course_schedule.rs:364`）が同じ action で先に通っており、
  `CachingPolicyChecker`（`src/course_authz.rs:856-901`、許可のみキャッシュ）に当たる。
  design 8.1 のコスト表が policy check を数えていないのは結果的に正しい。
- **順序依存は無い。** Sync が先でも Extend が先でも結果は変わらない
  （Extend は watermark と枠、Sync は `rolling_window_days` と、書く対象が排他）。
  ただしこれをテストで固定できているかは M-5 のとおり弱い。
- **deadline のキャンセルは安全。** timeout が PUT の最中に切れても、書く値と rules は
  冪等なので、次回の台帳アクセス時に GET が Field の確定状態を読み直して収束する。

`GET /v1/course/tee-ledger` に対しては、定常時（差分なし）で
`get_booking_horizon` + `list_resources` + コース数ぶんの schedule GET が**直列に**足される。
design 8章が評価・受容した範囲であり、5秒 deadline が上限を切っている。

参考までに、この直列追加は `tokio::join!(timeout(sync), ledger)` にすれば
`max(sync, ledger)` に縮む。Sync は台帳が読むデータ（枠・予約）を一切書かないので、
Extend と違って ledger と並行に走らせても安全であり、Lambda の
「レスポンス前に await し切る」要件も保てる。確定版設計が採らなかった選択肢なので
本タスクで変更することは求めないが、第2段で台帳フックを見直す際の候補として記録しておく。

## Field 側契約との整合（レビュー観点4）

tachyonfield `4296bc2a` の `apps/api/src/reservation_api/schedule_management.rs` と
突き合わせた。**送っている JSON は `deny_unknown_fields` な PUT 契約に適合する。**

### トップレベル

Field の `ReplaceReservationResourceScheduleRequest` は `#[serde(deny_unknown_fields)]` で
`rules` と `rollingWindowDays` の2キーのみ。
`rollingWindowDays` は `#[serde(default, deserialize_with = "double_option")]`。

CourseBoard 側:

- `schedule_replace_body`（`field_gateway.rs:1238-1242`）が挿入するのはこの2キーのみ。
- `rolling_window_sync_body`（`field_gateway.rs:1271-1283`）も同じ2キーのみ。
- `json!(Option<i32>)` が `null` / 数値へ落ちるので、`double_option` の
  Keep / Clear / Set の3状態に正しく対応する。

### rule レベル

Field の `ReservationAvailabilityRuleRequest` も `#[serde(deny_unknown_fields)]` で、
受け付けるのは `id`・`timezone`・`dayOfWeek`・`startTime`・`endTime`・`effectiveFrom`・
`effectiveTo`・`seasonStartMonthDay`・`seasonEndMonthDay`・`capacity`・
`slotIntervalMinutes`・`solarWindow` の12キー。

`ReservationAvailabilityRuleResponse` はこれに `revision`・`active`・`createdAt`・`updatedAt` の
4キーを足したもの。**response − request がちょうど
`FIELD_RULE_RESPONSE_ONLY_FIELDS = ["active", "createdAt", "updatedAt", "revision"]`
（`field_gateway.rs:1210`）と一致する。** エコーバックが 400 を踏む余地は無い。

個別に確認した点:

- `timezone` は request 側で必須の `String`。Field の response が常に返し、
  CourseBoard が passthrough で往復させるので欠落しない。
- `startTime`/`endTime` は request が `NaiveTime`。Field が `"07:00:00"` 形式で返し、
  CourseBoard が `String` としてそのまま返すので再パースできる。
- `solarWindow` は request が `double_option`。Field の response は
  `#[schema(required = true)]` で `skip_serializing_if` を付けず、未設定時も明示 `null` を返す。
  CourseBoard がそれをそのまま返すと `Some(None)` = Clear と解釈されるが、
  元が `null` なので状態は変わらない。値がある場合も同じ `SolarWindow` 型なので往復する。
- `rollingWindowDays` は Field 側 `validate_rolling_window_days` が `1..=MAX_ROLLING_WINDOW_DAYS`
  （= 365）を要求。`BookingHorizon::field_rolling_window_days` は `Some` のとき必ず
  `1..=365`（`schedule.rs:389-393` の全域テストで固定）なので、
  design 6.1 が懸念した「`rollingWindowDays` の不正値で無関係なスケジュール保存全体が 400 になる」
  結合は生じない。
- GET 応答のトップレベル `resourceId` は `FieldResourceScheduleDto`
  （`field_gateway.rs:1122-1129`）が無視する（`deny_unknown_fields` を付けていない）。正しい。
- `#[serde(default)] rolling_window_days`（`field_gateway.rs:1125-1126`）により、
  キー自体を返さない Field でも decode は落ちない。

### 空 rules の PUT

初めてスケジュールを保存していないコースリソースでは、GET が `rules: []` を返し
`rolling_window_days` が期待値と異なるため `rules: []` の PUT が飛ぶ。
Field の `validate_resource_schedule_rules`（`packages/reservation/src/lib.rs:425`）は
空配列を拒否しないので 400 にはならず、`replace` は非アクティブ rule を触らないので
データ損失も無い。Field 側のジョブも「アクティブな通常ルールが1件以上ある場合に限り」動くので
副作用は生じない。安全。

### 運用上の注意（修正不要）

`ReplaceCourseScheduleUseCase` の PUT は `rollingWindowDays` を無条件に同送し、
失敗を `?` で伝播する（`course_schedule.rs:141-149`）。もし Field が PLT-3361 以前へ
ロールバックされると `deny_unknown_fields` で 400 になり、
**スケジュール保存機能そのものが落ちる**（台帳フック側はベストエフォートなので影響しない）。
Field は既に本番稼働済み（task.md 記載、初日 29/29 成功）なので現時点で実害は無く、
`DEFAULT_MULTI_COURSE_PRODUCT_WRITES`（`field_gateway.rs:48`）のような kill switch を
今から足すことは求めない。「Field を先、CourseBoard を後」というデプロイ順序と、
Field をロールバックする場合は本ブランチも同時に戻す必要があることを、
第2段への申し送りに含めておきたい。

## まとめ

設計の核心（三値契約、単一 GET からの PUT 構築、response-only の除外、絶対 deadline）は
すべて正しく実装され、Field 側の `deny_unknown_fields` 契約とも一致している。
併走安全性も Field の repository 実装まで追って確認でき、rules を巻き戻す経路・
非アクティブ rule を復活させる経路・台帳を無期限に待たせる経路はいずれも存在しない。

**M-1 を直せばマージ可**。M-2・M-3 も同じコミットで併せて直すことを推奨する。
M-4・M-5 はテスト計画の消化度の話で、マージのブロッカーにはしない。
