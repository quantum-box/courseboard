# 受付用紙の画像から顧客を登録する（AI OCR）

## Links

- Field 側の汎用 OCR: tachyonfield [#1041](https://github.com/quantum-box/tachyonfield/pull/1041)
  （`POST /v1/field/ocr/{entity_key}/draft` とスキーマ駆動の OCR 取込画面）、
  [#1054](https://github.com/quantum-box/tachyonfield/pull/1054)（カスタムフィールド連携）
- Linear issue: 未作成

## 概要

受付は紙で来る。スキャンした受付用紙、サインイン用紙の写真、代理店からの FAX。
1組4人の名前を打ち直すのは朝の受付でいちばん遅い作業で、ビジターが顧客台帳に
載らないままになる原因でもある。

Field には書類をフォームスキーマに沿って読む汎用 OCR がある（entity_key の
allowlist に個人顧客 `consumer` を含む）。CourseBoard は受付用紙の項目定義を
供給してこれを呼び、読み取り結果を原本と見比べて直してから台帳へ登録する。

## Scope

- `POST /v1/course/customers/reception-draft`（multipart、`file` のみ）を追加し、
  Field `/v1/field/ocr/consumer/draft` へ転送する。何も保存しない。
- 受付用紙のスキーマ（氏名・カナ・電話番号・メールアドレスを行として繰り返す）は
  CourseBoard がサーバ側で持つ。ゴルフの語彙は CourseBoard の所有物（ADR-0005）で、
  UI ごとに変わるスキーマは読み取り結果を再現できない。
- 専用画面 `#/golf/customers/reception` を追加する。右に原本プレビュー
  （画像は `img`、PDF は `iframe`）、左に読み取った行。直した項目の下に読取値を併記する。
- iPhone で撮った HEIC/HEIF はブラウザで JPEG に変換してから送る。Field の汎用 OCR は
  JPEG・PNG・PDF しか受けないため、Field の receipt OCR（tachyonfield `3bb583a2`）と
  同じく `heic2any` を使う。Field 側の変更は要らない。
- 登録は既存の `POST /v1/course/customers` を1行ずつ呼ぶ。名前だけで登録できる。
- 読めなかった行も残す（電話番号だけの行など）。名前が入るまで登録ボタンは押せない。
- 同姓同名は消さずに印を付ける。1組に同姓同名が実在するため、自動で落とすと人が消える。

## Non-goals

- 用紙から予約（ティータイム・組・プレー商品）を作ること。読み取るのは人だけ。
- 読み取り結果や画像の保存。Field も CourseBoard も持たない（`manualApprovalRequired` 固定）。
- 既存顧客との自動名寄せ。台帳に同じ人がいるかの判断は受付が行う。
- 会員申込書（Field の `membership_registration`）の取込。

## 対象モジュール

- `src/course/domain/customer_reception.rs` — 受付用紙のスキーマ、ファイル種別の検証、ドラフト
- `src/course/domain/ports.rs` — `CustomerReceptionOcrGateway`
- `src/course/infrastructure/field_customer_reception_gateway.rs` — Field 汎用 OCR への multipart 転送
- `src/course/usecase/draft_customer_reception.rs` — 読み取りのみ（書き込みを含まない）
- `src/course/interfaces/http_customers.rs` — multipart ハンドラと DTO
- `desktop/src/features/golf/customers/reception/` — 受付画面

## 実装

- [x] ドメイン: 受付用紙スキーマ、JPEG/PNG/PDF のマジックバイト検証、10MB 上限、行の正規化
- [x] gateway: `/v1/field/ocr/consumer/draft` へ転送し、`fields.visitors` を行へ写像
- [x] usecase: 読み取りのみ。上流障害は 424 `provider_error` として返る
- [x] API: `POST /v1/course/customers/reception-draft`、OpenAPI 登録、`:customer_id` より前にルート登録
- [x] 画面: 2カラム、行の追加、1行ずつ／まとめて登録、読取値の併記、同姓同名の注意
- [x] HEIC/HEIF: `heic2any` を動的 import して JPEG へ変換（別チャンク、選んだときだけ読み込む）。
  変換後のファイルで種別とサイズを検証し、プレビューも変換後を使う（Safari 以外は HEIC を描画できない）
- [x] Tauri の CSP `frame-src` に `blob:` を追加。PDF プレビューの `iframe` がデスクトップ版で
  ブロックされていた（`img-src` には `blob:` があるため画像は影響なし）
- [x] i18n: ja / ja-plain / en
- [x] モック: `VITE_COURSEBOARD_MOCK_DATA=true` で読み取り結果の fixture を返す
- [x] `cargo clippy`（lib）、`cargo test --lib reception`、`npm run type-check`、
  `vitest run src/features/golf/customers`
- [ ] 実 Field API に対する動作確認（テナントに `field:RegisterMembership` が要る）
- [ ] CourseBoard の required checks が green になる

## 未確認

- 実 Field production の `/v1/field/ocr/consumer/draft` に対しては未実行。
  権限は Field 側で `field:RegisterMembership` に紐付いているため、受付担当の
  ロールに含まれているかをテナントごとに確認する必要がある。
- 読み取り精度は用紙のレイアウトに依存する。実際の受付用紙での確認は未実施。
