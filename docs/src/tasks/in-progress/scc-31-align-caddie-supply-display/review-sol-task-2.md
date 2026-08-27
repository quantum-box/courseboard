# SCC-31 骨格計画レビュー（第2巡）

## 集計

**重大 0 / 高 1**

第1巡10件の判定は **解消 8 / 不十分 2**。不十分2件は、後述する高1件とそのテスト不足である。

## 第1巡指摘の解消判定

| 第1巡 | 判定 | 理由 |
|---|---|---|
| 高1: 受付ロールが supply API を読めない | 解消 | 現状の403を明記し、既存 action 付与と狭い action 新設の比較を design.md に委譲し、200/403の認可テストも受け入れ条件にした（`task.md:88-92,131-132,161`）。 |
| 高2: backend/frontend の取消判定が不一致 | 解消 | backend の正規化済み `AssignmentStatus` を正と定め、実現方式だけを design.md に残し、取消 alias・大文字・空白・unknown の両側契約テストを必須化した（`task.md:48-57,117-122,130`）。 |
| 高3: シフト配置と打刻の混同、警告 DTO 不足 | 解消 | `Unconfirmed` / `Unplaced` と attendance を分離し、手動候補用の additive な `shiftPlacementStatus` を backend 作業へ追加した（`task.md:77-85,108,114-116`）。ただし自動配置側のデータ不足は中8の残件として別掲する。 |
| 高4: 配置取得失敗時の虚偽フォールバック | 解消 | 旧計算を確定値として返すことと空配列への変換を禁止し、424または明示的 incomplete のいずれでも frontend が過不足を表示しない契約にした（`task.md:69-72,135-136`）。旧 frontend の安全性も互換表の必須条件に含まれる。 |
| 高5: UTC 日付 filter でローカル日の配置を落とす | 解消 | `widen_for_utc_date_filter()` と `tenant_day_bounds()` を確定事項・実装・テストへ明記した（`task.md:73-76,104-106,119-121`）。 |
| 高6: 二重緩和の不変条件と永続異常表示が不足 | 解消 | capacity の単位消費、reservation ID 重複排除、別コース残余、unbacked/capacity超過/mismatch の永続表示を骨格に固定し、具体アルゴリズムは design.md に残した（`task.md:58-68,126-127`）。これは裁量を不当に奪う過剰確定ではなく、集計が満たすべき受け入れ不変条件である。 |
| 中7: backend 先行の互換条件が未定義 | 解消 | 新規 field の additive/optional、旧 frontend の誤表示禁止、新 frontend の旧 backend fallback/抑止、4象限互換表を必須化した（`task.md:93-100,128-129`）。incomplete 時に旧 frontend へ空の course 集合を返す等、安全な具体方式は design.md の裁量でよい。 |
| 中8: 警告対象が手動配置だけ | 不十分 | 自動配置 preview を対象に追加した点は解消方向だが、preview が読む `AutoAssignResultDto` へ配置状態を運ぶ backend 変更が無く、推薦 DTO の追加だけでは実装不能（`task.md:83-87,108-115`、高1参照）。 |
| 中9: 結合点の検証不足 | 不十分 | usecase、DTO、認可、互換性のテストは大幅に補強された。一方、高1の auto-assign DTO と、手動・自動警告の描画/非ブロッキングの component test が明示されていないため、残る不整合を検出できない（`task.md:119-122,137,155-161`）。 |
| 低10: 実在しない「CaddieAssignment 確定」 | 解消 | reservation ID と coverage predicate による表現へ修正し、実在しない status 名を除いた（`task.md:39-40,48-57`）。 |

## 高

### 1. 自動配置 preview には `shiftPlacementStatus` が届かない

**指摘内容**

改訂 task.md は自動配置 preview にも `Unconfirmed` / `Unplaced` 警告を必須化したが、backend の
追加対象は `caddie-recommendations` の推薦 DTO だけである。自動配置 preview は推薦 API を使わず、
`POST /v1/course/caddie-auto-assignments` の `AutoAssignResultDto.assigned` を表示する。
現在の `AutoAssignPlanItem` / `AutoAssignPlanItemDto` は reservation、時刻、caddie、rationale しか
保持せず、planner は候補選択に使った `CaddiePlacement` を結果へ引き継がない。CaddiesPage も
確定シフト一覧を取得していないため、frontend 単独では preview 行の配置状態を復元できない。

したがって確定事項7の全経路警告と、実装アウトラインの backend 変更が矛盾している。

**根拠（file:line）**

- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/task.md:80-87`
- `docs/src/tasks/in-progress/scc-31-align-caddie-supply-display/task.md:108-116`
- `src/course/domain/caddie_plan.rs:252-304`
- `src/course/domain/caddie_ops.rs:911-955`
- `src/course/interfaces/http_ops.rs:942-950`
- `src/course/interfaces/http_ops.rs:978-991`
- `desktop/src/features/golf/CaddiesPage.tsx:258-275`
- `desktop/src/features/golf/CaddiesPage.tsx:1379-1403`

**修正提案**

`AutoAssignPlanItem` と `AutoAssignPlanItemDto` にも additive/optional な
`shiftPlacementStatus` を持たせ、planner が選択時の `CaddiePlacement` を結果へ保存する backend
作業をアウトラインへ追加する。代案として自動配置画面が日別シフトを取得して join する方法も
あるが、「判定を backend に寄せる」方針と API 呼び出し増加を考えると、preview DTO に事実を載せる
方が一貫する。`unconfirmed` / `unplaced` / `on_course` の preview 描画と、警告が実行をブロック
しないことを component test に追加する。

## 重大

問題なし。

## 新たな矛盾・過剰確定の確認

- 上記高1件以外に、重大・高相当の新規矛盾はない。
- 確定事項4はアルゴリズムそのものではなく、需要・capacity・異常 count の不変条件を固定している。
  対応づけの順序・データ構造・DTO名は design.md に残っており、裁量を不当に奪っていない。
- coverage の canonical 化、受付への action 公開、424/incomplete の選択、警告UIの形は引き続き
  design.md に委譲されており、委譲範囲は概ね適切である。

## 参考（中以下、新規）

- `task.md:108-109` は受付用に狭い action を新設する場合も `src/course_authz.rs` の `ROUTES` 登録を
  変更対象にしているが、同じ `GET /v1/course/caddie-course-supply` を使う限り新規ルートではない。
  Field を呼ぶ同 endpoint は現在どおり `UpstreamEnforced` の分類を維持し、細粒度 action は usecase
  冒頭の `require(...)` と manifest で扱うのがリポジトリ規約に合う
  （`src/course_authz.rs:451-455`）。新しい path を追加する場合だけ ROUTES の追加が必要である。
