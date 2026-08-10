# SCC-8 schedule の未知フィールド保持

## Problem

Field の resource schedule PUT は全 rule を置換する。CourseBoard は GET response を
`AvailabilityRule` へ縮約し、その domain だけから PUT body を再構築していたため、
CourseBoard が未認識の Field-owned field は無関係な schedule 編集でも欠落した。

Field Golf Sandbox で annual season を `04-01` / `11-30` に設定し、CourseBoard 本番から
capacity だけを 1 から 2 へ保存した。保存後の Field GET では両 season field が `null` に
なり、コード上の懸念を実挙動として再現した。

## Decision

schedule writer を read-modify-write にする。PUT 直前に Field の current schedule を GET
し、rule id で対応付ける。CourseBoard が編集する既知 field だけを上書きし、その他の
mutable field は raw JSON のまま PUT へ通す。

Field response にだけ存在し、現行 PUT が 422 で拒否する `active`、`createdAt`、
`updatedAt`、`revision` は除外する。allow-list は使わない。allow-list は Field が
mutable field を追加するたびに同じ欠落事故を再発させるためである。

## Scope

- Field schedule の GET→merge→PUT を gateway 内で行う。
- 既存 rule の Field-owned unknown field を保持する。
- CourseBoard が編集した weekday、時刻、capacity、間隔、tenant timezone は上書きする。
- UI で削除した rule は従来どおり PUT から除外し、Field 側で retire する。
- 新規 rule は CourseBoard が知る field だけで作る。

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
- response-only metadata は PUT へ送らない。
- Sandbox で修正前の消失と修正後の保持を Field GET の再取得値で確認する。
- Rust / desktop の required checks と PR CI が green になる。

