# SCC-6 テナント timezone

> **(2026-08-23 追記)** ここで SoR に定めた extension config は、
> [ADR-0010](../../../architecture/decisions/ADR-0010-courseboard-is-not-a-field-extension.md)
> により CourseBoard が使わなくなる。ただし timezone は業種非依存で Field の
> 公開ストアフロントも同じ値を読んでいるため、CourseBoard ローカル DB へは動かさず、
> **Field に汎用のテナント属性を起票して待つ**
> （[ADR-0009](../../../architecture/decisions/ADR-0009-extension-config-is-not-a-data-store.md)）。
> 「tenant 単位で 1 つ持ち、コース master のものは使わない」という本 taskdoc の
> 決定自体は変わらない。

## Decision

ゴルフ extension の tenant config `configJson.timezone` を CourseBoard の timezone の
SoR とする。コース master の timezone は新規入力・計算に使わない。

course 単位に置いた意図を ADR、コメント、テスト、migration、元 issue まで調べたが、
コース master の他属性と並べて導入されたこと以上の根拠は見つからなかった。read-only
で取得できた既存 8 course はすべて `Asia/Tokyo` で、異なる値は 0 件だった。

## Scope

- tenant config から timezone を解決する catalog port を追加する。
- schedule の availability rule 保存に tenant timezone を渡す。
- tee sheet / ledger の timezone metadata を tenant timezone にする。
- course 作成・更新 request と設定 UI から timezone を外す。
- Field が要求する既存 `golf_courses.timezone` には tenant timezone をミラーする。
- tenant 設定 UI の IANA timezone validation を維持する。

## Compatibility and rollback

`golf_courses.timezone` 列と Course API response の legacy 値は、この変更では削除しない。
読み取り切替と列削除を分けることで、問題があれば application rollback だけで旧 reader
へ戻せる。tenant config に timezone key が無い既存 tenant は、データ変更なしで従来値
`Asia/Tokyo` を compatibility default として解決する。

## Non-goals

- `reservation_availability_rules.timezone` の削除・変更。
- 予約 timezone snapshot の削除・変更。
- 固定 JST / UTC の日付境界や計算を tenant timezone 対応にすること（SCC-7）。
- `golf_courses.timezone` 列の削除。
- production data、env、secret、権限の変更。

## Migration

不要。CourseBoard DB schema は変わらず、tenant config と Field の legacy course 列は既存の
保存先を使う。既存 course 値の backfill や production data update も行わない。

## Verification

- tenant config の timezone 解決と key 未設定時の compatibility default を unit test する。
- course に異なる timezone が残っていても schedule 保存へ tenant timezone だけが渡る
  ことを use-case test で固定する。
- tee sheet metadata が course 値ではなく tenant timezone を返すことを port-level test で
  固定する。
- Rust fmt / clippy / test、frontend type-check / test を実行する。
