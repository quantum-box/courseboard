# CourseBoard 機能カタログ 棚卸し（draft）

テナント別デリバリ（Field の商品プランに含まれる機能だけをテナントが使える状態）を CourseBoard に広げるための棚卸し。CourseBoard のすべての画面・API ルート・操作に、安定した**機能 key** の案を付ける。

出し分けは次の 3 つの AND で決める。

- **IAM**: その人がその操作をしてよいか（既存の action）。
- **契約・プラン**: その会社にその機能が提供されているか。機能 key を参照する。
- **release flag**: 段階公開したい機能にだけ付ける。任意。

この文書は判断待ちの案。実装（カタログ登録、ルートと画面の対応づけ、key のない機能を CI で検出するテスト、既定 off のガード）は、§6 の判断をもらってから行う。

- 調査した版: `main` @ `5e86f96`（2026-10-19）
- 参考にした実装: tachyonfield `packages/order/assets/product-features.json`、`apps/api/src/feature_delivery_gate.rs`、tachyon-apps #12209（`featureDeliveryValues` で契約 entitlement を合成）
- 本番の flag・契約・IAM は変更していない。

## 1. 今どこまで出し分けられているか

### API（axum のルート 140 件）

`src/course_authz.rs` の `ROUTES` は、保護されたルートを 1 件ずつ分類している。表にないルートは拒否する。表の 132 件に、公開ルート 8 件を足した数で数えた。

| 判定 | 件数 | 割合 |
|---|---:|---:|
| IAM あり（`Action` 51 / `UpstreamEnforced` 72 / `HandlerEnforced` 6） | 129 | 92% |
| bearer だけ（`/v1/me`、`/admin`、flag 評価） | 3 | 2% |
| 公開（health、SPA の静的ファイル、支払いリンク） | 8 | 6% |
| **release flag あり** | **0** | **0%** |
| **契約・プランあり** | **0** | **0%** |

- `UpstreamEnforced` は Field へ転送するルート。Field が ERP action で判定し、CourseBoard の usecase も `execute` の最初で golf action を要求する。
- サーバー側に flag の判定はない。`feature_flags.rs` は UI のための評価 endpoint（`POST /v1/course/feature-flags/evaluate`、`feature.courseboard.*` のみ）だけを持つ。

### 画面（SPA のルート 38 件。公開画面 4 件は除く）

| 判定 | 件数 | 割合 |
|---|---:|---:|
| IAM あり（`auth/capabilityRoutes.ts` と、キャンセル料の `capabilities.cancellationFees`） | 38 | 100% |
| release flag あり（`feature-flags/gated-routes.ts`） | 2 | 5% |
| 契約・プランあり | 0 | 0% |

flag があるのは `golf/reservation-report-import` と `golf/data-imports/courseboardReservationReports/documents` の 2 件。どちらも `feature.courseboard.reservation-report-import` を見ている。

### まとめ

| 状態 | API | 画面 |
|---|---:|---:|
| IAM だけ | 129 | 36 |
| flag だけ | 0 | 0 |
| IAM と flag | 0 | 2 |
| 何もなし（bearer だけ・公開） | 11 | 0 |
| 契約・プランが効いている | 0 | 0 |

IAM はほぼ全部に付いている。足りないのは、契約・プランの層がまったくないことと、機能をまとめて呼ぶ名前（機能 key）がないこと。

## 2. 粒度の案

**推奨: 業務機能単位。** IAM の `List*` / `Manage*` の 1 組を 1 機能とし、画面と API はその機能にぶら下げる。読取と更新の違いは `operationBindings`（`read` / `manage`）で表す。Field の `field.invoice.*` と同じ形にする。

| 案 | key の数 | 長所 | 短所 |
|---|---:|---|---|
| **業務機能単位（推奨）** | 26 | プランに載せる単位と、営業が売る単位が一致する。IAM の action の組と 1:1 に近いので、対応表が単純になる。 | 1 画面が複数機能を読むとき（台帳、ホーム）は、`requiredFeatureKeys` で明示する必要がある。 |
| 画面単位 | 38 | UI のガードは書きやすい。 | 同じ API を複数の画面が使う（台帳・タイムライン・配置）ので、API 側の key が決まらない。プランの行が増える。 |
| 操作単位 | 約 60 | 細かく売れる。 | IAM と二重になる。プランの管理者が扱いきれない。 |

親子関係は `requiredFeatureKeys` で表す（例: `courseboard.customers.reception` は `courseboard.customers` を必要とする）。Field の `customer_lookup` → `cancellation_fee` と同じ扱い。

## 3. 機能 key の案（26 件と、対象外）

key は `courseboard.` で始める。Core に渡す delivery key は、Field と同じく `feature.` + key とする（例: `feature.courseboard.tee_sheet`）。既存の flag `feature.courseboard.reservation-report-import`（ハイフン区切り）とは別の名前になる。

| # | 機能 key 案 | 画面 | 主な API | IAM read | IAM manage | release flag | requiredFeatureKeys |
|---:|---|---|---|---|---|---|---|
| 1 | `courseboard.tee_sheet` | `golf/ledger`, `golf/timeline` | tee-sheet, tee-ledger, reservations（作成・変更・取消・組・プラン） | `ListTeeSheet` | `ManageReservations` | なし | courses |
| 2 | `courseboard.tee_sheet.slot_overrides` | 台帳の枠開閉 | slot-overrides | `ListSlotOverrides` | `ManageSlotOverrides` | なし | tee_sheet |
| 3 | `courseboard.tee_sheet.checkin` | 台帳の来場受付 | reservations/:id/checkins | `ListTeeSheet` | `ManageReservations` | なし | tee_sheet |
| 4 | `courseboard.courses` | `golf/courses`, `golf/courses/:id` | courses, course-order, resources, schedule, time-slots, booking-horizon | `ListCourses` | `ManageCourses` | なし | — |
| 5 | `courseboard.products` | `golf/products(/:id)` | reservation-products, slots | `ListProducts` | `ManageProducts` | なし | courses |
| 6 | `courseboard.reservation_policy` | `golf/policy`, `settings/advanced` | reservation-policy, config, PUT player-tag-options | `ListReservationPolicy` | `ManageReservationPolicy` | なし | — |
| 7 | `courseboard.customers` | `golf/customers`, `/:id`, `call-list`, `settings/customer-grades` | customers, summaries, visits, registration, grade-rules | `ListCustomers` | `ManageCustomers` | なし | — |
| 8 | `courseboard.customers.reception` | `golf/customers/reception`, `settings/reception-fields` | reception-draft（OCR ジョブ）, reception-fields, consent-items, reception-values | `ListCustomers` | `ManageCustomers` | 候補（OCR） | customers |
| 9 | `courseboard.customers.cancellations` | `golf/customers/cancellations` | GET reservation-cancellations | `ListCustomers` | — | なし | customers |
| 10 | `courseboard.membership` | `settings/membership-plans`, `-discounts`, `-play-windows` | membership-plans, discounts, play-windows, customers/:id/membership 系 | `ListMembership` + `field:ListMembership` | `ManageMembershipPlans`, `AssignMembership` | なし | customers |
| 11 | `courseboard.caddies` | `golf/caddies(/:id)` | caddie-profiles, courses | `ListCaddies` | `ManageCaddies` | なし | — |
| 12 | `courseboard.caddies.dispatch` | `golf/caddies/dispatch`, `settings/caddie-duties` | caddie-assignments, reassignment, recommendations, auto-assignments, duties | `ListCaddieAssignments` | `ManageCaddieAssignments` | 候補（自動配置） | caddies, tee_sheet |
| 13 | `courseboard.caddies.availability` | シフト・タイムラインの出勤可否 | caddie-availabilities, submissions, deadlines | `ListCaddieAvailability` | `ManageCaddieAvailability` | なし | caddies |
| 14 | `courseboard.caddies.shifts` | `golf/caddies/shifts` | shift-rules, shifts, shift-plans, field-sync | `ListShifts` | `ManageShifts` | なし | caddies, caddies.availability |
| 15 | `courseboard.caddies.insights` | `golf/caddies/attendance` | attendance-snapshot(s), supply, course-supply, reinforcements, ratings | `ListCaddieInsights` | — | なし | caddies |
| 16 | `courseboard.caddies.rank_fees` | 精算・配置の単価 | caddie-rank-fees, history, fee-alignment | `ListCaddieRankFees` | `ManageCaddieRankFees` | なし | caddies |
| 17 | `courseboard.caddies.payroll` | `golf/caddies/payroll` | caddie-payroll-summary, export.csv | `ListPayroll` | — | なし | caddies.rank_fees |
| 18 | `courseboard.staff` | `staff(/:id)` | Field `/v1/erp/staff`（`/field-api` 経由） | `field:ListHrm` | `field:ManageHrm` | なし | caddies |
| 19 | `courseboard.budgets` | `golf/budgets` | daily-budgets, achievement, import | `ListBudgets` | `ManageBudgets` | なし | courses |
| 20 | `courseboard.settlement` | `golf/settlement` | monthly-settlement, export.csv | `ListSettlement` | — | なし | — |
| 21 | `courseboard.fee_simulator` | `golf/simulator` | simulator/calculate, simulate/range, pricing-settings | `CalculateFees` | `ManageReservationPolicy`（PUT pricing-settings） | なし | — |
| 22 | `courseboard.reservation_report_import` | `golf/reservation-report-import`, `…/documents(/:jobId)` | reservation-report-imports, preview, entries, migration, common-import-owner | `ListReservationReports` | `ImportReservationReports` | **あり** `feature.courseboard.reservation-report-import` | courses |
| 23 | `courseboard.data_imports` | `golf/data-imports(/:target)` | `/v1/course/data-imports/*`（取込み先ごとの action） | `field:ListBridgeDefinitions` | 取込み先の Manage | なし | 取込み先の key |
| 24 | `courseboard.data_exports` | `settings/data-exports` | `/v1/course/data-exports/*`, Field `/v1/bridge/exports/*` | `field:ListBridgeExportDefinitions` + 出力元の List | — | なし | 出力元の key |
| 25 | `courseboard.cancellation_fee` | `cancellation-fees`, `/new`, `/:id`, 公開 `pay/:token` | Field `/v1/cancellation-fees*`（`/field-api` 経由）, 旧 `/cancellation-fee-collections`, `/public/cancellation-fees/*`, POST reservation-cancellations/fees | `field:ListCancellationFees` | `field:ManageCancellationFees` | なし | — （§6 Q4） |
| 26 | `courseboard.course_map` | `course-map` | ローカル WebSocket（`ws://127.0.0.1:9001`、desktop のみ） | `ListCourses` | — | 候補 | courses |

IAM の列は `field_extension_golf:` を省いて書いた。`field:` で始まるものは Field の action。

### 対象外（key を付けない）

| 区分 | ルート・画面 | 理由 |
|---|---|---|
| 公開 | `/`, `/healthz`, `/openapi.json`, `/swagger-ui/*`, `/ui/*`、画面 `download`, `privacy`, `terms` | 認証前。契約の判定ができない。 |
| 基盤 | `/v1/me`, `/admin`（リダイレクト）, `/v1/course/feature-flags/evaluate`, `/v1/field/client-capabilities`, `/v1/course/extension-status`、画面 `golf`（ホーム）, `settings`（ハブ） | どの機能を使う場合も必要。ホームとハブは、中のリンクを機能ごとに絞る。 |
| M2M | `POST /calculate`, `POST /simulate/range`（`CalculateTax`、Field core が呼ぶ） | 利用者の bearer がない。Core の合成は `contract_unavailable` で閉じてしまう（#12209 の「未対応」）。 |
| 社内 | `POST /v1/course/demo-seed`（`SeedDemoBoard`） | 顧客に売る機能ではない。 |
| 設定 | `settings/members`（Field `/v1/field/iam/users`, `field:ManageUsers`） | テナントの利用者管理。Field の機能として扱う。 |

旧管理画面 `/admin/caddies`, `/admin/shifts`, `/admin/reservations`, `/admin/dispatch` は、`courseboard.caddies` と `courseboard.caddies.dispatch` に入れた。廃止するなら対象から外す。

## 4. `/field-api/*` の扱い

`/field-api/*` は Field への汎用プロキシで、`ROUTES` では 1 行（`UpstreamEnforced`）になっている。画面が使う転送先は次のとおり。

| 転送先 | 機能 key | Field 側のガード（tachyonfield #1642） |
|---|---|---|
| `/v1/cancellation-fees*` | `courseboard.cancellation_fee` | なし（`/v1/invoices/**` と cancellation-fee の帳票だけが対象） |
| `/v1/invoices` | `courseboard.customers.cancellations`（キャンセル一覧から開く請求シート。`CancellationsPage.tsx:923`） | `field.invoice.general` |
| `/v1/erp/staff*` | `courseboard.staff`（キャディ登録と打刻は `courseboard.caddies` からも呼ぶ） | なし |
| `/v1/field/iam/users*` | 対象外（設定） | なし |
| `/v1/bridge/*` | `courseboard.data_imports` / `courseboard.data_exports` | なし |

CourseBoard のガードは、`/field-api` の後ろのパスで分類する。分類できないパスは、enforce のときに拒否する。

## 5. キャンセル料単独提供（PLT-5223〜5234）の認可設計との照合

実装はしていない。食い違い、または確認が必要な点を挙げる。

1. **Core はまだ「flag なしの安定機能」を評価できない（要対応・別リポジトリ）。** tachyon-apps #12209 の `featureDeliveryValues` は、delivery key をそのまま release flag として引く。flag が OFF または未登録なら、契約を見ずに `enabled: false` を返す。一方、PLT-5695 は「公開flagを持たない安定機能は契約とIAMで評価」「flag廃止で提供権を失わせない」としていて、今回合意した方針も同じ。このままだと、flag を付けない 25 件はどれも常に閉じる。さらに、合成の対象（`governs`）は `payment::field_contract_entitlement` に Field の 4 key だけを固定で書いた表になっている。CourseBoard の key を足すには、Core の変更が必要。
2. **キャンセル料の action が 2 系統ある。** PLT-5223 は「Extensionは使わず `field:ListCancellationFees` / `field:ManageCancellationFees`」と確定した。しかし CourseBoard の `POST /v1/course/reservation-cancellations/fees` は、今も `field_extension_golf:ManageCancellationFees` を要求している（`src/course/domain/actions.rs:100`、`settle_cancellation_fees.rs`、manifest の 405 行目と 521 行目）。画面（`cancellation-fees*`）は Field の `cancellationFees.list/manage`（`field:*`）を見ている。カタログの `requiredActions` には `field:*` だけを書く案にしたが、旧 endpoint は extension action のまま残る。この endpoint を廃止するか `field:*` へ移すかは、PLT-4119 / PLT-5228 の側で決める。
3. **UI の flag ゲートは fail-open。** `gated-routes.ts` は、flag の取得に失敗すると画面を表示する。release flag はこれでよいが、PLT-5229 は「既定で全画面を許可しない」「flag取得エラー時の表示許可を認可へ流用しない」としている。そのため、契約によるゲートは別の関数にして fail-closed にする（判定できないときは読み込み表示のまま、再試行できるようにする）。既存の flag ゲートの挙動は変えない。
4. **UI の判定を 1 本にするかどうか。** PLT-5695 / PLT-5229 は「画面側に第二の提供権判定を作らない」としている。案では、UI は IAM を `/v1/field/client-capabilities` から、提供権を Core の `featureDeliveryValues`（CourseBoard API 経由）から受け取り、AND するだけにする。UI で独自に計算はしない。ただし、client-capabilities に提供権を合成する（PLT-5695 の実装）なら、受け取り元を 1 本にするべき（§6 Q5）。

## 6. 判断してほしいこと

| # | 質問 | 推奨 |
|---|---|---|
| Q1 | 粒度は業務機能単位（§3 の 26 件）でよいか | はい |
| Q2 | flag なしの key を Core で評価できるようにするには、どちらにするか: (A) Core を変え、カタログで `releaseGates: []` と明示した key は契約だけで判定する／(B) 当面は key ごとに常時 ON の flag を Core に登録してしのぐ | A（PLT-5695 と合う。B は「flag を廃止しても提供権は消えない」を満たせない） |
| Q3 | カタログの置き場所: CourseBoard が `courseboard-product-features.json`（Field と同じ schema、`productScope: courseboard`）を持ち、Field がそれを取り込んで catalogFeatureId を発行する、でよいか | はい |
| Q4 | CourseBoard のキャンセル料は `courseboard.cancellation_fee` として独立させるか、Field の `field.invoice.cancellation_fee` をそのまま使うか | 独立（PLT-5223 は製品ごとの提供上限を求めている） |
| Q5 | UI の受け取り元: 案のとおり「client-capabilities（IAM）∧ featureDeliveryValues（提供権）」か、client-capabilities に一本化するか | 案のとおり。一本化は PLT-5695 の client-capabilities 側が済んでから |
| Q6 | 旧 `/admin/*`（サーバーで描画する管理画面）と旧 `/cancellation-fee-collections` を key の対象に残すか | 残す。廃止は別 PR |

## 付録 A. API ルートと機能 key の対応（全 140 件）

`src/course_authz.rs` の `ROUTES` と公開ルートから生成した。IAM の列は、CourseBoard が自分で判定するルートについてだけ action を書いた。Field へ転送するルートの action は、§3 の表を見てほしい。

| method | path | 機能 key 案 | 現在の IAM | release flag |
|---|---|---|---|---|
| GET | `/v1/course/data-exports/objects` | `courseboard.data_exports` | handler 内で判定 | なし |
| GET | `/v1/course/data-exports/:source_key/rows` | `courseboard.data_exports` | handler 内で判定 | なし |
| * | `/v1/course/data-imports/*path` | `courseboard.data_imports` | handler 内で判定 | なし |
| POST | `/v1/course/common-import-owner/:operation` | `courseboard.reservation_report_import` | `IMPORT_RESERVATION_REPORTS` | なし |
| POST | `/calculate` | `(exempt:m2m-operator)` | handler 内で判定 | なし |
| POST | `/simulate/range` | `(exempt:m2m-operator)` | handler 内で判定 | なし |
| POST | `/v1/course/simulator/calculate` | `courseboard.fee_simulator` | `CALCULATE_FEES` | なし |
| POST | `/v1/course/simulator/simulate/range` | `courseboard.fee_simulator` | `CALCULATE_FEES` | なし |
| GET | `/v1/course/pricing-settings` | `courseboard.fee_simulator` | `CALCULATE_FEES` | なし |
| PUT | `/v1/course/pricing-settings` | `courseboard.fee_simulator` | `MANAGE_RESERVATION_POLICY` | なし |
| GET | `/v1/course/player-tag-options` | `courseboard.tee_sheet` | `LIST_TEE_SHEET` | なし |
| PUT | `/v1/course/player-tag-options` | `courseboard.reservation_policy` | `MANAGE_RESERVATION_POLICY` | なし |
| POST | `/cancellation-fee-collections` | `courseboard.cancellation_fee` | handler 内で判定 | なし |
| GET | `/v1/course/slot-overrides` | `courseboard.tee_sheet.slot_overrides` | `LIST_SLOT_OVERRIDES` | なし |
| PUT | `/v1/course/slot-overrides` | `courseboard.tee_sheet.slot_overrides` | `MANAGE_SLOT_OVERRIDES` | なし |
| DELETE | `/v1/course/slot-overrides` | `courseboard.tee_sheet.slot_overrides` | `MANAGE_SLOT_OVERRIDES` | なし |
| PUT | `/v1/course/caddie-assignments/:assignment_id/reassignment` | `courseboard.caddies.dispatch` | `MANAGE_CADDIE_ASSIGNMENTS` | なし |
| GET | `/v1/course/caddie-duties` | `courseboard.caddies.dispatch` | `LIST_CADDIE_ASSIGNMENTS` | なし |
| PUT | `/v1/course/caddie-duties` | `courseboard.caddies.dispatch` | `MANAGE_CADDIE_ASSIGNMENTS` | なし |
| GET | `/v1/course/caddie-duty-assignments` | `courseboard.caddies.dispatch` | `LIST_CADDIE_ASSIGNMENTS` | なし |
| POST | `/v1/course/caddie-duty-assignments` | `courseboard.caddies.dispatch` | `MANAGE_CADDIE_ASSIGNMENTS` | なし |
| DELETE | `/v1/course/caddie-duty-assignments/:duty_id` | `courseboard.caddies.dispatch` | `MANAGE_CADDIE_ASSIGNMENTS` | なし |
| GET | `/v1/course/caddie-shift-rules` | `courseboard.caddies.shifts` | `LIST_SHIFTS` | なし |
| PUT | `/v1/course/caddie-shift-rules` | `courseboard.caddies.shifts` | `MANAGE_SHIFTS` | なし |
| GET | `/v1/course/caddie-shifts` | `courseboard.caddies.shifts` | `LIST_SHIFTS` | なし |
| PUT | `/v1/course/caddie-shifts/:caddie_profile_id/:date` | `courseboard.caddies.shifts` | `MANAGE_SHIFTS` | なし |
| POST | `/v1/course/caddie-shift-plans/:year_month` | `courseboard.caddies.shifts` | `MANAGE_SHIFTS` | なし |
| POST | `/v1/course/caddie-shift-plans/:year_month/preview` | `courseboard.caddies.shifts` | `MANAGE_SHIFTS` | なし |
| GET | `/v1/course/caddie-shift-plans/:year_month/field-sync` | `courseboard.caddies.shifts` | `LIST_SHIFTS` | なし |
| POST | `/v1/course/caddie-shift-plans/:year_month/field-sync` | `courseboard.caddies.shifts` | `MANAGE_SHIFTS` | なし |
| GET | `/v1/course/caddie-availability-deadlines/:year_month` | `courseboard.caddies.availability` | `LIST_CADDIE_AVAILABILITY` | なし |
| PUT | `/v1/course/caddie-availability-deadlines/:year_month` | `courseboard.caddies.availability` | `MANAGE_CADDIE_AVAILABILITY` | なし |
| POST | `/v1/course/demo-seed` | `(exempt:internal)` | `SEED_DEMO_BOARD` | なし |
| GET | `/admin` | `(exempt:platform)` | bearer のみ | なし |
| GET | `/v1/me` | `(exempt:platform)` | bearer のみ | なし |
| POST | `/v1/course/feature-flags/evaluate` | `(exempt:platform)` | bearer のみ | なし |
| * | `/admin/caddies` | `courseboard.caddies (legacy /admin)` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/admin/caddies/:id` | `courseboard.caddies (legacy /admin)` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/admin/shifts` | `courseboard.caddies (legacy /admin)` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/admin/shifts/:id` | `courseboard.caddies (legacy /admin)` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/admin/shifts/:id/cancel` | `courseboard.caddies (legacy /admin)` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/admin/reservations` | `courseboard.caddies.dispatch (legacy /admin)` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/admin/reservations/:reservation_id/assign` | `courseboard.caddies.dispatch (legacy /admin)` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/admin/reservations/:reservation_id/unassign` | `courseboard.caddies.dispatch (legacy /admin)` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/admin/dispatch` | `courseboard.caddies.dispatch (legacy /admin)` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/field-api/*` | `(per inner path: 下記 §4)` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/field/client-capabilities` | `(exempt:platform)` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/tee-sheet` | `courseboard.tee_sheet` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/tee-ledger` | `courseboard.tee_sheet` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/reservations` | `courseboard.tee_sheet` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/reservations/:reservation_id` | `courseboard.tee_sheet` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/reservations/:reservation_id/cancel` | `courseboard.tee_sheet` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/reservations/:reservation_id/party` | `courseboard.tee_sheet` | Field が ERP action で判定 + usecase の golf action | なし |
| GET | `/v1/course/reservations/:reservation_id/checkins` | `courseboard.tee_sheet.checkin` | `LIST_TEE_SHEET` | なし |
| POST | `/v1/course/reservations/:reservation_id/checkins` | `courseboard.tee_sheet.checkin` | `MANAGE_RESERVATIONS` | なし |
| * | `/v1/course/reservations/:reservation_id/plan` | `courseboard.tee_sheet` | Field が ERP action で判定 + usecase の golf action | なし |
| GET | `/v1/course/course-order` | `courseboard.courses` | `LIST_COURSES` | なし |
| PUT | `/v1/course/course-order` | `courseboard.courses` | `MANAGE_COURSES` | なし |
| * | `/v1/course/courses` | `courseboard.courses` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/courses/:id` | `courseboard.courses` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/courses/:id/resource` | `courseboard.courses` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/courses/:id/schedule` | `courseboard.courses` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/courses/:id/time-slots/generate` | `courseboard.courses` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/booking-horizon` | `courseboard.courses` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/resources` | `courseboard.courses` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/reservation-products` | `courseboard.products` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/reservation-products/:service_id` | `courseboard.products` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/reservation-products/:service_id/slots` | `courseboard.products` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/customers` | `courseboard.customers` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/customer-consent-items` | `courseboard.customers.reception` | `MANAGE_CUSTOMERS` | なし |
| * | `/v1/course/customer-consent-items/:consent_item_id` | `courseboard.customers.reception` | `MANAGE_CUSTOMERS` | なし |
| GET | `/v1/course/customer-reception-fields` | `courseboard.customers.reception` | `LIST_CUSTOMERS` | なし |
| PUT | `/v1/course/customer-reception-fields` | `courseboard.customers.reception` | `MANAGE_CUSTOMERS` | なし |
| POST | `/v1/course/customer-reception-fields/analysis` | `courseboard.customers.reception` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/customers/reception-draft` | `courseboard.customers.reception` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/customers/reception-draft/jobs` | `courseboard.customers.reception` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/customers/reception-draft/jobs/:job_id` | `courseboard.customers.reception` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/customers/reception-draft/jobs/:job_id/confirm` | `courseboard.customers.reception` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/customers/reception-draft/jobs/:job_id/advance` | `courseboard.customers.reception` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/customers/:customer_id` | `courseboard.customers` | Field が ERP action で判定 + usecase の golf action | なし |
| PUT | `/v1/course/customers/:customer_id/reception-values` | `courseboard.customers.reception` | `MANAGE_CUSTOMERS` | なし |
| * | `/v1/course/customers/:customer_id/visits` | `courseboard.customers` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/customers/:customer_id/membership-activities` | `courseboard.membership` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/customers/:customer_id/registration` | `courseboard.customers` | `LIST_CUSTOMERS` | なし |
| * | `/v1/course/customers/:customer_id/member-number` | `courseboard.membership` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/customers/:customer_id/membership` | `courseboard.membership` | Field が ERP action で判定 + usecase の golf action | なし |
| GET | `/v1/course/customer-summaries` | `courseboard.customers` | `LIST_CUSTOMERS` | なし |
| GET | `/v1/course/reservation-cancellations` | `courseboard.customers.cancellations` | `LIST_CUSTOMERS` | なし |
| POST | `/v1/course/reservation-cancellations/fees` | `courseboard.cancellation_fee` | `MANAGE_CANCELLATION_FEES` | なし |
| GET | `/v1/course/customer-grade-rules` | `courseboard.customers` | `LIST_CUSTOMERS` | なし |
| PUT | `/v1/course/customer-grade-rules` | `courseboard.customers` | `MANAGE_CUSTOMERS` | なし |
| GET | `/v1/course/membership-discounts` | `courseboard.membership` | `LIST_MEMBERSHIP` | なし |
| PUT | `/v1/course/membership-discounts` | `courseboard.membership` | `MANAGE_MEMBERSHIP_PLANS` | なし |
| GET | `/v1/course/membership-play-windows` | `courseboard.membership` | `LIST_MEMBERSHIP` | なし |
| PUT | `/v1/course/membership-play-windows` | `courseboard.membership` | `MANAGE_MEMBERSHIP_PLANS` | なし |
| * | `/v1/course/membership-plans` | `courseboard.membership` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/membership-plans/:plan_id` | `courseboard.membership` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/reservation-report-imports` | `courseboard.reservation_report_import` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/reservation-report-imports/preview` | `courseboard.reservation_report_import` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/reservation-report-entries` | `courseboard.reservation_report_import` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/reservation-report-migration` | `courseboard.reservation_report_import` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/caddie-profiles` | `courseboard.caddies` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/caddie-profiles/:id` | `courseboard.caddies` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/caddie-profiles/:id/courses` | `courseboard.caddies` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/caddie-assignments` | `courseboard.caddies.dispatch` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/caddie-assignments/:id` | `courseboard.caddies.dispatch` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/caddie-availabilities` | `courseboard.caddies.availability` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/caddie-availabilities/:caddie_id/:date` | `courseboard.caddies.availability` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/caddie-availability-submissions/:year_month` | `courseboard.caddies.availability` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/caddie-recommendations` | `courseboard.caddies.dispatch` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/caddie-attendance-snapshot` | `courseboard.caddies.insights` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/caddie-attendance-snapshots` | `courseboard.caddies.insights` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/caddie-supply` | `courseboard.caddies.insights` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/caddie-auto-assignments` | `courseboard.caddies.dispatch` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/caddie-course-supply` | `courseboard.caddies.insights` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/caddie-reinforcements` | `courseboard.caddies.insights` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/caddie-ratings` | `courseboard.caddies.insights` | Field が ERP action で判定 + usecase の golf action | なし |
| GET | `/v1/course/caddie-rank-fees` | `courseboard.caddies.rank_fees` | `LIST_CADDIE_RANK_FEES` | なし |
| GET | `/v1/course/caddie-rank-fees/history` | `courseboard.caddies.rank_fees` | `LIST_CADDIE_RANK_FEES` | なし |
| PUT | `/v1/course/caddie-rank-fees` | `courseboard.caddies.rank_fees` | `MANAGE_CADDIE_RANK_FEES` | なし |
| GET | `/v1/course/caddie-fee-alignment` | `courseboard.caddies.rank_fees` | `LIST_CADDIE_RANK_FEES` | なし |
| POST | `/v1/course/caddie-fee-alignment` | `courseboard.caddies.rank_fees` | `MANAGE_CADDIE_RANK_FEES` | なし |
| * | `/v1/course/caddie-payroll-summary` | `courseboard.caddies.payroll` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/caddie-payroll-summary/export.csv` | `courseboard.caddies.payroll` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/reservation-policy` | `courseboard.reservation_policy` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/daily-budgets` | `courseboard.budgets` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/daily-budgets/achievement` | `courseboard.budgets` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/daily-budgets/import` | `courseboard.budgets` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/monthly-settlement` | `courseboard.settlement` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/monthly-settlement/export.csv` | `courseboard.settlement` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/extension-status` | `(exempt:platform)` | Field が ERP action で判定 + usecase の golf action | なし |
| * | `/v1/course/config` | `courseboard.reservation_policy` | Field が ERP action で判定 + usecase の golf action | なし |
| GET | `/public/cancellation-fees/:token` | `courseboard.cancellation_fee` | なし | なし |
| POST | `/public/cancellation-fees/:token/stripe-payment-intent` | `courseboard.cancellation_fee` | なし | なし |
| POST | `/public/cancellation-fees/:token/confirm` | `courseboard.cancellation_fee` | なし | なし |
| GET | `/healthz` | `(exempt:public)` | なし | なし |
| GET | `/` | `(exempt:public)` | なし | なし |
| GET | `/openapi.json` | `(exempt:public)` | なし | なし |
| GET | `/swagger-ui/*` | `(exempt:public)` | なし | なし |
| GET | `/ui/*` | `(exempt:public)` | なし | なし |


## 付録 B. 画面と機能 key の対応（全 42 件）

IAM の列は `auth/capabilityRoutes.ts` の `routeActionRequirement` にある条件。`all` は全部が必要、`any` はどれか 1 つで足りる。`field_extension_golf:` は省いた。

| 画面ルート | 機能 key 案 | 現在の IAM | release flag |
|---|---|---|---|
| `golf`（ホーム） | 対象外（基盤。タイルを機能ごとに絞る） | any: golf の List 系 18 件 | なし |
| `golf/ledger` | `courseboard.tee_sheet` | all: ListTeeSheet, ListSlotOverrides, ListCourses, ListProducts, ListCaddieInsights, ListCaddieAssignments, ListShifts | なし |
| `golf/timeline` | `courseboard.tee_sheet` | all: ListTeeSheet, ListCaddieAssignments, ListCaddies, ListCaddieAvailability, ListCourses | なし |
| `golf/courses`, `golf/courses/:id` | `courseboard.courses` | ListCourses | なし |
| `golf/products(/:id)`, `golf/reservation-products(/:id)` | `courseboard.products` | all: ListProducts, ListCourses | なし |
| `golf/policy` | `courseboard.reservation_policy` | all: ListCourses, ListReservationPolicy | なし |
| `golf/customers` | `courseboard.customers` | ListCustomers | なし |
| `golf/customers/:id` | `courseboard.customers` | all: ListCustomers, ListMembership, field:ListMembership, ListCourses | なし |
| `golf/customers/call-list` | `courseboard.customers` | ListCustomers | なし |
| `golf/customers/reception` | `courseboard.customers.reception` | all: ListCustomers, ManageCustomers | なし |
| `golf/customers/cancellations` | `courseboard.customers.cancellations` | ListCustomers | なし |
| `golf/caddies(/:id)` | `courseboard.caddies` | all: ListCaddies, ListCaddieAssignments, ListCaddieInsights, ListCourses | なし |
| `golf/caddies/dispatch` | `courseboard.caddies.dispatch` | all: ListCaddies, ListCaddieAssignments, ListCaddieInsights, ListTeeSheet, ListCaddieAvailability | なし |
| `golf/caddies/attendance` | `courseboard.caddies.insights` | all: ListCaddies, ListCaddieInsights | なし |
| `golf/caddies/shifts` | `courseboard.caddies.shifts` | all: ListShifts, ListCaddies, ListCaddieAssignments, ListCaddieAvailability, ListCourses | なし |
| `golf/caddies/payroll` | `courseboard.caddies.payroll` | all: ListPayroll, ListCaddieRankFees | なし |
| `staff(/:id)` | `courseboard.staff` | all: field:ListHrm, ListCaddies, ListCaddieInsights | なし |
| `golf/budgets` | `courseboard.budgets` | all: ListCourses, ListBudgets | なし |
| `golf/settlement` | `courseboard.settlement` | all: ListSettlement, ListCourses | なし |
| `golf/simulator` | `courseboard.fee_simulator` | all: CalculateFees, ListMembership, field:ListMembership | なし |
| `golf/reservation-report-import` | `courseboard.reservation_report_import` | all: ListReservationReports, ListCourses | **あり** |
| `golf/data-imports/courseboardReservationReports/documents(/:jobId)` | `courseboard.reservation_report_import` | field:ListBridgeDefinitions | **あり** |
| `golf/data-imports(/:target)` | `courseboard.data_imports` | field:ListBridgeDefinitions | なし |
| `cancellation-fees`, `cancellation-fees/:id` | `courseboard.cancellation_fee` | `cancellationFees.list`（field:ListCancellationFees） | なし |
| `cancellation-fees/new` | `courseboard.cancellation_fee` | `cancellationFees.manage`（field:ManageCancellationFees） | なし |
| `course-map` | `courseboard.course_map` | ListCourses | なし |
| `settings`（ハブ） | 対象外（基盤。リンクを機能ごとに絞る） | any: 8 件 | なし |
| `settings/advanced` | `courseboard.reservation_policy` | all: ListExtensionStatus, ListTeeSheet, ListReservationPolicy | なし |
| `settings/data-exports` | `courseboard.data_exports` | all: field:ListBridgeExportDefinitions ＋ any: 出力元の List 14 件 | なし |
| `settings/members` | 対象外（Field の利用者管理） | field:ManageUsers | なし |
| `settings/membership-plans`, `-discounts`, `-play-windows` | `courseboard.membership` | all: ListMembership, field:ListMembership | なし |
| `settings/customer-grades` | `courseboard.customers` | ListCustomers | なし |
| `settings/caddie-duties` | `courseboard.caddies.dispatch` | ListCaddieAssignments | なし |
| `settings/reception-fields` | `courseboard.customers.reception` | all: ListCustomers, ManageCustomers | なし |
| `download`, `privacy`, `terms`, `pay/:token` | 対象外（公開。`pay/:token` は署名付きリンクで、`courseboard.cancellation_fee` の公開側） | なし | なし |

画面の中のボタンは `capabilityActionAllowed(<Manage action>)` で出し分けている。key を付けた後は、この判定を各 key の `operationBindings.manage` に寄せる。
