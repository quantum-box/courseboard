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

## UI / API identity contract

Field から読み込んだ rule と、画面で追加した rule の由来を UI state に保持する。保存時は
次の二形だけを CourseBoard API が受理する。

- 既存: `id` あり、`isNew` なし。
- 新規: `id` なし、`isNew: true`。

`id` なし、`isNew` なしは 400 にする。`id` あり、`isNew: true` も矛盾した request として
400 にする。CourseBoard API は `isNew` を Field へ転送せず、domain の `id` なし rule として
gateway へ渡す。

この明示値が必要なのは、全置換 request だけでは「既存 A を削除して新規 B を追加」と
「既存 A の ID が脱落」を区別できないためである。weekday や時刻による推測は、時刻変更や
曜日コピーで誤判定する。UI が持つ作成由来を request に伝え、gateway は従来どおり ID の
完全一致だけで current rule を merge 元にする。

## Compatibility

- `effectiveFrom`、`effectiveTo`、annual season、および将来 Field が追加する writable field
  は CourseBoard が認識しなくても同じ rule id に残る。
- id の無い新規 rule には引き継ぐ current rule がないため、既知 field のみ送る。
- 新規 rule は UI が `isNew` を明示する。従来の曖昧な id-less CourseBoard API request は
  拒否する。
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

加えて jsdom 上で `CourseSchedulePage` を描画し、実際の capacity input と保存 button を
操作する。mock CourseBoard API の背後には season と effective range を同時に持つ raw Field
state を置く。UI の PUT payload に既存 ID が入ること、その ID で merge した raw state に
両 field 群が残ることを検証する。新規追加の `isNew` と、読み込み済み ID 欠落時に PUT しない
ことも同じ component の保存経路で検証する。
