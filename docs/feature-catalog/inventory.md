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
| 23 | `courseboard.data_imports` | `golf/data-imports(/:target)` | `/v1/course/data-imports/*` | `field:ListBridgeDefinitions` | `field:PreviewBridgeRun`, `field:ExecuteBridgeDrafts` | なし | — |
| 24 | `courseboard.data_exports` | `settings/data-exports` | `/v1/course/data-exports/*`, Field `/v1/bridge/exports/*` | `field:ListBridgeExportDefinitions` | `field:ManageBridgeExportDefinitions` | なし | — |
| 25 | `courseboard.cancellation_fee` | `cancellation-fees`, `/new`, `/:id` | Field `/v1/cancellation-fees*`（`/field-api` 経由）, POST reservation-cancellations/fees | `field:ListCancellationFees` | `field:ManageCancellationFees` | なし | — |
| 26 | `courseboard.course_map` | `course-map` | ローカル WebSocket（`ws://127.0.0.1:9001`、desktop のみ） | `ListCourses` | — | 候補 | courses |

IAM の列は `field_extension_golf:` を省いて書いた。`field:` で始まるものは Field の action。

### 対象外（key を付けない）

| 区分 | ルート・画面 | 理由 |
|---|---|---|
| 公開 | `/`, `/healthz`, `/openapi.json`, `/swagger-ui/*`, `/ui/*`, `/public/cancellation-fees/*`、画面 `download`, `privacy`, `terms`, `pay/:token` | 認証前。契約の判定ができない。支払いリンクは、契約が終わった後も発行済みの請求を払えるようにする（PLT-5234）。 |
| 基盤 | `/v1/me`, `/admin`（リダイレクト）, `/v1/course/feature-flags/evaluate`, `/v1/field/client-capabilities`, `/v1/course/extension-status`、画面 `golf`（ホーム）, `settings`（ハブ） | どの機能を使う場合も必要。ホームとハブは、中のリンクを機能ごとに絞る。 |
| M2M | `POST /calculate`, `POST /simulate/range`（`CalculateTax`、Field core が呼ぶ）、旧 `POST /cancellation-fee-collections` | 利用者の bearer と `x-operator-id` がない。Core の合成は `contract_unavailable` で閉じてしまう（#12209 の「未対応」）。旧 collection は新規作成を 410 で止めている（PLT-4119）。 |
| 社内 | `POST /v1/course/demo-seed`（`SeedDemoBoard`） | 顧客に売る機能ではない。 |
| 設定 | `settings/members`（Field `/v1/field/iam/users`, `field:ManageUsers`） | テナントの利用者管理。Field の機能として扱う。 |

旧管理画面 `/admin/caddies`, `/admin/shifts`, `/admin/reservations`, `/admin/dispatch` は、`courseboard.caddies` と `courseboard.caddies.dispatch` に入れた。廃止するなら対象から外す。

## 4. `/field-api/*` の扱い

`/field-api/*` は Field への汎用プロキシで、`ROUTES` では 1 行（`UpstreamEnforced`）になっている。画面が使う転送先は次のとおり。

| 転送先 | 機能 key | Field 側のガード（tachyonfield #1642） |
|---|---|---|
| `/v1/cancellation-fees*` | `courseboard.cancellation_fee` | なし（`/v1/invoices/**` と cancellation-fee の帳票だけが対象） |
| `/v1/invoices` | `courseboard.customers.cancellations`（キャンセル一覧から開く請求シート。`CancellationsPage.tsx:923`） | `field.invoice.general` |
| `/v1/erp/reservations/:id/billing-invoice` | `courseboard.settlement`（月次精算の請求書発行） | なし |
| `POST /v1/erp/staff`、`POST /v1/erp/staff/:id/clock-in`・`clock-out` | `courseboard.caddies`（キャディ登録と打刻） | なし |
| それ以外の `/v1/erp/staff*`（一覧・編集・削除） | `courseboard.staff` | なし |
| `/v1/field/iam/users*` | 対象外（設定） | なし |
| `/v1/bridge/exports/*` | `courseboard.data_exports` | なし |

CourseBoard のガードは、`/field-api` の後ろのパスで分類する。分類できないパスは、enforce のときに拒否する。

## 5. キャンセル料単独提供（PLT-5223〜5234）の認可設計との照合

1 と 2 は既存の設計との食い違いで、この PR では直していない。3 と 4 は、この PR の実装で設計に合わせた点。

1. **Core はまだ「flag なしの安定機能」を評価できない（要対応・別リポジトリ）。** tachyon-apps #12209 の `featureDeliveryValues` は、delivery key をそのまま release flag として引く。flag が OFF または未登録なら、契約を見ずに `enabled: false` を返す。一方、PLT-5695 は「公開flagを持たない安定機能は契約とIAMで評価」「flag廃止で提供権を失わせない」としていて、今回合意した方針も同じ。このままだと、flag を付けない 25 件はどれも常に閉じる。さらに、合成の対象（`governs`）は `payment::field_contract_entitlement` に Field の 4 key だけを固定で書いた表になっている。CourseBoard の key を足すには、Core の変更が必要。
2. **キャンセル料の action が 2 系統ある。** PLT-5223 は「Extensionは使わず `field:ListCancellationFees` / `field:ManageCancellationFees`」と確定した。しかし CourseBoard の `POST /v1/course/reservation-cancellations/fees` は、今も `field_extension_golf:ManageCancellationFees` を要求している（`src/course/domain/actions.rs:100`、`settle_cancellation_fees.rs`、manifest の 405 行目と 521 行目）。画面（`cancellation-fees*`）は Field の `cancellationFees.list/manage`（`field:*`）を見ている。カタログの `requiredActions` には `field:*` だけを書く案にしたが、旧 endpoint は extension action のまま残る。この endpoint を廃止するか `field:*` へ移すかは、PLT-4119 / PLT-5228 の側で決める。
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
- 生成物: `.tachyon/manifests/courseboard-product-features.yml`（`apiVersion: apps.tachy.one/v1alpha`、`kind: ProductFeatures`、`metadata.tenantId` は CourseBoard の権利者テナント）。各機能の形は Field の `product-features.json` に合わせた。`apiRefs` は `course_authz::ROUTES` から、`uiRefs` は画面ルートから作る。`catalogFeatureId` と `digest` は、取り込む側（Field / Core）が発行する。
- 再生成: `COURSEBOARD_UPDATE_FEATURE_MANIFEST=1 cargo test feature_delivery`。生成結果とファイルが違うと CI が落ちる。
- apply（受け側ができたら）:

```bash
tachyon iac plan --file .tachyon/manifests/courseboard-product-features.yml
tachyon iac apply --file .tachyon/manifests/courseboard-product-features.yml
```

今の tachyon-apps の IaC（`V1AlphaManifest`）には `ProductFeatures` がないので、server 側が受け付けるまで apply はできない（§8）。

### key のない機能を CI で検出する

- Rust（`src/feature_delivery/tests.rs`）: `ROUTES` の全ルートに key か対象外の理由があること、ルールの key がカタログにあること、`requiredFeatureKeys` が存在して循環しないこと、action が manifest か `field:` のものであること、manifest が生成結果と同じであること。
- UI（`desktop/src/feature-delivery/routeFeatures.test.ts`）: `App.tsx` が分岐する全ルートに key か対象外があること、画面と key の対応が manifest の `uiRefs` と一致すること、key の一覧が manifest と一致すること。

### ガード（既定 off）

- env `COURSEBOARD_FEATURE_DELIVERY_ENFORCEMENT` = `off`（既定）/ `shadow` / `enforce`。未知の値は `enforce`。
- API: `course_authz` の内側（IAM を通った後、handler の直前）で、ルートの key と、その `requiredFeatureKeys` 全部を Core の `featureDeliveryValues` に 1 回の batch で問い合わせる。`enabled && resolved` 以外は 403（`FEATURE_NOT_PROVIDED` / `FEATURE_DELIVERY_UNRESOLVED` / `FEATURE_DELIVERY_UNAVAILABLE` / `FEATURE_ROUTE_UNCLASSIFIED`）。`shadow` はログだけ出して通す。`off` は Core を呼ばない。
- UI 向け: `POST /v1/course/feature-deliveries/evaluate`（`{ keys }` → `{ enforcement, values: [{ key, enabled, resolved, reason }] }`）。要件 key の AND はサーバーで行う。`off` のときは値を返さない。
- UI: `FeatureDeliveryProvider` が全 key を一度に問い合わせる。`enforce` のときだけ、提供なしの画面は `CapabilityGate` で止め、サイドバー・ピン・ホーム・設定ハブからも外す（`useHiddenRoutes`）。判定できないときは、表示せずに読み込み中または再試行を出す（fail-closed）。release flag のゲート（fail-open）はそのまま。この endpoint がない古い API（403 / 404）の場合は `off` として扱う。

### 段階導入の順序

1. この PR をマージする（既定 off のため、挙動は変わらない）。
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
3. **キャンセル料の action を揃える。** `POST /v1/course/reservation-cancellations/fees` の `field_extension_golf:ManageCancellationFees` を、`field:ManageCancellationFees` に移すか廃止する（PLT-4119 / PLT-5228）。

## 付録. 画面と機能 key の対応（全 42 件）

API ルートと機能 key の対応は、manifest の各機能の `apiRefs` を正とする（`ROUTES` から生成）。

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
