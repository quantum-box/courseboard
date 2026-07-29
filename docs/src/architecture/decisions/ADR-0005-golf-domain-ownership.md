# ADR-0005: ゴルフドメイン知識は CourseBoard が所有する

## Status

Accepted.

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

`.cursor/rules/courseboard-vs-field.mdc` は
「CourseBoard 利用者は Field UI を操作しない。ゴルフ運用は CourseBoard で
完結する」と定めている。ゴルフの正は CourseBoard であるべきである。

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
- 予約作成時の**汎用**ポリシーガード機構（時間帯ロック、最低単価）。
  ルールの値と意味づけは CourseBoard が供給する。

データは Field DB に残り、汎用テーブルとして扱う。
CourseBoard へのデータ物理移送は行わない。

## Consequences

### Positive

- ゴルフの正が CourseBoard の単一箇所に定まる。
- ゴルフ機能を Field の release cycle から独立して出せる。
- Field 側のゴルフ実装との二重管理が解消する。

### Negative

- CourseBoard の Field API 呼び出しが増える。計算に必要な素材を
  複数の汎用エンドポイントから集めるため、レイテンシと N+1 に注意が要る。
- Field 側のゴルフ e2e が無くなるため、回帰検知の責任が CourseBoard に移る。
- Field のテーブル / API 汎用化フェーズでは Field と同時デプロイが必要になる。

### Neutral

- `/v1/erp/staff-*` は既に汎用 API として存在するため、
  キャディ profile / 配置 / 出勤可否の呼び出し先は変わらない。

## 移行フェーズ

1. **Phase 1 — 計算ロジック**
   料金シミュレータ、月次精算、キャディ給与集計、推薦、自動配置、
   需給計算、予算達成率を CourseBoard 側実装に切り替え、
   Field の対応ルートへの依存を外す。
2. **Phase 2 — UI**
   Field admin-ui / client のゴルフ画面が削除される。
   CourseBoard desktop に不足分（料金シミュレータ）を追加する。
3. **Phase 3 — 汎用 API 追従**
   Field の `/v1/erp/extensions/golf-course/*` が汎用 `/v1/erp/*` に
   置き換わるのに合わせて gateway を書き換える。

## References

- Field: `docs/adr/golf-domain-courseboard-migration.md`
- Field: `docs/adr/plt-1549-cloud-app-industry-extension-boundary.md`
- Field: `docs/domain/hrm-golf-caddy-context-map.md`
- `.cursor/rules/courseboard-vs-field.mdc`
