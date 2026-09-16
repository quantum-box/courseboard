# ランク別単価の変更履歴を残す

## Links

- [PLT-3348](https://linear.app/issue/PLT-3348)
- 関連: PLT-3346（個人単価→ランク単価移行）、PLT-3349（過去配置の fee_amount）

## なにが問題だったか

`golf_caddie_rank_fees` はテナントごとに1行で、保存すると上書きされる。
いまの単価は分かるが、先月の給与額を出したときの単価・誰がいつ変えたか・なぜ変えたかは
どこにも残らない。キャディに「なぜ支給額が変わったか」を聞かれても答えられない。

## 実装

- [x] `golf_caddie_rank_fee_changes`（追記のみ）。変更前・変更後の A〜D と通貨、理由、
      変更者の `sub` と `username`、日時。単価の上書きと同じトランザクションで書く。
- [x] 既存テナントは移行時点の単価を1件目として種まきする（`previous_*` は NULL）。
- [x] 変更前は「給与計算がその時点で読んでいた単価」。初回保存なら既定値か旧 extension config。
- [x] すでに保存されている単価と同じ内容の保存は履歴を残さない。
- [x] 変更者は検証済みトークンから取る（`sub` と Cognito の `username` claim）。
      リクエスト body の名前は信用しない。
- [x] `PUT /v1/course/caddie-rank-fees` に任意の `note`（500文字まで）。
- [x] `GET /v1/course/caddie-rank-fees/history?limit=`（既定50、最大200、新しい順）。
      `field_extension_golf:ListCaddieRankFees` で認可、`ROUTES` に分類を追加。
- [x] 単価シートに「変更の理由」入力と変更履歴の一覧。

## 範囲外

- 過去の月を「その月に有効だった単価」で計算し直すこと。給与額は引き続きいまの単価で
  計算する（シートの注意書きのまま）。配置ごとの金額の固定は PLT-3349 で扱う。
