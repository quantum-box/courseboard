# SCC-8 schedule roundtrip design

## Boundary

read-modify-write は `FieldGolfCatalogGateway::replace_resource_schedule` に閉じる。use case と
domain は利用者が編集できる schedule field だけを引き続き表し、Field-owned field を
ゴルフ domain に取り込まない。

処理順は次のとおり。

1. PUT と同じ resource schedule endpoint を GET する。
2. response rule の既知 field を domain decode し、未認識 field は JSON map に保持する。
3. request rule の id と current rule の id を対応付ける。
4. current の未認識 field から response-only metadata を除く。
5. CourseBoard が編集した既知 field と tenant timezone を上書きする。
6. rules 全体を PUT し、Field response を domain response に変換する。

## Compatibility

- `effectiveFrom`、`effectiveTo`、annual season、および将来 Field が追加する writable field
  は CourseBoard が認識しなくても同じ rule id に残る。
- id の無い新規 rule には引き継ぐ current rule がないため、既知 field のみ送る。
- request から消えた rule は current に存在しても送らない。replace semantics と既存の
  削除操作を維持する。
- top-level `resourceId` と rule の response-only metadata は現行 Field PUT が拒否するため
  echo しない。mutable field の deny-list にはしない。

## Concurrency

GET は PUT 直前に行うため、画面表示時の snapshot を再送するより競合窓を狭くする。
Field endpoint に revision/CAS contract はなく、GET と PUT の間に別 writer が変更した
場合の lost update は完全には防げない。これは現行 replace endpoint の制約であり、
SCC-8 では既存 Field-owned field の黙示的削除を止めることに範囲を限定する。

## Regression test

local mock Field は既存 DTO に存在しない `futureWritePolicy` を GET response に含める。
CourseBoard が capacity と timezone だけを変更した PUT body で、その nested JSON が同値で
保持されること、GET→PUT の順序、response-only metadata の除外を検証する。annual season
という既知の症状名には依存しない。

