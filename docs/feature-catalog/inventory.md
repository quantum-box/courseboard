# CourseBoard 機能カタログ

テナント別デリバリ（Field の商品プランに含まれる機能だけをテナントが使える状態）を CourseBoard に広げるための棚卸し。CourseBoard のすべての画面・API ルート・操作に、安定した**機能 key** の案を付ける。

出し分けは次の 3 つの AND で決める。

- **IAM**: その人がその操作をしてよいか（既存の action）。
- **契約・プラン**: その会社にその機能が提供されているか。機能 key を参照する。
- **release flag**: 段階公開したい機能にだけ付ける。任意。

§1〜§5 は棚卸し、§6 は決めたこと、§7 は実装の内容。カタログの正本は `src/feature_delivery/catalog.rs` で、そこから生成した `.tachyon/manifests/courseboard-product-features.yml` を tachyon CLI で apply する。

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

## 3. 機能 key（26 件と、対象外）

key は `courseboard.` で始める。Core に渡す delivery key は、Field と同じく `feature.` + key とする（例: `feature.courseboard.tee_sheet`）。既存の flag `feature.courseboard.reservation-report-import`（ハイフン区切り）とは別の名前になる。

| # | 機能 key | 画面 | 主な API | IAM read | IAM manage | release flag | requiredFeatureKeys |
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
| 11 | `courseboard.caddies` | `golf/caddies(/:id)` | caddie-profiles, courses | `ListCaddies` | `ManageCaddies` | なし | courses, staff |
| 12 | `courseboard.caddies.dispatch` | `golf/caddies/dispatch`, `settings/caddie-duties` | caddie-assignments, reassignment, recommendations, auto-assignments, duties | `ListCaddieAssignments` | `ManageCaddieAssignments` | 候補（自動配置） | caddies, tee_sheet |
| 13 | `courseboard.caddies.availability` | シフト・タイムラインの出勤可否 | caddie-availabilities, submissions, deadlines | `ListCaddieAvailability` | `ManageCaddieAvailability` | なし | caddies |
| 14 | `courseboard.caddies.shifts` | `golf/caddies/shifts` | shift-rules, shifts, shift-plans, field-sync | `ListShifts` | `ManageShifts` | なし | caddies, caddies.availability |
| 15 | `courseboard.caddies.insights` | `golf/caddies/attendance` | attendance-snapshot(s), supply, course-supply, reinforcements, ratings | `ListCaddieInsights` | — | なし | caddies |
| 16 | `courseboard.caddies.rank_fees` | 精算・配置の単価 | caddie-rank-fees, history, fee-alignment | `ListCaddieRankFees` | `ManageCaddieRankFees` | なし | caddies |
| 17 | `courseboard.caddies.payroll` | `golf/caddies/payroll` | caddie-payroll-summary, export.csv | `ListPayroll` | — | なし | caddies.rank_fees |
| 18 | `courseboard.staff` | `staff(/:id)` | Field `/v1/erp/staff`（`/field-api` 経由。キャディ登録・打刻も含む） | `field:ListHrm` | `field:ManageHrm` | なし | — |
| 19 | `courseboard.budgets` | `golf/budgets` | daily-budgets, achievement, import | `ListBudgets` | `ManageBudgets` | なし | courses |
| 20 | `courseboard.settlement` | `golf/settlement` | monthly-settlement, export.csv | `ListSettlement` | — | なし | — |
| 21 | `courseboard.fee_simulator` | `golf/simulator` | simulator/calculate, simulate/range, pricing-settings | `CalculateFees` | `ManageReservationPolicy`（PUT pricing-settings） | なし | membership（会員料金の計算で会員割引を読むため） |
| 22 | `courseboard.reservation_report_import` | `golf/reservation-report-import`, `…/documents(/:jobId)` | reservation-report-imports, preview, entries, migration, common-import-owner | `ListReservationReports` | `ImportReservationReports` | **あり** `feature.courseboard.reservation-report-import` | courses |
| 23 | `courseboard.data_imports` | `golf/data-imports(/:target)` | `/v1/course/data-imports/*` | `field:ListBridgeDefinitions` | `field:PreviewBridgeRun`, `field:ExecuteBridgeDrafts` | なし | — |
| 24 | `courseboard.data_exports` | `settings/data-exports` | `/v1/course/data-exports/*`, Field `/v1/bridge/exports/*` | `field:ListBridgeExportDefinitions` | `field:ManageBridgeExportDefinitions` | なし | — |
| 25 | `courseboard.cancellation_fee` | `cancellation-fees`, `/new`, `/:id` | Field `/v1/cancellation-fees*`（`/field-api` 経由）, POST reservation-cancellations/fees | `field:ListCancellationFees` | `field:ManageCancellationFees` | なし | — |
| 26 | `courseboard.course_map` | `course-map` | ローカル WebSocket（`ws://127.0.0.1:9001`、desktop のみ） | `ListCourses` | — | 候補 | courses |

IAM の列は `field_extension_golf:` を省いて書いた。`field:` で始まるものは Field の action。

### 対象外（key を付けない）

| 区分 | ルート・画面 | 理由 |
|---|---|---|
| 公開 | `/`, `/healthz`, `/openapi.json`, `/swagger-ui/*`, `/ui/*`, `/public/cancellation-fees/*`、画面 `download`, `privacy`, `terms`, `pay/:token` | 認証前。契約の判定ができない。支払いリンクは、契約が終わった後も発行済みの請求を払えるようにする（PLT-5234）。 |
| 基盤 | `/v1/me`, `/admin`（リダイレクト）, `/v1/course/feature-flags/evaluate`, `/v1/course/feature-deliveries/evaluate`, `/v1/field/client-capabilities`, `/v1/course/tenant-timezone`、画面 `golf`（ホーム）, `settings`（ハブ） | どの機能を使う場合も必要。ホームとハブは、中のリンクを機能ごとに絞る。tenant-timezone は時計に使うタイムゾーンだけを返す。拡張設定の全体（`extension-status`）は `courseboard.reservation_policy` に入れる。 |
| M2M | `POST /calculate`, `POST /simulate/range`（`CalculateTax`、Field core が呼ぶ）、旧 `POST /cancellation-fee-collections` | 利用者の bearer と `x-operator-id` がない。Core の合成は `contract_unavailable` で閉じてしまう（#12209 の「未対応」）。旧 collection は新規作成を 410 で止めている（PLT-4119）。 |
| 社内 | `POST /v1/course/demo-seed`（`SeedDemoBoard`） | 顧客に売る機能ではない。 |
| 設定 | `settings/members`（Field `/v1/field/iam/users`, `field:ManageUsers`） | テナントの利用者管理。Field の機能として扱う。 |

旧管理画面 `/admin/caddies`, `/admin/shifts`, `/admin/reservations`, `/admin/dispatch` は、`courseboard.caddies` と `courseboard.caddies.dispatch` に入れた。廃止するなら対象から外す。

## 4. `/field-api/*` の扱い

`/field-api/*` は Field への汎用プロキシで、`ROUTES` では 1 行（`UpstreamEnforced`）になっている。画面が使う転送先は次のとおり。

| 転送先 | 機能 key | Field 側のガード（tachyonfield #1642） |
|---|---|---|
| `/v1/cancellation-fees*` | `courseboard.cancellation_fee` | なし（`/v1/invoices/**` と cancellation-fee の帳票だけが対象） |
| `GET /v1/invoices?reason=cancellation_fee` | `courseboard.customers.cancellations`（キャンセル一覧の請求状況）。reason の絞り込みがない一覧は拒否する | `field.invoice.general` |
| `POST /v1/invoices`（`sources` がすべて `reason: cancellation_fee`） | `courseboard.cancellation_fee`（キャンセル一覧の請求・免除。画面でもこの機能がなければボタンを出さない）。他の用途の請求書は拒否する | `field.invoice.general` |
| `/v1/invoices/:id` 系（詳細・更新・送付） | 未分類（CourseBoard は使わない。enforce で拒否） | `field.invoice.general` |

CourseBoard 側のこの絞り込みは、Field 自身の請求書の範囲制御（PLT-5227）の代わりにはならない。Field の汎用 API を直接呼ばれた場合に備えて、Field 側の対応も必要。
| `/v1/erp/reservations/:id/billing-invoice` | `courseboard.settlement`（月次精算の請求書発行） | なし |
| `/v1/erp/staff*`（一覧・登録・編集・削除・打刻） | `courseboard.staff`（キャディは Field の社員にキャディ情報を付けたものなので、`courseboard.caddies` が `courseboard.staff` を要件に持つ） | なし |
| `GET /v1/erp/reservation-types` | `courseboard.tee_sheet` | なし |
| `GET /v1/erp/orders/:id` | `courseboard.settlement` | なし |
| `GET /v1/field/client-context` | 対象外（基盤） | なし |
| `/v1/field/iam/users*` | 対象外（設定） | なし |
| `/v1/bridge/exports/*` | `courseboard.data_exports` | なし |

CourseBoard のガードは、`/field-api` の後ろのパスで分類する。分類できないパスは、enforce のときに拒否する。

## 5. キャンセル料単独提供（PLT-5223〜5234）の認可設計との照合

1 と 2 は既存の設計との食い違いで、この PR では直していない。3 と 4 は、この PR の実装で設計に合わせた点。

1. **Core はまだ「flag なしの安定機能」を評価できない（要対応・別リポジトリ）。** tachyon-apps #12209 の `featureDeliveryValues` は、delivery key をそのまま release flag として引く。flag が OFF または未登録なら、契約を見ずに `enabled: false` を返す。一方、PLT-5695 は「公開flagを持たない安定機能は契約とIAMで評価」「flag廃止で提供権を失わせない」としていて、今回合意した方針も同じ。このままだと、flag を付けない 25 件はどれも常に閉じる。さらに、合成の対象（`governs`）は `payment::field_contract_entitlement` に Field の 4 key だけを固定で書いた表になっている。CourseBoard の key を足すには、Core の変更が必要。
2. **キャンセル料の action が 2 系統ある。** PLT-5223 は「Extensionは使わず `field:ListCancellationFees` / `field:ManageCancellationFees`」と確定した。しかし CourseBoard の `POST /v1/course/reservation-cancellations/fees` は、今も `field_extension_golf:ManageCancellationFees` を要求している（`src/course/domain/actions.rs:100`、`settle_cancellation_fees.rs`、manifest の 405 行目と 521 行目）。画面（`cancellation-fees*`）は Field の `cancellationFees.list/manage`（`field:*`）を見ている。カタログの `requiredActions` には `field:*` だけを書く案にしたが、旧 endpoint は extension action のまま残る。この endpoint を廃止するか `field:*` へ移すかは、PLT-4119 / PLT-5228 の側で決める。 → 移行期間として、この endpoint は `field:ManageCancellationFees` と旧 action のどちらでも通すようにした（ルート表 `RouteAuthorization::AnyAction` とユースケースの `require_any`）。旧 action を外すのは、本番の policy を新 action へ移した後の別 PR。
3. **UI の flag ゲートは fail-open。** `gated-routes.ts` は、flag の取得に失敗すると画面を表示する。release flag はこれでよいが、PLT-5229 は「既定で全画面を許可しない」「flag取得エラー時の表示許可を認可へ流用しない」としている。そのため、契約によるゲートは別の関数にして fail-closed にする（判定できないときは読み込み表示のまま、再試行できるようにする）。既存の flag ゲートの挙動は変えない。
4. **UI の判定を 1 本にするかどうか。** PLT-5695 / PLT-5229 は「画面側に第二の提供権判定を作らない」としている。案では、UI は IAM を `/v1/field/client-capabilities` から、提供権を Core の `featureDeliveryValues`（CourseBoard API 経由）から受け取り、AND するだけにする。UI で独自に計算はしない。ただし、client-capabilities に提供権を合成する（PLT-5695 の実装）なら、受け取り元を 1 本にするべき（§6 Q5）。

## 6. 決めたこと

| # | 論点 | 決定 |
|---|---|---|
| Q1 | 粒度 | 業務機能単位（§3 の 26 件） |
| Q2 | flag なしの key を Core でどう評価するか | (A) Core を変え、`releaseGates: []` の key は契約と IAM だけで判定する。Core 側（tachyon-apps）は後続 |
| Q3 | カタログの置き場所 | CourseBoard が持つ。JSON ではなく IaC manifest（`kind: ProductFeatures`）にして、tachyon CLI で apply する |
| Q4 | キャンセル料の key | `courseboard.cancellation_fee` として独立させる |
| Q5 | UI の受け取り元 | IAM は client-capabilities、提供権は featureDeliveryValues（CourseBoard API 経由）。UI は AND するだけ |
| Q6 | 旧 `/admin/*` | 対象に残す。旧 `/cancellation-fee-collections` は M2M として対象外 |

## 7. 実装

### カタログと manifest

- 正本: `src/feature_delivery/catalog.rs`。key、説明、read / manage の action、`requiredFeatureKeys`、`releaseGates`、画面ルート。
- 生成物: `.tachyon/manifests/courseboard-product-features.yml`（`apiVersion: apps.tachy.one/v1alpha`、`kind: ProductFeatures`、`metadata.tenantId` は CourseBoard の権利者テナント）。各機能は key、説明、delivery key、`requiredActions`、`releaseGates`、`requiredFeatureKeys`、`operationBindings` を持つ。空の項目は書き出さない。ルート・画面との対応（`apiRefs` / `uiRefs`）は載せない。実行時の判定に使わない記述用の情報なので、正本は `course_authz::ROUTES` と `routes.rs`（API）、`App.tsx` と `routeFeatures.ts`（画面）に置く。`catalogFeatureId` と `digest` は Core が `ProductFeatures` の apply のときに発行する。製品の manifest には書かない。
- 任意のメモ欄 `annotations`（文字列 → 文字列の map）を、機能ごとに持てる。制限は Core と同じで、key は最大 32 個、key の形式は `[a-z0-9][a-z0-9._/-]{0,62}`、値は最大 1 KiB。空なら書き出さない。判定・識別・digest には使わない。
- 再生成: `COURSEBOARD_UPDATE_FEATURE_MANIFEST=1 cargo test feature_delivery`。生成結果とファイルが違うと CI が落ちる。
- apply（受け側ができたら）:

```bash
tachyon iac plan --file .tachyon/manifests/courseboard-product-features.yml
tachyon iac apply --file .tachyon/manifests/courseboard-product-features.yml
```

今の tachyon-apps の IaC（`V1AlphaManifest`）には `ProductFeatures` がないので、server 側が受け付けるまで apply はできない（§8）。

### key のない機能を CI で検出する

- Rust（`src/feature_delivery/tests.rs`）: `ROUTES` の全ルートに key か対象外の理由があること、ルールの key がカタログにあること、`requiredFeatureKeys` が存在して循環しないこと、action が manifest か `field:` のものであること、manifest が生成結果と同じであること。
- UI（`desktop/src/feature-delivery/routeFeatures.test.ts`）: `App.tsx` が分岐する全ルートに key か対象外があること、key の一覧が manifest と一致すること、どの key も何らかの画面から使われていること、画面を開くのに必要な action ごとの機能が manifest の `requiredActions` と合っていること。

### ガード（既定 off）

- env `COURSEBOARD_FEATURE_DELIVERY_ENFORCEMENT` = `off`（既定）/ `shadow` / `enforce`。未知の値は `enforce`。
- env `COURSEBOARD_FEATURE_DELIVERY_ENFORCE_TENANTS` = 利用者（operator）テナント ID のカンマ区切り（既定は空）。リクエストの `x-operator-id` がここにあれば `enforce` で判定する。同じ platform のほかのテナントは変わらない。本番では CourseBoard キャンセル料 Sandbox（`tn_01m5kn5rn6vsms2xs7tj5kksqp`）とデモ用の CourseBoard キャンセル料デモ（`tn_01m65afarh1y4j44bz8vrp80hq`）だけを入れている。
- env `COURSEBOARD_FEATURE_DELIVERY_ENFORCE_PLATFORMS` = platform テナント ID のカンマ区切り（既定は空）。リクエストの `x-platform-id` がここにあれば、デプロイ全体のモードに関係なく `enforce` で判定する。1 つのデプロイが本番と sandbox の platform を両方受け持つので、本番を `shadow` のまま sandbox だけプランを効かせるためのもの。
  - テナント ID の形でない値は警告を出して無視する（打ち間違いで別の platform を絞らないため）。
  - 載っていない platform の判定がデプロイのモードより厳しくなることはない。ヘッダーで決めるので、境界ではなく段階的に有効にするためのスイッチとして使う。
  - 画面（`/v1/course/feature-deliveries/evaluate`）も同じ platform の判定を返すので、その platform では未提供の画面が隠れる。
- API: `course_authz` の内側（IAM を通った後、handler の直前）で、ルートの key と、その `requiredFeatureKeys` 全部を Core の `featureDeliveryValues` に 1 回の batch で問い合わせる。`enabled && resolved` 以外は 403（`FEATURE_NOT_PROVIDED` / `FEATURE_DELIVERY_UNRESOLVED` / `FEATURE_DELIVERY_UNAVAILABLE` / `FEATURE_ROUTE_UNCLASSIFIED`）。`off` は Core を呼ばない。
- `shadow` はリクエストを一切変えない（本文も読まない）。Core の判定 1 回ごとに Field の lease が書かれるので、判定するのは一部だけにする。
  - 判定する割合は `COURSEBOARD_FEATURE_DELIVERY_SHADOW_SAMPLE_RATE`（0〜1、既定 `0.01`）。
  - 同じテナント × 機能は、インスタンスごとに 1 分に 1 回まで。
  - 判定は handler と並行に走らせ、handler が動いている間は打ち切らない。Lambda は応答の後の処理を止めるため、切り離したタスクにはしない。応答ができてから待つのは最大 1 秒で、超えたら `SHADOW_TIMEOUT` として記録する。
  - 本文を読まないため、旧管理画面のフォームに書かれたテナントと、取消料請求書の範囲（`FEATURE_SCOPE_EXCEEDED`）は shadow では確かめない。
- ログ: target `courseboard::feature_delivery::decision`、メッセージ `feature delivery decision`。項目は `tenant_id` / `feature` / `decision`（allow / deny / unknown）/ `reason` / `enforcement` / `method` / `path`。
  - 拒否は `enforce` では毎回出す。`shadow` では判定したものすべてを出す。
  - 許可は `enforce` でもサンプリングして出す。
  - 秘密値は出さない。
- 処理の中で別の機能を呼ぶ入口は、その中でも判定する。データ出力（`/objects`、`/{source}/rows`）は出力元ごとに判定し、共通取込み（`/v1/course/data-imports/*`）は取込み先ごとに判定する（一覧・テンプレート・取込み・ジョブ操作のすべて）。
- UI 向け: `POST /v1/course/feature-deliveries/evaluate`（`{ keys }` → `{ enforcement, values: [{ key, enabled, resolved, reason }] }`）。要件 key の AND はサーバーで行う。`off` と `shadow` のときは値を返さず、Core も呼ばない（画面は `enforce` までどれも隠さないため）。
- UI: `FeatureDeliveryProvider` が全 key を一度に問い合わせる。`enforce` のときだけ、提供なしの画面は `CapabilityGate` で止め、サイドバー・ピン・ホーム・設定ハブからも外す（`useHiddenRoutes`）。判定できないときは、表示せずに読み込み中または再試行を出す（fail-closed）。release flag のゲート（fail-open）はそのまま。この endpoint がない古い API（403 / 404）の場合は `off` として扱う。

### 段階導入の順序

1. この PR をマージする（既定 off のため、挙動は変わらない）。API を UI より先にデプロイする。古い API は `/v1/course/tenant-timezone` を 403 で拒否するので、UI が先に出ると、タイムゾーンの警告が一時的に出る。
2. tachyon-apps で `kind: ProductFeatures` の apply と、`releaseGates` を見る合成を入れる（§8）。
3. manifest を apply し、Field の商品プランに key を割り当てる。
4. 検証環境で `shadow` にして、拒否ログが想定どおりか確かめる。
5. テナントを限って `enforce` にする。

## 8. 後続（別リポジトリ）

1. **tachyon-apps: `kind: ProductFeatures` の IaC と Core の合成。** 
   - IaC に `ProductFeatures` を追加し、manifest から機能定義（key、delivery key、releaseGates、requiredFeatureKeys）を登録する。
   - `featureDeliveryValues` は、登録済みの key について次のように判定する。`releaseGates` が空なら契約だけで判定する。空でなければ、flag と契約の AND を取る。
   - 合成の対象（`governs`）を、`payment::field_contract_entitlement` に固定で書いた表から、登録済みの定義に置き換える。
   - これで「flag を廃止しても提供権は消えない」が成り立つ。
2. **tachyonfield: 商品プランから CourseBoard の key を選べるようにする。** Core に登録された `productScope: courseboard` の機能を、プランに割り当てる候補として読む。
3. **キャンセル料の action を揃える。** `POST /v1/course/reservation-cancellations/fees` の `field_extension_golf:ManageCancellationFees` を、`field:ManageCancellationFees` に移すか廃止する（PLT-4119 / PLT-5228）。 第 1 段（新旧どちらでも通す）は実施済み。残りは本番 policy の移行と旧 action の削除。

## 付録. 画面と機能 key の対応（全 42 件）

API ルートと機能 key の対応は、`src/feature_delivery/routes.rs` の規則（`course_authz::ROUTES` の各パターンと `/field-api` の転送先が対象）を正とする。

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
