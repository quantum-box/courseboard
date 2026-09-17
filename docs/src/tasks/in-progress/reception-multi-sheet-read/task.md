# 受付用紙を一度に複数枚読み取る

## Links

- 前提: `docs/src/tasks/completed/v0.1.14/ai-ocr-customer-reception/task.md`
- Field 側: 汎用 OCR `POST /v1/field/ocr/{entity}/draft` の複数ファイル対応: https://github.com/quantum-box/tachyonfield/pull/1412
- Linear issue: 未作成

## 概要

受付画面は 1 回の読み取りで 1 ファイルしか受け付けず、組が複数枚の用紙に
分かれて届くと、1 枚ずつ読み取り → 登録 → 次の用紙、を繰り返す必要があった。
読み取り結果も 1 枚分で上書きされるため、同じ組の行を 1 画面で照合できない。

## 方針

- **読み取りは Field の汎用 capability。** 複数ファイルを「1 つの書類の連続したページ」
  として読むのは業種非依存の機能なので Field 側に入れる（ADR-0005）。ゴルフの語彙は
  持ち込まない。CourseBoard は受付票のスキーマとファイルを順に渡すだけ。
- **順序が契約。** えらんだ順 = multipart の `file` パートの順 = Field が読むページ順 =
  返ってくる行の順。行の位置を用紙の行として登録の来歴に残している既存の設計を崩さない。
- **上限は Field に合わせる。** 1 回 8 枚（Field が 1 リクエストで読める画像数）、
  合計 4,000,000 バイト（Field / Lambda の同期リクエストのファイル予算）。超過は
  プラットフォームに黙って落とされる前に CourseBoard で 400 にする。
- **ブラウザで縮小してから送る。** 合計が予算を超えるときは写真（JPEG/PNG）だけを
  長辺 2400 → 1800 → 1400 → 1100px の順に再エンコードする。PDF は触らない。
  Field は読み取り前にさらに小さな予算へ縮めるため、ここで失うものは読み手に届かない分。
- 白紙フォームの解析（項目設定の提案）は 1 枚のまま。

## 実装

### Field

- `/v1/field/ocr/{entity}/draft` が 1〜8 個の `file` パートを受け付け、1 つの書類として読む。
- `pages`（PDF のページ指定）は 1 ファイルのときだけ有効。

### CourseBoard

- `ReceptionSheets`（1〜8 枚、合計 4MB 以内）を domain に追加し、
  `CustomerReceptionOcrGateway::draft_reception` が受け取る。
- `POST /v1/course/customers/reception-draft` が複数 `file` パートを順に読む。
- 受付画面: ファイル選択を `multiple` にし、プレビューを「n枚目 / m枚」で並べる。

## 検証

- `cargo test`（domain / usecase / gateway の複数枚テスト）
- `npm run type-check` / `npm run test`（検証・縮小・API の multipart 組み立て）
- mock データの受付画面で 3 枚（PNG 2 + PDF 1）と 9 枚（拒否）を確認
