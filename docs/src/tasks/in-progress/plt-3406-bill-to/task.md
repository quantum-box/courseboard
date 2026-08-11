# CourseBoard の請求先と法人売掛を連携する

## Links

- [設計](./design.md)
- [PLT-3406](https://linear.app/issue/PLT-3406)
- [PLT-3373](https://linear.app/issue/PLT-3373)
- [tachyonfield #1001](https://github.com/quantum-box/tachyonfield/pull/1001)
- [PLT-3358 の CourseBoard 側設計](../reservation-customer-ledger/design.md)

## 状態

調査・設計まで完了。実装は未着手。

tachyonfield #1001 は merge 済みだが、依頼時点では PLT-3403 の並行 deploy 競合による
`PreconditionFailedException` で main deployment が失敗しており、production runtime に contract が
未到達である。呼び先が存在しない状態では実装を検証できないため、この task では docs だけを変更する。

## 調査結果

- [x] fresh `origin/main` `75d90463b2cfb22763c138078acc02022a8416a7` を基準にした。
- [x] 顧客台帳は `/v1/storekit/customers`、予約は `/v1/erp/reservations` であることを確認した。
- [x] 予約 create / update、PLT-3358 の代表者・全プレイヤー紐付けを確認した。
- [x] CourseBoard domain / API / UI に bill-to が無いことを確認した。
- [x] 月次精算が golf extension 集計と reservation billing invoice を使い、AR/AP balance を読まないことを
  確認した。
- [x] キャンセル料の direct invoice と legacy collection API が `courseboard:` synthetic ID を生成することを
  確認した。
- [x] tachyonfield #1001 の affiliation、admin reservation bill-to、invoice typed response、AR/AP 伝播を
  実 contract で確認した。
- [x] storefront が `billTo` を拒否する一方、CourseBoard の予約作成はすでに admin surface であるという
  issue 前提との差を切り分けた。
- [x] 予約時同送と予約後設定の得失を整理した。
- [x] プロダクト判断、Field contract、現場確認事項を分離した。
- [x] 実データにはアクセスしなかった。実顧客 tenant には読み書きとも触れていない。

## 実装前 blocker

- [ ] tachyonfield #1001 を含む main deployment が成功する。
- [ ] 予約時同送、予約後設定、hybrid のどれを採るか決める。
- [ ] 法人売掛を確定する担当とタイミングを現場に確認する。
- [ ] 一予約一 invoice と法人月次合算 invoice のどちらかを現場に確認する。
- [ ] client lookup と affiliation の終了・訂正 contract を Field 側で決める。
- [ ] 代表者 customer ID の後付け contract（PLT-3379）を解決する。
- [ ] direct/manual invoice の typed bill-to input を Field 側で決める。
- [ ] invoice から AR/AP への転記責務と retry / failure visibility を決める。
- [ ] historical as-of、ID grouping、source / currency scope を満たす balance contract を決める。

## 実装候補

blocker 解消後に scope を切り直す。現時点の候補は次である。

1. affiliation / client lookup の CourseBoard domain・gateway・API
2. 顧客詳細の所属会社 UI
3. reservation bill-to の read/create/update と予約 UI
4. 請求先確認待ち queue（後付けまたは hybrid の場合）
5. キャンセル料 invoice producer の統合と synthetic ID 廃止
6. invoice → AR/AP posting の状態可視化
7. 月次精算の相手先別売掛と CSV

## Non-goals

- 今回の API / UI / migration 実装
- tenant data の作成・更新
- 既存 invoice / AR/AP の再分類
- production deployment または merge
