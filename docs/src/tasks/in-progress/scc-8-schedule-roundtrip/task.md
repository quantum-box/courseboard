# SCC-8 schedule の未知フィールド保持

## Problem

Field の resource schedule PUT は全 rule を置換する。CourseBoard は GET response を
`AvailabilityRule` へ縮約し、その domain だけから PUT body を再構築していたため、
CourseBoard が未認識の Field-owned field は無関係な schedule 編集でも欠落した。

Field Golf Sandbox で annual season を `04-01` / `11-30` に設定し、CourseBoard 本番から
capacity だけを 1 から 2 へ保存した。保存後の Field GET では両 season field が `null` に
なり、コード上の懸念を実挙動として再現した。

#192 では gateway の read-modify-write を実装したが、本番 UI の保存 payload が既存 rule
の `id` を除いていた。gateway は current rule と対応付けられず、UI の全 rule を新規として
PUT した。このため #192 の branch API を直接確認したときは保持できても、本番 UI では
season に加えて `effectiveFrom` / `effectiveTo` も失われた。

## Decision

schedule writer を read-modify-write にする。PUT 直前に Field の current schedule を GET
し、rule id で対応付ける。CourseBoard が編集する既知 field だけを上書きし、その他の
mutable field は raw JSON のまま PUT へ通す。

Field response にだけ存在し、現行 PUT が 422 で拒否する `active`、`createdAt`、
`updatedAt`、`revision` は除外する。allow-list は使わない。allow-list は Field が
mutable field を追加するたびに同じ欠落事故を再発させるためである。

UI は Field から読み込んだ rule の `id` を保存 payload に含める。画面内で追加した新規
rule は `id` なし、`isNew: true` で送る。CourseBoard API は `id` ありの既存 rule または
`id` なしで明示された新規 rule だけを受理し、由来が曖昧な `id` なし rule は 400 にする。

## Scope

- Field schedule の GET→merge→PUT を gateway 内で行う。
- 既存 rule の Field-owned unknown field を保持する。
- CourseBoard が編集した weekday、時刻、capacity、間隔、tenant timezone は上書きする。
- UI で削除した rule は従来どおり PUT から除外し、Field 側で retire する。
- 新規 rule は CourseBoard が知る field だけで作る。
- UI の実保存経路で既存 ID と新規作成 intent を維持する。
- ID が脱落した既存 rule の全置換を明示的に拒否する。

## Non-goals

- annual season を CourseBoard の domain、DTO、UI に追加すること。
- Field schedule PUT の contract を変更すること。
- demo tenant、実顧客 tenant のデータを変更すること。
- migration、env、secret、権限を変更すること。

## Migration

不要。CourseBoard / Field とも schema は変えず、既存 schedule endpoint の保存処理だけを
変更する。既存データの backfill や production data update は行わない。

## Completion criteria

- Field から読んだ未認識の mutable field が、CourseBoard の無関係な編集後も同値で PUT
  されることを、annual season 固有ではない regression test で固定する。
- `CourseSchedulePage` の入力変更と保存操作を通し、既存 rule の ID を含む PUT によって
  season と effective range の両方が保持されることを固定する。
- UI で追加した rule は明示的な新規として保存でき、読み込んだ rule の ID 欠落は PUT
  せず失敗することを固定する。
- response-only metadata は PUT へ送らない。
- Sandbox の本番相当 UI で修正前の消失と修正後の season / effective range 両方の保持を
  Field GET の再取得値で確認する。
- Rust / desktop の required checks と PR CI が green になる。
