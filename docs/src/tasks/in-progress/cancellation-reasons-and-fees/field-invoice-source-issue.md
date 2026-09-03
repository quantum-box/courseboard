# Field 起票案：請求書に「何に対する請求か」の参照を持つ

CourseBoard からは実装せず、Field 側に起票して待つもの（CLAUDE.md の責務分担）。
Linear MCP が未認証のためこのセッションからは起票できないので、本文をここに置く。
そのまま Linear（PLT-…）に貼れる粒度で、ゴルフの語彙は剥がしてある。

## 背景

`invoices` は「誰にいくら請求するか」は持つが、「何に対する請求か」を持たない。
`billTo` で相手は分かり、`lineItems[].description` に人が読む文が入るだけで、
その請求の元になったレコード（予約・注文・契約）への機械可読な参照が無い。

そのため請求書の種別を判定する手段が文字列しかない。CourseBoard は
キャンセル料の請求書を `notes` に `[courseboard:cancellation-fee]` という印を
埋めることで見分けており、一覧はその部分一致で絞っている。これは3つ壊れている。

1. **印は消せる。** `notes` はオペレーターが編集できるので、編集した瞬間に
   その請求書は一覧から消える。消えたことは誰にも分からない。
2. **元レコードへ戻れない。** 「この請求書はどの予約に対するものか」を Field は
   答えられない。CourseBoard 側に対応表（`fee_invoice_id`）を持って補っているが、
   これは Field の請求書が自分の由来を知らないことの代償でしかない。
3. **逆も引けない。** 「この予約に対して請求書が出ているか」を Field に聞けない。
   CourseBoard の表を読むしかなく、表が書けなかったケース（請求は通ったが
   記録が落ちた）は二重請求として現れる。

## 求める contract

業種非依存の「請求書の由来」。キャンセル料に限らず、追加請求・違約金・
サービス料金など、既存レコードから起こす請求すべてに同じ形が要る。

- `invoices.source`（nullable、1 請求書に 1 つ）
  - `sourceType` — `reservation` / `order` / `subscription` など、Field が持つ
    レコード種別の enum。文字列の自由入力にしない
  - `sourceId` — そのレコードの ID
  - `reason` — 任意の短い分類文字列。**呼び出し側が意味を与える**。
    Field はこれを解釈しない（ゴルフの `cancellation_fee` も、他業種の
    `no_show_fee` も、Field にとっては同じ不透明な札）
- `POST /v1/invoices` が `source` を受け取り、そのまま保存する
- `GET /v1/invoices?sourceType=…&sourceId=…` — その予約に対する請求書を引く
- `GET /v1/invoices?reason=…` — 分類での絞り込み。いまの `notes` 部分一致の代替

複数の元レコードを 1 通にまとめる請求（同じ人の複数キャンセルを 1 通にする、
というのは実際に起きている）があるので、`source` は 1 対 1 ではなく
`sources`（配列）でもよい。CourseBoard 側はどちらでも受けられる。

## 求めないもの

- 元レコードからの金額の自動算出。いくら請求するかは呼び出し側の判断で、
  Field が予約金額から計算するものではない
- 元レコードの status を請求書が書き換えること。予約を「請求済み」にするのは
  呼び出し側の仕事
- キャンセル料という語彙そのもの。Field に要るのは「由来」だけで、
  それがキャンセル料かどうかは CourseBoard が `reason` に入れる札の意味である（ADR-0005）

## Field が入るまでの CourseBoard 側

`golf_reservation_cancellations.fee_invoice_id` が予約と請求書の対応を持ち、
一覧は `notes` の印で絞り続ける。`source` が入ったら、印を書くのをやめて
`source` を送り、一覧の絞り込みを `sourceType` / `reason` に切り替える。
CourseBoard 側の対応表は、逆引き（予約 → 請求書）が Field で引けるようになれば
消せる。
