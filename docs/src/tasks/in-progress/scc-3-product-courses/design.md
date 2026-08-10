# SCC-3 コース横断予約商品の設計

## Links

- [taskdoc](./task.md)
- [PLT-3353: generic reservation product に eligibleResourceIds を導入する](https://linear.app/quantum-box/issue/PLT-3353)
- [ADR-0005: CourseBoard と Field の責務分担](../../../architecture/decisions/ADR-0005-golf-domain-ownership.md)

## 目的

単一の商品を複数のゴルフコースで利用できるようにする。季節パスのように商品条件、
価格、`playType`、`availability` を共通にしながら、営業時間、枠、在庫は予約時に
選択した resource のものを使う。

全商品を複数コース化する変更ではない。`golfCourseIds` が 1 要素の商品は従来の
コース専用商品であり、複数要素の商品だけが横断商品になる。

## 責務と contract

1 つの `reservationProducts` 要素に次の 2 つを同時に保持する。

```json
{
  "golfCourseIds": ["course-east", "course-west"],
  "eligibleResourceIds": ["resource-east", "resource-west"]
}
```

- `golfCourseIds` は CourseBoard 所有のゴルフ domain key。Field は解釈しない。
- `eligibleResourceIds` は Field 所有の業種非依存な reservation resource allow-list。
- CourseBoard は各 course に紐づく canonical active resource を解決して両方を同じ
  config write で保存する。1 件でも解決できなければ PATCH 自体を行わない。
- 同一商品内の価格、`playType`、期間等は全所属コースで共通。コース別の商品条件は
  SCC-3 の対象外。

## Read compatibility

- `golfCourseIds` key が存在すれば常に優先する。
- 配列は trim と重複除去を行う。
- key が存在するが空、型不正、要素不正なら販売対象なしとして fail closed にする。
  同居する legacy scalar へ fallback しない。
- `golfCourseIds` key が無い場合だけ `golfCourseId` を singleton として読む。
- 両 key が無い SCC-3 以前の商品は従来どおり course 制約なしとして読む。
- API response は `golfCourseIds` を常に返す。`golfCourseId` は 1 要素のときだけ
  compatibility alias として返す。
- API request は array と scalar のどちらか一方を受理する。両方同時、空 array、
  空の要素は 400 にする。

## Write gate

PLT-3353 deploy 前は `GENERIC_RESOURCE_ELIGIBILITY_WRITES_ENABLED=false` とし、
新しい array pair を production path から書かない。

- legacy 商品への singleton request は従来の scalar shape で保存できる。
- 既存 canonical 商品は、array input が現在の membership と完全一致する場合だけ
  商品条件を編集でき、2 つの array はそのまま保持する。
- 新しい multi-course membership の作成・変更は明示的な 400 にする。singleton へ
  縮退させず、no-op の成功にもせず、writer gate が閉じていることを caller から
  観測できるようにする。
- 既存 multi-course 商品を legacy scalar request で更新する操作は拒否し、旧 SPA が
  singleton へ黙って縮退させる経路を閉じる。

gate を `true` にする条件は、(1) PLT-3353 が Field に deploy 済みであり、かつ
(2) storefront が `eligibleResourceIds` を選択 resource の membership として
解釈することを実リクエストで確認済みであること。この 2 条件が揃うまでは変更しない。
解禁後、CourseBoard は全 selected course の resource を先に解決し、
`golfCourseIds` と `eligibleResourceIds` を同じ product object へ書き、legacy scalar
を削除する。

## Deploy と rollback

順序は次で固定し、逆順にはしない。

1. Field / PLT-3353
2. CourseBoard API の canonical writer 解禁
3. CourseBoard SPA の複数選択 UI と membership filter
4. storefront と CourseBoard の E2E

array pair を書き始める前なら CourseBoard API は単独 rollback できる。multi-course
商品を書いた後に Field を rollback すると storefront が contract を失うため、Field
単独 rollback は不可。緊急時は先に CourseBoard writer を停止し、既存 multi data を
読める Field version を維持する。

## Availability と entitlement

既存 `availability` は product object の未知 key と同じく必ず保持され、全所属
course で共通になる。新しい期間 contract は SCC-3 に追加しない。

`availability` を CourseBoard から編集する UI と、購入済み券の権利期間・複数回
redemption を表す entitlement capability は別 issue とする。

## 完了条件

- legacy scalar、canonical singleton、canonical multi を CourseBoard が読める。
- 空・欠落・malformed・unknown resource eligibility は unrestricted にならない。
- canonical active resource を持たない course が 1 つでもあれば config を保存しない。
- CourseBoard の予約作成と tee sheet mismatch 判定が course membership を使う。
- legacy scalar-only update で multi membership を縮退できない。
- `availability` と Field / 他 surface が持つ未知 key を保存時に維持する。
- Field storefront が選択 resource の membership で同じ商品集合を返す。
- Field、CourseBoard API、CourseBoard SPA の E2E が揃うまで SCC-3 を完了にしない。
