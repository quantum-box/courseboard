# SCC-31: 配置済みキャディを台帳ヘッダの過不足表示に反映する

Linear: SCC-31 / チーム: 札幌カントリー倶楽部

この文書は CTO 承認済みの計画の叩き台である。詳細計画エージェントはこれを起点に
design.md と本 task.md を具体化する。骨格（方針・判定基準・スコープ）は確定事項で
あり、変更する場合は理由を明記して人間の承認を得ること。

改訂履歴: 第 1 巡レビュー（review-sol-task-1.md、重大 0 / 高 6 / 中 3 / 低 1）を反映。
第 2 巡レビュー（review-sol-task-2.md、重大 0 / 高 1・自動配置 preview への配置状態
伝搬の欠落、および認可分類の参考指摘）を反映。

## 背景

SCC-27 の検証中に発見した表示の不具合。予約にキャディを配置して「すべての組に
担当がいます」となっても、予約台帳のコース列ヘッダには「キャディ N/M・X組オーバー」
の警告が残り続け、利用者には「割り当てたのに不足と言われる」ように見える。

原因はコード確認済み。ヘッダの過不足（SCC-28 で実装）と SCC-27 の「未割り当て」
バッジで判定基準が食い違っている。

- ヘッダ: シフトのコース割り付け（`golf_caddie_shifts.golf_course_id`）による供給と、
  tee sheet のキャディ付き予約数による需要の比較。
  `src/course/domain/course_supply.rs` の `compute_course_supply()` と
  `src/course/usecase/get_course_caddie_supply.rs` が計算し、配置
  （CaddieAssignment）は一切参照しない。
- バッジ: 配置（CaddieAssignment、予約 ID 紐付き）のみを見る
  （`desktop/src/features/golf/caddieRoundCoverage.ts`）。

`CaddieAssignment`（`src/course/domain/caddie.rs`）はコース情報を持たず、配置の
作成・更新は Field への HTTP 呼び出しのみで CourseBoard ローカルの
`golf_caddie_shifts` には触れない（`src/course/infrastructure/field_ops_gateway.rs`）。
配置してもシフトのコース割り付けは変わらないため、ヘッダ側の警告が解消されない。

再現ケース（2026-08-28 空沼IN）: キャディ付き予約 1 組へ配置完了
（「すべての組に担当がいます」表示）でも、台帳ヘッダは「キャディ 1/0・1 組オーバー」
のまま。出勤確定 7 人は全員コース未割付。

## 確定事項（骨格）

1. ヘッダの過不足計算で、配置済みの組（reservation ID に紐づき、本文書 3. の
   coverage 判定を満たす CaddieAssignment がある組）を充足扱いにする。
   - 「配置確定時にシフトのコース割り付けを追随させる」案は採らない。
     Field→CourseBoard の新しい書き込み経路が必要になり、配置操作がシフトデータを
     暗黙に書き換える副作用を生むため。
2. 過不足の「正」は backend の caddie-course-supply 集計
   （`GET /v1/course/caddie-course-supply`）に一元化する。フロントエンドは
   受け取った値の表示のみを行い、フロント側で supply と assignments を独自に
   join して補正する実装は作らない（判定基準の分裂を再発させないため）。
3. coverage 判定（何を「配置済み」と数えるか）は backend の正規化済み
   `AssignmentStatus`（`src/course/domain/caddie.rs` の trim・小文字化、
   `cancelled` / `canceled` 双方を取消扱いにする規則）を正とし、
   SCC-27 バッジ側の判定もこれに揃える。
   - 現状 frontend の `holdsTheRound()` は生文字列の `cancelled` 厳密一致のみで、
     backend の正規化と既に食い違っている（`canceled` / 大文字 / 空白で分裂する）。
   - DTO で canonical status を返すか frontend helper を同じ正規化規則へ変更するかは
     design.md で決定し、`cancelled` / `canceled` / 大文字 / 空白 / unknown の
     契約テストを backend・frontend 双方に置く。
   - バッジのデータソース（CaddieAssignment、予約 ID 突合）自体は変更しない。
4. 二重緩和を防ぐ集計の不変条件（design.md はこれを満たす方式のみ裁量できる）:
   - assignment で充足した需要 1 組につき、同一キャディの利用可能な shift capacity を
     最大 1 単位だけ消費する。`rounds_capacity = 2` の shift は 1 件の assignment 後も
     1 単位残す。
   - reservation ID は重複排除し、複数の assignment row で 1 組を複数回充足しない。
   - 別コースに確定されたキャディの assignment が組を充足する場合、元コースの残余も
     整合させ、course mismatch は異常として残す。
   - shift に裏付けられない assignment・capacity 超過・course mismatch は
     `unbackedAssignedGroups` 等の独立した count として API とヘッダに永続表示する。
     配置時の一度きりの警告で消さない（assignment は担当予定の事実であって、
     確定シフト由来の供給そのものではない）。
5. 配置取得（Field）だけが失敗した場合、旧計算を確定値として 200 で返さない。
   原則は既存の上流失敗契約に合わせて 424。API を 200 で保つ場合は
   `dataStatus: incomplete` と欠落 source を DTO に明示し、frontend は過不足を
   表示しない契約にする。失敗を空配列へ変換する実装は禁止する。
6. Field の assignment 検索は UTC 暦日 filter であるため、既存の推薦・自動配置
   usecase と同じく tenant timezone で検索範囲を広げて取得し
   （`widen_for_utc_date_filter()`）、取得後に tenant の日境界で絞り直す
   （`tenant_day_bounds()`）。単純な `from=date&to=date` 指定は不可。
7. 併発問題への対処: シフト未確定・コース未割付のキャディでも配置できてしまう
   問題に、SCC-27 の「ブロックせず可視化」方針に合わせて非ブロッキング警告を
   入れる。ブロックはしない。
   - 警告条件は「確定シフト無し（Unconfirmed）」「確定シフトはあるがコース未割付
     （Unplaced）」の 2 つを区別して警告する。打刻状態（attendance）は既存表示の
     責務のままとし、本タスクの警告条件には含めない。
   - 現状の推薦 DTO は `attendanceStatus` しか返さず frontend からシフト配置状態を
     識別できないため、additive な `shiftPlacementStatus`
     （例: `unconfirmed` / `unplaced` / `on_course`）を backend で追加する。
   - 自動配置 preview は推薦 API を使わず `POST /v1/course/caddie-auto-assignments` の
     `AutoAssignResultDto` を表示するため、`AutoAssignPlanItem` /
     `AutoAssignPlanItemDto` にも additive / optional な `shiftPlacementStatus` を
     持たせ、planner が候補選択に使った `CaddiePlacement` を結果へ引き継ぐ。
     frontend 側でシフト一覧を join して復元する方式は採らない（判定を backend に
     寄せる方針との一貫性のため）。
   - 警告対象は assignment を新規作成する全経路とする（手動配置の候補リスト・確定に
     加え、自動配置の preview にも同じ警告を出す。実行はブロックしない）。
8. 台帳の主要利用者である受付ロール（`field-extension:golf:reception`）は現状
   `ListCaddieInsights` が無く supply API を読めない（403）。さらに調査の結果、
   CourseBoard 側の action 付与だけでは解消せず、supply 集計が内部で Field の
   roster（`GET /v1/erp/staff`）を利用者本人の bearer で読むため `field:ListHrm`
   相当の Field 側権限も必要になる（review-sol-design-2.md 高1）。
   **受付への公開は本タスクのスコープから外し、後続タスクとして起票する**
   （CTO 承認済み）。本タスクは supply API を現に読めるロールでの計算不整合の解消に
   集中し、受付の現状（ヘッダ非表示）は変えない。したがって supply API の認可は
   既存の `ListCaddieInsights` 要求を変更せず、新 action の宣言・付与や既存 policy の
   更新は行わない。既に supply を読めるロールが本変更で 403 に後退しないことを
   受け入れ条件とする。
9. PR は backend / frontend の 2 本に分割し、backend を先行してマージする。
   互換条件: 新規 field は additive とし frontend では optional として扱う。
   既存 field（`roundsCapacity` / `caddieAttachedGroups` / `shortfall`）の意味を
   変える場合は、旧 frontend が誤ったラベルで新しい意味を表示しないこと、
   新 frontend が旧 backend に当たった場合に安全に旧表示へ戻るか新表示を抑止する
   ことを満たすこと。backend 新旧 × frontend 新旧の互換表を design.md の必須成果物と
   する。frontend PR はプレビューサイトで再現ケースの解消を動作確認してから
   マージする。

## 実装アウトライン

- backend: `get_course_caddie_supply.rs` で配置情報（Field の CaddieAssignment）を
  tenant timezone の日境界で取得し、tee sheet の予約と reservation ID で突合して
  確定事項 4 の不変条件を満たす過不足計算へ反映する。`course_supply.rs` の
  `shortfall()` 系の計算とレスポンス DTO を拡張する（additive）。
- backend: 推薦 DTO（`list_caddie_recommendations` 系）と自動配置の
  `AutoAssignPlanItem` / `AutoAssignPlanItemDto` へ additive / optional な
  `shiftPlacementStatus` を追加し、planner が候補選択時の `CaddiePlacement` を結果へ
  引き継ぐ。認可は確定事項 8 のとおり変更しない（既存 `ListCaddieInsights` 要求と
  `UpstreamEnforced` 分類を維持。新 action・新 path は追加しない）。
- frontend: `desktop/src/features/golf/ledger/ledgerLayout.ts` の
  `formatCaddieCapacity` / `formatCaddieShortfall` と `LedgerBoard.tsx` の列ヘッダ
  表示を新しい集計値に追随させ、`unbackedAssignedGroups` 等の異常 count を
  永続表示する。
- frontend: 手動配置（候補リスト・確定）と自動配置 preview に
  「シフト未確定 / コース未割付」の非ブロッキング警告を追加する。i18n は
  ja / ja-plain / en の 3 ロケール同期（completeness テストあり）。
- coverage 判定の正規化統一（確定事項 3）: DTO canonical 化または frontend helper の
  正規化変更と、両側の契約テスト。
- テスト: fake gateway による `GetCourseCaddieSupplyUseCase` テストを新設し、
  正常 join・取消 alias（cancelled/canceled/大文字/空白）・重複 row・capacity 2・
  別コース・未確定/未配置・UTC 日付境界・assignment 取得失敗を必須ケースとする。
  DTO serialization、既存 `ListCaddieInsights` 保有ロールが supply を引き続き読めて
  403 に後退しないこと、frontend の新旧 DTO 互換も検証する。
  手動配置・自動配置 preview の警告描画（`unconfirmed` / `unplaced` / `on_course`）と
  警告が実行をブロックしないことは component test で検証する。

## 詳細計画エージェントへの委譲事項

- 確定事項 4 の不変条件を満たす集計方式の具体設計（対応づけのアルゴリズムと
  データ構造）。
- caddie-course-supply レスポンス DTO のフィールド設計（additive）と互換表
  （backend 新旧 × frontend 新旧）の作成。
- coverage 判定の実現方式（DTO canonical 化 vs frontend helper 正規化）の選定。
- 警告 UI の具体形（候補リスト内の明示・確定時の確認表示・自動配置 preview での
  表示形）、文言、i18n キー設計。
- 配置取得失敗時の方式選定（424 か `dataStatus: incomplete` か）と frontend の
  表示契約。
- テスト計画の詳細（backend: cargo test 要 TiDB、frontend: vitest）。

## 関連タスクの扱い

- SCC-27（PR #293 / #294、マージ済み）: 本不具合の発見元。バッジのデータソース
  （CaddieAssignment、予約 ID 突合）は変更しないが、取消判定の正規化は確定事項 3 で
  backend 基準に揃える。
- SCC-28（台帳のキャディ情報）: ヘッダ表示の元実装。本タスクはその計算基準を
  配置と整合させる。
- SCC-30（配置画面の UI 全般の見直し）: 独立。本タスクは表示の整合性の不具合として
  扱い、UI 全般には踏み込まない。ただし自動配置経路の警告（確定事項 7）は
  「同じ assignment 作成経路の整合」として本タスクに含める。

## 検証

- `cargo fmt && cargo clippy --all-targets --all-features -- -D warnings && cargo test`
  （TiDB: `docker run --rm -d -p 4000:4000 pingcap/tidb:v8.5.7`）
- `cd desktop && npm run type-check && npm run test`
- frontend PR のプレビューサイトで確認する項目:
  - 再現ケース（キャディ付き予約へ配置完了）で列ヘッダの警告が解消されること。
  - シフト未確定キャディの配置時（手動・自動配置 preview）に警告が出て、
    かつ配置はブロックされないこと。
  - shift に裏付けられない配置が `unbackedAssignedGroups` 等として永続表示される
    こと。
  - 既に supply API を読めるロール（manager 等）で 403 への後退がないこと
    （受付ロールの公開は後続タスク。本タスクでは受付の表示は変わらない）。
- リポジトリ規約: CLAUDE.md（AGENTS.md）参照。コミットは日本語 conventional commits。
  UI の fetch は `desktop/src/api.ts` 経由のみ（ADR-0004）。認可はフェイル
  クローズドで、新ルート追加時は `src/course_authz.rs` の ROUTES 登録が必須。
