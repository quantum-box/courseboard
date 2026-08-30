# ADR-0005: ゴルフドメイン知識は CourseBoard が所有する

## Status

Accepted.

2026-08-23 に移行フェーズの進捗と、決定後に判明した制約を追記した。
所有権の定義そのものは変えていない。CourseBoard が Field の extension を
利用しなくなる件は [ADR-0010](./ADR-0010-courseboard-is-not-a-field-extension.md)、
テナント選択の軸は [ADR-0011](./ADR-0011-policy-based-tenant-selection.md)。

対になる Field 側の決定は `tachyon-apps` の
`docs/adr/golf-domain-courseboard-migration.md`。両者は同じ移行を
それぞれの立場から記述している。

## Context

CourseBoard は `src/course/` に約 10,000 行の DDD 構成ゴルフドメインを持つが、
その infrastructure 層（`field_gateway.rs` / `field_ops_gateway.rs` /
`field_commercial_gateway.rs`）は Field の
`/v1/erp/extensions/golf-course/*` を呼んでいる。

Field 側にも同じゴルフドメインが実装されている。
`packages/reservation` に約 3,300 行、`apps/api` に 31 ルート、
admin-ui と client に約 40 ファイルのゴルフ画面がある。

つまりゴルフの語彙・業務ルール・計算が Field と CourseBoard に
二重に存在し、どちらが正なのかが曖昧になっている。

`CLAUDE.md` は「CourseBoard 利用者は Field UI を操作しない。
ゴルフ運用は CourseBoard で完結する」と定めている。
ゴルフの正は CourseBoard であるべきである。

## Decision

ゴルフの**ドメイン知識は CourseBoard が単独で所有する**。
Field は業種非依存の汎用 ERP capability だけを提供する。

### CourseBoard が所有するもの

- 語彙 — キャディ、ラウンド、ホール、ティータイム、OUT/IN、組、ランク、
  セルフ / キャディ付き。
- 計算 — ゴルフ料金シミュレーション、キャディフィー、月次精算、
  予算達成率、キャディ自動配置、キャディ付き枠の需給。
- 運用ルール値 — セルフロックの時間帯、客単価の閾値、
  グレード判定、税ルール。
- ゴルフ運用 UI 全般。
- Field の汎用モデルにゴルフの意味を与える anti-corruption layer。

### Field が所有するもの

- 予約、予約商品、予約枠、予約リソース、予約リソースグループ。
- スタッフ profile / 配置 / 出勤可否 / 出退勤 / 評価（HRM）。
- 日別予算の汎用構造。
- extension lifecycle と config、custom field schema。
  ただし **CourseBoard はこれを利用しない**（[ADR-0010](./ADR-0010-courseboard-is-not-a-field-extension.md)）。
  Field が所有し続けることと、CourseBoard が使わないことは両立する。
- 予約作成時の**汎用**ポリシーガード機構（時間帯ロック、最低単価）。
  ルールの値と意味づけは CourseBoard が供給する。

データは Field DB に残り、汎用テーブルとして扱う。
CourseBoard へのデータ物理移送は行わない。

Field 側のテーブルと API をどう汎用化するかは Field の実行設計であり、
本 ADR は決めない。CourseBoard 側の関心は
「`/v1/erp/extensions/golf-course/*` を呼ばなくなること」だけである。

## Consequences

### Positive

- ゴルフの正が CourseBoard の単一箇所に定まる。
- ゴルフ機能を Field の release cycle から独立して出せる。
- Field 側のゴルフ実装との二重管理が解消する。

### Negative

- CourseBoard の Field API 呼び出しが増える。計算に必要な素材を
  複数の汎用エンドポイントから集めるため、レイテンシと N+1 に注意が要る。
- Field 側のゴルフ e2e が無くなるため、回帰検知の責任が CourseBoard に移る。
  CourseBoard の CI に Field API contract のチェックは無く、e2e は
  モックモードのため、受け皿を先に作る必要がある。
- extension config への書き込みが Field 側で `field:ManageExtensions`
  （extension の enable / disable を含む lifecycle 権限）を要求するように
  なったため、`field-extension:golf:*` の各ロールでは届かない。
  config に載っている設定（ランク単価、コース並び順、予約受付期間、
  プラン、タイムゾーン、帳票 snapshot）の保存が全部これに乗っている。
  **これは受け入れるコストではなく、extension から撤退する直接の動機に
  なった**（ADR-0010）。撤退が完了すれば消える。
- Field 側で外部集計 snapshot を汎用 capability へ移す作業（PLT-3574）の
  cutover 中は、対象 extension の config write が全部 423 で止まる。
  CourseBoard は configJson を丸ごと PATCH するため、対象 key 以外の
  保存も巻き込まれる。これも撤退完了までの期限付きの制約である。

### Neutral

- `/v1/erp/staff-*` は既に汎用 API として存在するため、
  キャディ profile / 配置 / 出勤可否の呼び出し先は変わらない。
- `/field-api/*` proxy の allowlist にある extension path 4 行は、
  desktop の非モックコードから呼ばれておらず既に dead である。
  撤退の一環として削除する。

## 移行フェーズ

進捗は 2026-08-23 時点。

1. **Phase 1 — 計算ロジック**（7 系統中 5 系統 完了）
   料金シミュレータ、月次精算、キャディ給与集計、推薦、自動配置、
   需給計算、予算達成率を CourseBoard 側実装に切り替え、
   Field の対応ルートへの依存を外す。
   - 完了: 給与集計（`src/course/domain/payroll.rs`）、
     推薦（`domain/caddie_ranking.rs`）、自動配置（`domain/caddie_plan.rs`）、
     需給（`domain/course_supply.rs`）、料金シミュレータ。
     `GolfOpsGateway` の `list_caddie_recommendations` と
     `auto_assign_caddies` は呼び出し元が無いデッドメソッドとして残っている。
   - 残り: **月次精算**（`usecase/get_monthly_settlement.rs`）と
     **予算達成率**（`usecase/list_budget_achievements.rs`）。
     この 2 つが Field の計算ルートへ委譲している唯一の箇所。
2. **Phase 2 — UI**（完了）
   Field admin-ui はアプリごと廃止され、client の
   `features/golf-caddies/` も削除済み。CourseBoard desktop の
   料金シミュレータも実装済み。
3. **Phase 3a — CourseBoard の extension 撤退**（未着手）
   extension config・extension-scoped path・extension 有効判定への依存を
   CourseBoard から外す。設定はゴルフ固有ならローカル DB、業種非依存なら
   Field に汎用 capability を起票して待つ（ADR-0009 / ADR-0010）。
   テナント選択はポリシーベースへ付け替える（ADR-0011）。
   **Field 側の実装を待たずに CourseBoard 単独で完了できる**部分が大半で、
   ここが当面の主戦場になる。
4. **Phase 3b — Field のテーブルと API の汎用化**（Field の判断と時間軸）
   Field の `/v1/erp/extensions/golf-course/*` が汎用 `/v1/erp/*` に
   置き換わるのに合わせて gateway の呼び先を書き換える。
   実行設計と段取りは Field が持つ。CourseBoard は起票して待ち、
   gateway の path 定数だけを追従させる。

段取りの詳細は
[courseboard-extension-exit](../../tasks/in-progress/courseboard-extension-exit/task.md)。

## References

- Field: `docs/adr/golf-domain-courseboard-migration.md`
- Field: `docs/adr/plt-1549-cloud-app-industry-extension-boundary.md`
- Field: `docs/domain/hrm-golf-caddy-context-map.md`
- [ADR-0009: extension configを運用データの保存先にしない](./ADR-0009-extension-config-is-not-a-data-store.md)
- [ADR-0010: CourseBoardはFieldのextensionを使わない](./ADR-0010-courseboard-is-not-a-field-extension.md)
- [ADR-0011: テナント選択はポリシーで行う](./ADR-0011-policy-based-tenant-selection.md)
- [ロードマップ](../../tasks/in-progress/courseboard-extension-exit/task.md)
- [PLT-3574](https://linear.app/issue/PLT-3574)
- [PLT-3381](https://linear.app/issue/PLT-3381)
- `CLAUDE.md` の「tachyonfield と CourseBoard の責務分担」
