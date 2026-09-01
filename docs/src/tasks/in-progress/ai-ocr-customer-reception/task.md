# 受付用紙の画像から顧客を登録する（AI OCR）

## Links

- Field 側の汎用 OCR: tachyonfield [#1041](https://github.com/quantum-box/tachyonfield/pull/1041)
  （`POST /v1/field/ocr/{entity_key}/draft` とスキーマ駆動の OCR 取込画面）、
  [#1054](https://github.com/quantum-box/tachyonfield/pull/1054)（カスタムフィールド連携）
- Field 側の上流失敗の扱い: tachyonfield [#1238](https://github.com/quantum-box/tachyonfield/pull/1238)
  （[PLT-4033](https://linear.app/issue/PLT-4033)、merge commit `cfccc0d0`）
- Linear issue: [PLT-4036](https://linear.app/issue/PLT-4036)（上流失敗の出し分け）
- 任意形式の受付項目: tachyonfield [#1255](https://github.com/quantum-box/tachyonfield/pull/1255)
- 空の申込書から項目設定を提案する分析 API: tachyonfield [#1257](https://github.com/quantum-box/tachyonfield/pull/1257)
- [設計](design.md)

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
- 受付票の標準項目をテナントごとに `enabled / required / label` で設定する。
- ゴルフ場固有の追加項目を定義し、OCR・確認・登録・CourseBoard ローカル保存まで一貫して扱う。
- 氏名・カナ・電話・メール・生年月日・性別・住所は Field 顧客台帳を正とする。

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
  （上流 OCR の失敗だけは後述のとおり種類ごとに出し分けるようになった）
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

## 任意形式対応（tachyonfield #1255 追随）

PR version: API `0.1.12`（base `0.1.11`）、UI `0.1.8`（base `0.1.7`）。

- [x] DD で標準項目とゴルフ固有項目の保存境界を確定
- [x] `golf_reception_fields` と `golf_customer_reception_values` の migration / repository
- [x] 項目設定 GET/PUT API と認可分類
- [x] 設定から組み立てる OCR schema と動的 draft DTO
- [x] 標準追加項目の Field 登録と追加項目のローカル保存
- [x] 受付票項目設定 UI と動的な確認行
- [x] Rust / frontend の focused test
- [ ] 実ブラウザと実 Field API での保存確認

### PR前検証

- `cargo fmt --all -- --check`
- `cargo clippy --lib --all-features -- -D warnings`
- TiDB を使った `cargo test`（1017件）
- `npm run type-check`
- `npm run test`
- `npm run build`

実ブラウザ・実 Field API はPR Previewで確認するため未実施。固定のゴルフ同意キーが
対象テナントの Field consent item に設定済みであることも実環境確認に含める。

## 空用紙分析（tachyonfield #1257 追随）

PR version: API `0.1.13`（base `0.1.12`）、UI `0.1.9`（base `0.1.8`）。

- [x] `POST /v1/course/customer-reception-fields/analysis` で空用紙を Field の分析 API へ転送
- [x] Field の標準項目提案を既存の CourseBoard 受付票項目へ写像
- [x] `consumer` のカスタム項目を CourseBoard ローカル項目として提案し、subject 項目など保存先がない提案を warning として表示
- [x] 設定画面で分析結果を未保存の提案として反映し、確認・修正・取消・保存できる UI
- [x] 項目設定と空用紙分析を受付作業画面から `settings/reception-fields` へ移動
- [x] 分析時に氏名の独自表示名を維持し、提案取消で分析前の未保存編集へ戻す
- [x] mock、Rust、frontend の focused test
- [ ] 実 Field API の #1257 ルートへ空用紙を送った結果を PR Preview で確認

氏名とゴルフ固有の同意項目は Field #1257 の分析対象外であり、CourseBoard の既存固定定義を
維持する。分析は設定を自動保存せず、受付係が原本と照合して保存する。

### PR前検証

- `cargo fmt --all -- --check`
- `cargo check --all-targets`
- `cargo clippy --all-targets --all-features -- -D warnings`
- `cargo test --lib blank_form`、`cargo test --lib consumer_custom_fields`
- `cargo test --lib every_registered_route_is_classified`
- `cd desktop && npm run type-check`
- `cd desktop && npm run test`（107 files / 925 tests）
- `cd desktop && npm run build`
- mock UI で空用紙分析、標準項目と custom 項目の提案、warning、preview、取消を確認
- mock UI で受付作業画面から項目設定が外れ、設定ハブと `settings/reception-fields` に表示されることを確認
- PR Preview の Field Golf Sandbox で設定画面への移動と受付作業画面からの分離を確認

PR Preview から実 Field API への空用紙送信は未確認。今回の差分に DB schema 変更はない。

## 上流 OCR が失敗したときの出し分け（PLT-4036）

Field は上流 tachyon-api の失敗も 200 + 空ドラフト + 固定文言に潰していた。
そのため上流が 402 を返し続けていたテナントで、受付にはピンボケ写真とまったく
同じ「書類を読み取れませんでした。」しか届かず、用紙を何度も撮り直していた。
Field #1238 で上流失敗が status で返るようになったので、CourseBoard も
「読み取りが動かなかった」と「用紙が読めなかった」を分けて扱う。

| Field | CourseBoard | `error` |
|---|---|---|
| 402 `PAYMENT_REQUIRED` | 402 | `reception_reader_billing_unsatisfied` |
| 429 `TOO_MANY_REQUESTS` | 429 | `reception_reader_rate_limited` |
| 503 `SERVICE_UNAVAILABLE` | 424 | `reception_reader_unavailable` |
| 上記以外の 4xx | 従来どおり | `upstream_client_error` ほか |
| 200 + `warnings` | 200 | —（これが本物の「用紙が読めなかった」） |

- 400 や 401 は分類しない。前者はこちらの組み立てが悪く、後者は呼び出し側の
  セッションの話で、どちらも読み取りサービスの障害ではない。請求設定を見に
  行かせるのは誤誘導になる。
- 503 を 503 のまま返さないのは、Cloudflare が origin の 5xx を CORS ヘッダの
  無い HTML に差し替え、ブラウザに "Failed to fetch" しか届かないため。
- Field の英文メッセージは転送しない。Field 運用者向けの英語で、受付に出す
  日本語は画面が持つ。
- **402 は1種類ではない。** 同じ `PAYMENT_REQUIRED` で上流 message は
  `No billing account linked` と `Insufficient balance. Required: ..., Available: $0`
  の両方が実測されている。Field は上流本文をコピーしない（OCR 内容を echo
  しうる）ので status からは判別できず、必要な行動は「請求先を連携する」と
  「残高を足す」で別。片方だけ案内すると誤誘導になるので、文言は両方を指す
  （「請求設定（請求先の連携と残高）の確認を依頼してください」）。
- **これは運用中の障害モードで、セットアップ漏れの1テナントではない。**
  同じ bearer・同じリクエストで 200 を返していたテナントが約1時間後に
  402 `Available: $0` に落ちるのが観測されている。上流の請求が尽きれば
  全テナントの受付 OCR が同時に止まる。

## 確認済み

prod Field（テナント `tn_01kxd5gdvm9thcbj8c2e8c6yhq`）に対して、印字された日本語の
受付用紙（4人・氏名/カナ/電話/メール）を読ませ、4人とも全項目一致で読み取れた。
HEIC も JPEG 変換を経て同じ経路を通る。

権限について。`field:RegisterMembership` は platform 登録済みのアクションで、
説明は "Register Field customer memberships with subjects, consents, and credentials"。
このテナントのメンバー3人は `role: null`（テナントオーナー、AdministratorAccess）
のため OCR は通る。

## 未確認

- **staff ロールでの実行可否。** `pol_erp_staff` の説明は "Field staff with customer
  CRUD and operational read access" で、membership の register が含まれるかは
  読み取れない。ポリシーに紐づくアクション一覧は platform API から取得できなかった
  （`GET /v1/auth/policies/{id}` は statements を返さず、`/actions` と `/statements`
  は 404）。実証には staff ロールのユーザーが要る。オーナー以外の受付担当が使う
  テナントでは、最初の1回で 403 が出ないか確認すること。
- 実際の受付用紙（手書き・複写伝票）での読み取り精度 → [PLT-3591](https://linear.app/issue/PLT-3591)
- **上流失敗の出し分けの実測。** 分類・status・コード・画面の分岐は unit test で
  固定したが、prod Field に実際に 402 / 429 / 503 を返させての確認はしていない。
  Field #1238 の prod 反映後、402 を返すテナントで受付画面に請求設定の文言が
  出ることを確認する。
