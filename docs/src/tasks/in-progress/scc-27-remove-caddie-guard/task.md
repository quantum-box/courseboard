# SCC-27: キャディーのシフト状況に寄らず、キャディー付きコースを予約できるようにする

Linear: SCC-27 (Todo) / チーム: 札幌カントリー倶楽部

この文書は CTO 承認済みの計画の叩き台である。詳細計画エージェントはこれを起点に
design.md と本 task.md を具体化する。骨格（方針・判定基準・スコープ）は確定事項で
あり、変更する場合は理由を明記して人間の承認を得ること。

## 背景

キャディ供給ガード（月のシフト確定済みかつコースの配置キャパ売り切れ時に予約を
拒否する仕組み）が PR #180（backend, e0a5958）と PR #281（frontend, 09f2c1a）で
導入された。しかし現場運用ではシフト状況に関係なく予約を受け付け、キャディの
割り当ては後から調整したい。よってブロックをやめ、可視化（警告表示）に転換する。

## 確定事項（骨格）

1. ガードは完全撤去する（確認ダイアログ付き突破などは作らない）。
   - backend: `src/course/usecase/create_reservation.rs` の
     `refuse_a_round_the_course_cannot_walk`（400 拒否）を削除。
   - frontend: `desktop/src/features/golf/ledger/` の `caddieRoundsSoldOut` による
     プラン選択不可・保存不可・「本日のキャディはすべて埋まっています」表示を削除。
2. 代わりに予約台帳（LedgerBoard）で「未割り当て」を可視化する。
   - 対象: キャディ付きプラン（play_type=caddie）の予約のうち、Field の配置
     （CaddieAssignment、予約 ID 紐付き）が存在しないもの。
   - 表示: 赤背景または赤枠 + 「未割り当て」のテキスト。
   - 範囲: その日のシフトが確定済みの日のみ赤表示する。未確定の将来日は表示しない
     （赤だらけ防止）。
3. 実現方式: 既存 `GET /v1/course/caddie-assignments` を台帳の表示日で取得し、
   予約 ID（TeeSheetItemDto.id と同一の ID 空間）で突合する純フロントエンド join。
   `UnassignedRounds.tsx` の未配置判定ロジック（holdsTheRound / covered set）を
   共通ヘルパーに抽出して再利用する。バックエンド変更は不要の見込み。

## 実装アウトライン

- backend 撤去に伴う掃除: `CreateReservationUseCase` の `CaddieShiftGateway` 依存、
  `GetCourseCaddieSupplyUseCase::for_capacity_guard` などの死にコード除去
  （clippy -D warnings 前提）。ドメイン述語 `has_room_for_one_more_caddie_round`
  （`src/course/domain/course_supply.rs`）と関連テスト 3 件の整理。
- frontend 撤去: i18n キー `ledger:newReservation.caddieSoldOut{,Title,Body}` は
  ja / ja-plain / en の 3 ロケール同期で削除（completeness テストあり）。
  `NewReservationEditor.caddie-supply.test.tsx`（6 件）等を新仕様に書き換え。
  CSS `.ledger-plan-soldout` 等の整理。
- 供給情報の表示（列ヘッダの「キャディ 8/12・空き N」= SCC-28 相当）は残す。
  表示専用となる。
- 文書更新: `docs/src/tasks/in-progress/caddie-course-shifts/task.md` の Phase 4
  「予約枠への接続」は本タスクで方針転換したことを追記し、completed へ移動を検討。

## 詳細計画エージェントへの委譲事項

- 赤背景か赤枠かの最終判断、警告・バッジの文言、i18n キー設計。
- 共通ヘルパーの置き場所と命名。
- 「シフト確定済みの日」の判定に使う既存データソースの選定
  （caddie-course-supply の確定判定などを調査のうえ決定）。
- テスト計画（backend: cargo test 要 TiDB、frontend: vitest）。
- プラン変更（セルフ→キャディ付き）経路の扱いの確認
  （現状ガード無し。撤去後は一貫するはずだが要確認）。

## 関連タスクの扱い（調査済み）

- ガードの再導入を要求する未完了タスク・issue は Linear / GitHub に存在しない。
  Close 対象なし。
- SCC-28（台帳のキャディ情報）: 列ヘッダ表示はほぼ実装済み。本タスクと補完関係。
- SCC-29（配置の動作確認）: SCC-27 が blocker の下流タスク。本タスク完了後に検証。
- GitHub #90（予約商品キャパ設定画面でのブロック要望）: 層が異なるため本タスクでは
  触れないが、triage 時に本タスクの「ブロックせず警告」方針を参照すること。

## 検証

- `cargo fmt && cargo clippy --all-targets --all-features -- -D warnings && cargo test`
  （TiDB: `docker run --rm -d -p 4000:4000 pingcap/tidb:v8.5.7`）
- `cd desktop && npm run type-check && npm run test`
- リポジトリ規約: CLAUDE.md（AGENTS.md）参照。コミットは日本語 conventional commits。
  UI の fetch は `desktop/src/api.ts` 経由のみ（ADR-0004）。
