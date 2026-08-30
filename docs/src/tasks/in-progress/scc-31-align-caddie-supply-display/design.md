# SCC-31 詳細設計: 配置済みキャディを台帳ヘッダの過不足表示に反映する

task.md の「確定事項（骨格）」は変更しない。本書は実装方法を具体化し、委譲事項へ決定を下す。実装は行わない。

対象読者は backend / frontend の実装担当である。backend PR を先行マージし、frontend PR は additive な契約を消費する。

## 0. 前提として確認した事実

- 現在の集計は GetCourseCaddieSupplyUseCase::supply (src/course/usecase/get_course_caddie_supply.rs:72-105) が tee sheet、確定 shift、course だけを取得して compute_course_supply() (src/course/domain/course_supply.rs:93-147) へ渡すため、assignment を作成しても shortfall は変わらない。
- CaddieAssignment::holds_the_round() (src/course/domain/caddie.rs:445-451) が backend の coverage predicate である。AssignmentStatus::parse() は trim・小文字化し cancelled/canceled の双方を取消にする (同:107-139)。SCC-27 の frontend helper は raw cancelled だけを除く (desktop/src/features/golf/caddieRoundCoverage.ts:11-13)。
- 既存 GET /v1/course/caddie-course-supply は src/course_authz.rs:451-455 で UpstreamEnforced である。path を増やさず、細粒度認可は usecase の require と manifest に置く。ROUTES は変更しない。
- Field の assignment filter は UTC 暦日である。usecase 内は widen_for_utc_date_filter() で取得範囲を広げ、tenant_day_bounds() の半開区間で tenant 当日へ絞り直す。
- SCC-27 の未割り当てバッジは CaddieAssignment と reservation ID の突合を維持し、caddieSupply を判定に使わない。

## 1. 委譲事項への決定

### 1-1. assignment と shift capacity の対応付け

**決定: reservation ごとに coverage を一意に選び、その caddie の確定 working shift capacity を最大 1 単位だけ消費する。**

course_supply.rs に、tee sheet から独立した AssignedCoverage（reservation ID、demand course ID、caddie ID、assignment ID）と、集計中にだけ使う caddie ID -> remaining capacity の map を導入する。usecase は cancelled 以外の caddie tee reservation を reservation ID -> demand course にし、tenant 当日の holds_the_round() assignment のうち join できるものだけを coverage 候補にする。reservation ID が無い row と sheet 外の row は数えない。

候補を reservation ID ごとにまとめる。group 自体は tee sheet の tee time 昇順、同時刻は reservation ID 昇順で処理し、同一 group 内の候補は (caddie ID, assignment ID) 昇順で決定する。各 group では残 capacity がある working confirmed shift の候補を最初に選び、なければ先頭を一度だけ選ぶ。backed coverage は対応する caddie の残 capacity を 1 減らす。capacity 2 の shift は 1 件後も 1 残る。この安定順により、同一キャディの残 capacity を複数 reservation が争っても provider / demand 別の effective 値と anomaly 帰属は HashMap の反復順に依存しない。複数 assignment row は 1 組を二重に満たさず、先頭の unbacked row が後ろの有効 row を隠さない。

補正後の過不足は、demand course の残需要と placement course の残 capacity の差で出す。別 course の caddie が backed coverage を持つ場合は、target の需要を 1 減らし、provider の capacity を 1 減らす。元 course の残余を整合させるためである。

- shift 無し、非 working、または course 未配置は unbackedAssignedGroups。
- working shift はあるが既に capacity を使い切れば capacityExceededAssignedGroups。unbacked とは重ねない。
- working confirmed かつ配置 course がある assignment は、capacity を消費できたかにかかわらず provider course と demand course を比較する。異なれば courseMismatchAssignedGroups を増やす。従って capacity exceed と mismatch は同時に記録され得る。

すべて demand course に帰属させ、API とヘッダに永続表示する。

### 1-2. supply DTO と新旧互換性

**決定: roundsCapacity、caddieAttachedGroups、shortfall は生の既存意味を変えず、補正値を additive field に分ける。**

CourseCaddieSupply、HTTP DTO、TypeScript 型へ次を追加する。Rust は 0 を serialize し、frontend は optional として受ける。

| field | 意味 |
| --- | --- |
| assignedGroups | reservation ID 重複排除後、coverage を持つ caddie 予約数 |
| backedAssignedGroups | shift capacity を消費できた assignedGroups 数 |
| unbackedAssignedGroups | shift に裏付けられない coverage 数 |
| capacityExceededAssignedGroups | shift はあるが capacity 超過の coverage 数 |
| courseMismatchAssignedGroups | working・配置済み shift の course と予約 course が異なる数（capacity exceed と重なり得る） |
| effectiveRoundsCapacity | assignment 消費後の course 残 capacity |
| effectiveCaddieAttachedGroups | assignment coverage を除いた course 残需要 |
| effectiveShortfall | effectiveRoundsCapacity - effectiveCaddieAttachedGroups |

| backend | frontend | 表示・安全性 |
| --- | --- | --- |
| 旧 | 旧 | 現行の生 supply 表示 |
| 新 | 旧 | 既存 raw field を読むため現行表示を維持 |
| 旧 | 新 | optional effective field 不在を検出し現行表示へ fallback、異常 count は出さない |
| 新 | 新 | effective 値を主表示、非 0 の異常 count を永続表示 |

### 1-3. coverage status の正規化

**決定: assignment DTO に optional canonicalStatus を追加し、SCC-27 helper はこれを優先する。旧 backend には同一規則の fallback を使う。**

CaddieAssignmentDto (src/course/interfaces/http.rs:2306-2340) に canonical_status を追加し、既存の public な AssignmentStatus::as_str() で assigned / in_progress / completed / cancelled / other を返す。新しい domain getter は追加しない。raw status は変更しない。CoverageAssignment は canonicalStatus?: string | null を持つ。holdsTheRound() は canonical があれば cancelled だけを除き、無ければ raw を trim・小文字化して cancelled/canceled の双方を除く。unknown は backend 同様 coverage とする。

これにより backend の domain 判定が契約の正となる。バッジのデータソース、reservation ID 突合、表示ゲートは変更しない。

### 1-4. 認可スコープと上流障害

**決定: supply API の認可は既存 field_extension_golf:ListCaddieInsights 要求のまま変更せず、受付への公開は後続タスクへ切り出す。**

GetCourseCaddieSupplyUseCase は集計前に roster を読み (src/course/usecase/get_course_caddie_supply.rs:45-67)、Field adapter は利用者本人の bearer で GET /v1/erp/staff を読む (src/course/infrastructure/field_ops_gateway.rs:62-118)。reception は field:ListHrm を持たないため、CourseBoard 側だけの action 追加では実 provider を通れない。CTO 承認により本件ではこの公開範囲を変更しない。既存 ListCaddieInsights の require と UpstreamEnforced route 分類を維持し、actions.rs、READ_ONLY、ALL、auth manifest、既存 policy は変更しない。受付のヘッダ非表示は現状のままとし、Field 権限を含む公開方式と実 bearer による確認は後続タスクで扱う。

**決定: assignment 取得失敗は 424 provider_error とする。** supply() の try_join! に assignment read を足し、失敗をそのまま AppError へ伝播する。frontend は caddieSupplyResource.error 時に capacity / shortfall / anomaly の全数値を隠し、ResourceError 相当の retry UI を表示する。空配列、旧計算、dataStatus: incomplete への fallback は作らない。

### 1-5. 警告 UI・i18n

**決定: candidate 行には warning badge、手動確定には confirm、自動配置 preview には行ごとの badge と集約 Notice を置く。いずれも実行を block しない。**

推薦 DTO と auto-assign plan item DTO に shiftPlacementStatus?: unconfirmed | unplaced | on_course を追加する。unconfirmed は「シフト未確定」、unplaced は「コース未割付」、on_course は表示しない。attendance の off-duty warning とは併記する。

手動候補では badge とし、該当 candidate の assignment 作成前 confirm に理由を加える。自動配置は preview 行に同じ badge を置き、該当があれば execute 時 confirmation に列挙する。deadline warning も同時にある場合は一回の confirm に合成する。いずれも POST の可否を変えない。

caddies namespace に ja / ja-plain / en 共通で以下を追加する。

- shiftPlacement.unconfirmed、shiftPlacement.unplaced
- assignment.shiftPlacementWarning.title、body、confirm
- autoAssign.shiftPlacementWarning.title、body、confirm、item

ledger namespace には caddieSupply.unbackedAssignedGroups、capacityExceededAssignedGroups、courseMismatchAssignedGroups を追加する。文言は「当日のシフトが未確定」「確定シフトのコースが未割付。配置はできますが供給異常として表示されます」とする。ja-plain は同じ意味を平易な語にする。

## 2. backend パッケージ（Rust）

### 2-1. 変更対象ファイルと変更内容

#### src/course/domain/course_supply.rs:17-147

CourseCaddieSupply に 1-2 節の値と getter を追加する。compute_course_supply() の raw 集計は維持し、その直後に新設 apply_assignment_coverage() を呼ぶ。純粋関数は coverage、shift、course の値を受け、gateway 無しで algorithm を test 可能にする。raw shortfall() は変更せず、補正値も clamp しない。mismatch predicate は working・配置済み shift があれば capacity の残量とは独立して評価するため、capacity exceeded + cross-course の一件は両方の count に残る。

#### src/course/usecase/get_course_caddie_supply.rs:1-105

GolfOpsGateway::list_caddie_assignments() を try_join! に追加する。widen_for_utc_date_filter(date, date) で query を広げ、catalog gateway から得た timezone 文字列を tenant_day_bounds(date, date, &timezone) に渡して返却を絞る。前者は二引数のみであり、timezone の事前 parse は不要である。tee sheet と assignment を AssignedCoverage に正規化して domain へ渡す。roster filter は既存通り shift だけに適用し、assignment の事実を黙って落とさない。read error は catch しない。execute() の既存 require(actions::LIST_CADDIE_INSIGHTS) は変更せず、同 file の fake gateway tests から supply() を通す。

#### src/course/domain/caddie.rs:107-139,327-451 と src/course/interfaces/http.rs:2306-2340

既存 AssignmentStatus::as_str() を使って CaddieAssignmentDto.canonical_status を埋める。status_label の raw response は維持する。DTO test は raw / canonical の組を固定する。

#### src/course/domain/caddie_ops.rs:496-560,912-955

CaddieRecommendation と AutoAssignPlanItem に CaddiePlacement を lossless に保持する。wire token は unconfirmed / unplaced / on_course とする。既存 constructor と reconstitute call を明示的に更新する。

#### src/course/usecase/list_caddie_recommendations.rs:126-209

filter 時に局所で作る CaddiePlacement を ranking 後の CaddieRecommendation まで運ぶ。course filter、attendance、順位の動作は変えない。

#### src/course/domain/caddie_plan.rs:252-304 と src/course/usecase/auto_assign_caddies.rs:39-45,260-310

planner は pick した PlannableCaddie.placement を AutoAssignPlanItem へ渡す。placement_for() を再計算せず、候補選択時の値を結果まで保持する。dry-run / execute とも同じ field を返す。

#### src/course/interfaces/http_ops.rs:627-665,942-1006

RecommendationDto と AutoAssignPlanItemDto に optional shift_placement_status を追加し domain から serialize する。skip_serializing_if と default を併用する。OpenAPI は DTO から更新される。

### 2-2. テスト計画

- course_supply.rs: 同一 course backed、duplicate row、capacity 2、unconfirmed/unplaced、capacity exceed、cross-course の provider capacity 減少と mismatch、capacity exceeded + cross-course mismatch の同時発生、cancelled tee row除外を table test にする。同一キャディの capacity を複数 reservation が争うケースは tee time、同時刻なら reservation ID の昇順で常に同じ reservation が backed になることも検証する。
- get_course_caddie_supply.rs fake gateway: normal join、cancelled/canceled/大文字/空白/unknown、UTC 境界、reservation ID 無し / sheet 外、assignment gateway failure が CourseError::Provider のまま伝播することを検証する。
- HTTP DTO: canonicalStatus、supply の additive fields、推薦・auto-assign の shiftPlacementStatus を JSON serialize/deserialize する。old JSON に new field が無い場合も deserialize 可能にする。
- HTTP/router: assignment gateway failure の GET /v1/course/caddie-course-supply が 424、JSON error=provider_error、CORS header を返すことを handler/router 層で検証する。
- authorization: 既存 ListCaddieInsights 保有ロールが supply を引き続き読め、今回の変更で 403 に後退しないことを確認する。route classification は UpstreamEnforced のままと既存網羅 test で確認する。reception の公開可否・Field roster read は後続タスクの integration / preview 確認対象である。
- TiDB を起動し、cargo fmt && cargo clippy --all-targets --all-features -- -D warnings && cargo test を実行する。

### 2-3. 完了条件（backend）

- [ ] 既存 raw field と assignment を含む補正値が併存する。
- [ ] reservation ごとに coverage / capacity 消費は最大一回。
- [ ] cross-course の provider 残余と target 需要がともに補正され、capacity exceeded と重なっても course mismatch を含む異常 count が残る。
- [ ] assignment provider failure は 424。空配列・旧値へ fallback しない。
- [ ] canonical status、推薦、auto preview の additive DTO が揃う。
- [ ] 既存 supply 読取可能ロールは ListCaddieInsights のまま read を維持し、403 に後退しない。

## 3. frontend パッケージ（React / desktop）

### 3-1. 変更対象ファイルと変更内容

#### desktop/src/features/golf/caddieCourseSupply.ts:10-34

effective 値と anomaly count を optional field として追加する。新設 effectiveSupply() は三つの effective field が全て number の場合のみそれを返し、それ以外では既存 field を返す。新 frontend × 旧 backend fallback はここに閉じる。

#### desktop/src/features/golf/caddieRoundCoverage.ts:1-33

CoverageAssignment に canonicalStatus?: string | null を追加し、1-3 節の canonical-first holdsTheRound() に置換する。reservation ID 照合、roundIsStillOn()、unassignedCaddieRounds() は変えない。

#### desktop/src/features/golf/ledger/ledgerLayout.ts:264-...

formatCaddieCapacity / formatCaddieShortfall を effectiveSupply() 経由へ変更する。knowsCaddieCapacity() も effective 値を使うが、SCC-27 badge 判定へは渡さない。non-zero anomaly の label/count 配列を返す純粋 helper を追加し、旧 DTO は空配列にする。

#### desktop/src/features/golf/ledger/LedgerBoard.tsx:497-535 と LedgerPage.tsx:257-300

course header に anomaly helper を persistent small text として表示する。supply resource の loading/error では数値・anomaly を出さず retry UI を出す。assignment request の型は canonicalStatus を含める。ただし SCC-27 の shiftsConfirmed / unassignedIds と GroupCell 条件は変更しない。

#### desktop/src/features/golf/UnassignedRounds.tsx:52-61,280-399

実際の手動 assignment 経路は NameCaddieSheet である。Candidate に optional shiftPlacementStatus を追加し、候補行に unconfirmed / unplaced badge を表示する。name(candidate) は POST 前に placement warning の confirm を表示し、cancel なら保存状態や POST を始めず、continue なら既存どおり POST する。on_course と旧 DTO の field 不在は warning を出さない。CaddiesPage の汎用推薦一覧は create 経路ではないため、この必須警告の対象と混同しない。

#### desktop/src/features/golf/CaddiesPage.tsx:189-275,1353-1525,1529-...

CaddieRecommendation と AutoAssignPlanItem に optional shiftPlacementStatus を加える。CaddiesPage の汎用推薦一覧にも追加表示として warning badge を出してよいが、手動 create の badge / confirm は UnassignedRounds.tsx が担当する。AutoAssignPanel の preview 行には badge と集約 Notice を追加する。execute confirm は deadline と placement warning を合成する。旧 backend で field 不在は警告なしとして安全に扱う。

#### desktop/src/i18n/locales/{ja,ja-plain,en}/caddies.ts と ledger.ts

1-5 節の全 key を三 locale に同時追加する。completeness fixture は編集せず既存 test に通す。

#### desktop/src/dev/mockFieldApi.ts:1971-1989,2157-2158

mock supply へ additive normal / anomaly 例を追加し、assignment/recommendation/auto-assign mock に canonicalStatus と shiftPlacementStatus を足す。frontend 側で backend 集計を再実装しない。

### 3-2. テスト計画

- caddieRoundCoverage.test.ts: cancelled/canceled/大文字/空白/unknown、canonical が raw を優先する例を table test にする。
- ledgerLayout.test.ts: effective display、旧 DTO fallback、各 anomaly label、non-zero だけの表示を検証する。SCC-27 badge helper が supply を受け取らない回帰を残す。
- LedgerBoard / LedgerPage component test: backed assignment 後に header overage が解消、unbacked/exceeded/mismatch は残る、初回 supply 424 で数値を出さず error/retry となること、正常表示後の refresh 424 でも useResource が保持した stale data を描画せず全数値 / anomaly を隠すことを検証する。
- UnassignedRounds の NameCaddieSheet component test: unconfirmed / unplaced badge、on_course と旧 DTO の非表示、confirm の cancel / continue、continue 後の POST を必須化する。
- CaddiesPage component test: auto preview の unconfirmed / unplaced、on_course と旧 DTO の非表示、warning 後も auto execute が可能、deadline warning との confirm 合成を検証する。汎用推薦一覧を表示変更する場合はその badge も検証する。
- cd desktop && npm run type-check && npm run test を実行し i18n completeness を通す。

### 3-3. 完了条件（frontend）

- [ ] 新 DTO は補正後の過不足、旧 DTO は従来表示へ安全に fallback。
- [ ] anomaly count は header に残り toast のみで消えない。
- [ ] SCC-27 バッジの source/gate は不変、取消判定だけ canonical 化。
- [ ] 手動候補・確定・auto preview の全経路で non-blocking warning。
- [ ] ja / ja-plain / en completeness と component tests が通る。

## 4. PR 分割と依存関係

### PR 1: backend（先行マージ）

1. feat(キャディ): 配置を含むコース供給集計を追加 — domain algorithm、usecase、424、DTO。
2. feat(キャディ): 推薦と自動配置へシフト配置状態を追加 — domain、DTO、planner。
3. test(キャディ): 配置済み供給と配置状態の契約を検証 — fake gateway、DTO、planner、既存供給読取ロールの回帰 tests。

deploy 後も旧 frontend は raw field だけを読むため安全である。

### PR 2: frontend（PR 1 の deploy 後）

1. feat(台帳): 配置済みキャディを供給表示へ反映 — optional DTO、header、anomaly、coverage normalization。
2. feat(キャディ): 未確定シフトの配置を警告 — 手動・preview UI、i18n、mock。
3. test(台帳): キャディ供給表示と配置警告を検証 — vitest/component/i18n tests。

PR 2 は preview site で 2026-08-28 空沼 IN の再現ケースを確認してからマージする。

## 5. 検証

1. TiDB を用意して backend suite を実行する。
   docker run --rm -d -p 4000:4000 pingcap/tidb:v8.5.7
   cargo fmt && cargo clippy --all-targets --all-features -- -D warnings && cargo test
2. cd desktop && npm run type-check && npm run test を実行する。
3. preview で、配置済み一組の過不足解消、shift 無し/未配置の手動・preview warning と実行可能性、unbacked/exceed/mismatch の残存、assignment provider failure の数値非表示を確認する。受付の header 表示は後続タスクの確認対象であり、本 PR の受け入れ条件に含めない。

## 6. レビュー対応記録（review-sol-task-1.md / review-sol-task-2.md / review-sol-design-1.md / review-sol-design-2.md）

| 指摘 | 設計での対応 |
| --- | --- |
| reception が supply を読めない | CTO 承認により後続タスクへ切り出し。本件では既存 ListCaddieInsights 要求を維持し、受付の現状は変更しない。 |
| backend/frontend の取消判定が異なる | canonicalStatus を正とし、旧 API は同一規則で fallback。 |
| shift placement と attendance の混同 | shiftPlacementStatus を推薦・auto-assign DTO に運び、attendance と独立して描画。 |
| assignment 読み取り失敗が虚偽の 200 になる | try_join! に加え 424 へ伝播。 |
| UTC filter が tenant 日を落とす | widen query 後に tenant day half-open interval で絞る。 |
| 二重緩和・重複 assignment | reservation 単位の選択と per-caddie capacity ledger で各 1 回だけ消費。 |
| 新旧混在 | raw field を維持し effective field を optional additive とする 4 象限互換表。 |
| auto preview に placement が届かない | planner が選んだ CaddiePlacement を AutoAssignPlanItem から DTO まで保持。 |
| 異常が一度きりの警告で消える | course DTO の独立 count と header 永続表示。 |
| route authz の変更が必要との誤解 | endpoint は UpstreamEnforced のまま。CTO 承認後は新 action も採らず、既存 ListCaddieInsights の usecase gate を維持する。 |
| design #1: 手動配置の候補・確定 UI が対象外 | 反映。実際の POST 経路である UnassignedRounds.tsx の NameCaddieSheet を変更対象・component test 対象として明記した。 |
| design #2: capacity exceed 時に course mismatch が消える | 反映。working・配置済み shift の mismatch は残 capacity と独立に数え、exceeded と重複可能にした。 |
| design #3: widen_for_utc_date_filter の引数数が違う | 反映。二引数呼出しへ修正し、timezone は tenant_day_bounds() だけに渡す。 |
| design #4: 新 read action の degraded-mode allowlist が漏れている | CTO のスコープ変更により新 action 自体を採らないため対象外。READ_ONLY / ALL / manifest の変更は後続の受付公開タスクで再検討する。 |
| design #5: 424 / stale-data 非表示を必要な層で検証できない | 反映。usecase は CourseError::Provider、HTTP/router は 424 JSON/CORS、frontend は初回・refresh 後の stale data 非表示を分離して検証する。 |
| design #6: AssignmentStatus::as_str() は既に public | 反映。新 getter の追加を取り消し、既存 as_str() の利用とした。 |
| design #2 高1: reception bearer の Field roster read が 403 | CTO 承認により受付公開を後続タスクへ切り出した。Field roster read を含む公開方式と実 bearer の endpoint 確認はそのタスクで扱う。 |
| design #2 高2: manifest-first ロールアウト手順がない | 後続タスク（受付公開）へ移管。新 action を採らないため本件の手順は削除し、action 宣言 → 既存 policy の PATCH grant → Tachyon Auth 読み返し gate → backend deploy という要点は task 切り出しドラフトに記録済み。 |
| design #2 参考: group 処理順が不安定 | 反映。tee time、同時刻は reservation ID、group 内は caddie ID / assignment ID の安定順を定義し、capacity 競合 test を追加した。 |
