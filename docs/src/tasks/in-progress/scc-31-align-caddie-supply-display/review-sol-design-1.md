# SCC-31 詳細設計レビュー（第1巡）

## 集計

**重大 0 / 高 2 / 中 3 / 低 1 / 提案 0**

backend 集計への一元化、raw/effective field の4象限互換、424契約、UTC 境界、専用 action、
canonical status、auto-assign DTO への placement 伝播は、骨格を概ね正しく具体化している。
特に review-sol-task-2.md の残件だった auto preview DTO は解消されている。一方、手動配置の
実ファイルが変更対象から漏れ、capacity 超過と course mismatch の同時発生を表現できないため、
この2点は実装前に修正が必要である。

## 重大

問題なし。

## 高

### 1. 手動配置の候補・確定 UI が変更対象から漏れている

**指摘内容**

design.md は手動候補の warning badge と assignment 作成前 confirm を
`CaddiesPage.tsx` の変更として指示している。しかし実際に予約を指定して推薦 API を読み、候補行を
描画し、`POST /caddie-assignments` を実行する `NameCaddieSheet` は
`UnassignedRounds.tsx` にある。`CaddiesPage.tsx` の `RecommendationsPanel` は汎用の推薦一覧を
表示するだけで、手動配置ボタンも create 処理も持たない。

したがって記載された変更対象へ忠実に実装しても、骨格が必須とする「手動配置の候補リスト・確定」
警告は入らない。`Candidate` 型も `shiftPlacementStatus` を受け取れず、component test の対象も
実際の create 経路から外れる。

**根拠（file:line）**

- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/task.md:79-95`
- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/design.md:73-80`
- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/design.md:162-165`
- `desktop/src/features/golf/CaddiesPage.tsx:1529-1579`
- `desktop/src/features/golf/UnassignedRounds.tsx:58-61`
- `desktop/src/features/golf/UnassignedRounds.tsx:280-339`
- `desktop/src/features/golf/UnassignedRounds.tsx:372-399`

**修正提案**

frontend 変更対象に `desktop/src/features/golf/UnassignedRounds.tsx` を明記する。
`Candidate` に optional `shiftPlacementStatus` を追加し、`NameCaddieSheet` の候補行 badge と
`name(candidate)` の POST 直前 confirm をここへ実装する。テストも CaddiesPage の汎用推薦一覧だけで
なく、`NameCaddieSheet` について `unconfirmed` / `unplaced` / `on_course` / 旧 DTO、confirm の
cancel/continue、continue 後の POST を必須化する。CaddiesPage の汎用推薦一覧にも badge を出すなら、
それは追加表示として手動経路とは別に記載する。

### 2. capacity 超過と course mismatch が同時に起きると mismatch が消える

**指摘内容**

骨格は shift capacity 超過と course mismatch を独立した異常 count として永続表示する。
しかし design.md は `courseMismatchAssignedGroups` を「backed かつ provider course と demand
course が異なる」場合だけ増やす。一方、確定 working shift はあるが残 capacity が0の assignment
は `capacityExceededAssignedGroups` に分類され、backed ではない。

例えば OUT に確定された capacity 1 のキャディが既に1組を担当し、さらに IN の組へ配置された場合、
2件目は capacity 超過かつ course mismatch である。現設計では exceeded だけが残り、別コース配置の
異常が消える。これは task.md の「course mismatch は異常として残す」「各異常を独立 count」に
違反し、運用上も shift のコース修正が必要なことを表示できない。

**根拠（file:line）**

- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/task.md:60-70`
- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/design.md:23-31`
- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/design.md:39-48`
- `src/course/domain/course_supply.rs:111-128`

**修正提案**

選択された coverage に working confirmed shift と配置コースがあるなら、capacity を消費できたかに
かかわらず provider course と demand course を比較する。capacity 0/使い切りかつ別コースなら
`capacityExceededAssignedGroups` と `courseMismatchAssignedGroups` の両方を増やす。
`unbacked` は shift 無し・非 working・course 未配置、`exceeded` は working/配置済みだが容量無し、
`mismatch` は working/配置済みでコース相違、という直交する predicate として定義する。
table test に exceeded + mismatch の同時発生を追加する。

## 中

### 3. `widen_for_utc_date_filter()` のシグネチャが実コードと一致しない

**指摘内容**

design.md は `widen_for_utc_date_filter(date, date, timezone)` と3引数で呼ぶよう指示しているが、
実関数は `from, to` の2引数だけを受ける。timezone は検索後の `tenant_day_bounds()` にだけ必要である。
このままでは実装手順どおりのコードがコンパイルできない。

**根拠（file:line）**

- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/design.md:97-100`
- `src/course/domain/tee_sheet.rs:317-327`
- `src/course/usecase/list_caddie_recommendations.rs:45-53`
- `src/course/usecase/auto_assign_caddies.rs:144-148`

**修正提案**

呼び出しを `widen_for_utc_date_filter(date, date)` に修正する。catalog から得た timezone 文字列は
`tenant_day_bounds(date, date, &timezone)` に渡す。明示的な事前検証が不要なら
`parse_tenant_timezone()` の単独呼び出しも削り、`tenant_day_bounds()` 内の検証へ一本化する。

### 4. 新しい read action を degraded-mode allowlist に追加する指示がない

**指摘内容**

`ListCourseCaddieSupply` は読み取り専用 action として新設されるが、design.md の actions.rs 変更は
定数と manifest 整合 test しか述べていない。`actions::READ_ONLY` は Tachyon Auth 障害時に直近の
許可を grace window で使える action の明示 allowlist であり、ここに新 action が無いと、同じ
台帳上の既存 read と異なり supply だけが認可基盤の一時障害で即座に使えなくなる。また manifest
coverage の正は `ALL` なので、定数を追加するだけでは整合 test の対象にもならない。

**根拠（file:line）**

- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/design.md:65-71`
- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/design.md:121-124`
- `src/course/domain/actions.rs:119-149`
- `src/course/domain/actions.rs:156-194`
- `src/course/domain/actions.rs:196-250`
- `src/course_authz.rs:829-843`

**修正提案**

`LIST_COURSE_CADDIE_SUPPLY` を `READ_ONLY` と `ALL` の両方へ追加することを変更手順に明記する。
`is_read_only(LIST_COURSE_CADDIE_SUPPLY)` と manifest 宣言・少なくとも1 policy への付与をテストし、
認可 provider 障害時の stale allowance がこの action にも適用されることを既存 cache test へ追加する。

### 5. 424 と stale-data 非表示を必要な層で検証できていない

**指摘内容**

backend の fake gateway usecase test が観測できるのは `CourseError::Provider` までで、HTTP の
424 / `provider_error` は `AppError` 変換・handler/router 層の契約である。design.md は fake gateway
項目に `provider_error` を割り当てる一方、HTTP テスト項目は DTO serialization と認可だけで、
assignment read failure の 424 JSON を検証しない。

frontend も `useResource` が再取得失敗時に直前の data を保持するため、単に初回 424 を返すテストだけ
では「error 時は全数値を隠す」を保証できない。成功済み supply を表示した後の refresh が 424 になった
場合にも、stale data を再表示せず error/retry だけにする必要がある。

**根拠（file:line）**

- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/design.md:71`
- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/design.md:125-131`
- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/design.md:158-160`
- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/design.md:174-180`
- `src/course/interfaces/http.rs:232-240`
- `src/lib.rs:1840-1847`
- `desktop/src/hooks/useResource.ts:130-149`
- `desktop/src/features/golf/ledger/LedgerPage.tsx:367-374`

**修正提案**

usecase test は assignment gateway failure が `CourseError::Provider` のまま伝播することを検証し、
別の HTTP/router test で endpoint が 424・JSON `provider_error`・CORS headers を返すことを検証する。
frontend component test は (1) 初回424、(2) 正常表示後の refresh 424 の2ケースを設け、後者でも
保持された `data` を描画に使わず、全数値/anomalyを隠して retry UI を出すことを確認する。

## 低

### 6. `AssignmentStatus::as_str()` は既に public である

**指摘内容**

design.md は canonical string getter を公開する変更を指示しているが、`as_str()` は既に
`pub fn` である。実装者が不要な API 追加や重複 getter を作る余地がある。

**根拠（file:line）**

- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/design.md:101-104`
- `src/course/domain/caddie.rs:115-124`

**修正提案**

「既存 `AssignmentStatus::as_str()` を使って `canonical_status` を埋める」に修正し、domain API の
追加対象から外す。

## 提案

問題なし。

## 観点別補足

- **骨格遵守**: 高2を除き、不変条件4、424契約5、UTC境界6、全経路警告7、認可8、互換条件9は
  具体化されている。高1は全経路警告の実装対象漏れである。
- **実装可能性**: 高1・中3・低6の修正が必要。他の主要な型・関数・DTO参照は実コードと一致する。
- **backend/frontend/DTO 整合**: auto-assign placement、canonical status、raw/effective DTO の対応は
  問題なし。course mismatch の predicate だけ高2の不整合がある。
- **テスト計画**: task.md の必須ケースは概ね割り付け済み。高2の複合異常、中5のHTTP/stale error、
  高1の実手動経路を追加する必要がある。
- **PR分割**: raw field を維持し新 field を optional additive にした4象限表は妥当で、backend 先行で
  frontend の型・描画は壊れない。専用 action は同 backend PR の manifest 変更と同時適用すること。
