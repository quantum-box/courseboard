# 任意形式の受付票取込

## 背景

現行の受付票取込は、氏名・ふりがな・電話番号・メールアドレスと固定の同意項目だけを
OCR スキーマへ渡している。画像上の配置は自由だが、用紙に載る項目は固定であり、
ゴルフ場ごとに異なる住所欄、性別、生年月日、会員区分などを取り込めない。

tachyonfield PR #1255 は、標準列を持つ項目を `enabled / required / label` で設定し、
業種固有項目を custom field として分離した。本対応も同じ分離を採用する。ただし
ADR-0005 と ADR-0009 に従い、ゴルフ固有項目の定義と回答は CourseBoard ローカル DB が
所有し、Field の custom-field registry や extension config は使わない。

## 目標

- ゴルフ場が受付票にある標準項目を選び、必須性と用紙上の呼称を設定できる。
- ゴルフ場固有の追加項目を、テキスト・日付・選択肢・真偽値として定義できる。
- OCR、確認画面、登録時のサーバ検証が同じ項目設定を使う。
- 標準項目は Field 顧客台帳へ、追加項目は CourseBoard DB へ保存する。
- 設定未保存のテナントでは、現在の受付票と同じ項目・呼称を既定として返す。

## 非目標

- 用紙から予約、プレー商品、ティータイムを作ること。
- 受付票画像や OCR の生出力を保存すること。
- Field の custom-field definition を CourseBoard から管理すること。
- Field UI や extension config を CourseBoard 利用者に操作させること。

## データモデル

### `golf_reception_fields`

テナントごとの受付票項目定義を保持する。

- `tenant_id`, `field_key` を主キーとする。
- `kind`: `standard` または `custom`。
- `field_type`: `text / tel / email / date / select / boolean / address`。
- `enabled`, `required`, `label`, `sort_order`, `options_json` を持つ。
- 標準キーは `name / name_kana / phone / email / birth_date / sex / address`。
- `name` は常に有効かつ必須で、無効化も任意化もできない。
- 保存行がなくても GET は標準項目の完全な既定一覧を返す。将来標準項目を追加しても、
  保存済みテナントから黙って消えないよう、保存行と既定を merge する。

### `golf_customer_reception_values`

追加項目の回答を `tenant_id / customer_id / field_key` で保持する。値は型検証後の JSON。
標準項目は重複保存しない。顧客 ID は Field の正への参照であり、顧客本体を複製しない。

## API

- `GET /v1/course/customer-reception-fields`
  - 保存済み設定と既定を merge した全項目を返す。
  - `field_extension_golf:ListCustomers`。
- `PUT /v1/course/customer-reception-fields`
  - 項目一覧を検証して置換する。
  - `field_extension_golf:ManageCustomers`。
- `POST /v1/course/customers/reception-draft`
  - 従来どおり multipart の `file` を受ける。
  - サーバが現在の項目設定から OCR schema を組み立てる。
  - ドラフト行は標準値と `customFields` を返す。
- `POST /v1/course/customers`
  - 受付票由来では `customFields` と標準追加項目を受ける。
  - 現在の設定に対する必須・型・選択肢検証を、Field 顧客作成より前に行う。
  - Field 作成後に追加項目保存だけが失敗した場合、顧客を再登録させないため作成済み顧客を
    返し、`customFieldsRecorded: false` で部分失敗を示す。
- `PUT /v1/course/customers/{customer_id}/reception-values`
  - Field 顧客を作り直さず、部分失敗した追加項目だけを冪等に再記録する。
  - 現在の項目設定で必須・型・選択肢を再検証する。

## Field 境界

標準項目の登録は、#1255 時点で生年月日・性別・住所を受け取れる
`POST /v1/erp/customers` を使う。検索・取得の既存 StoreKit 経路は変更しない。
Field へは利用者の bearer と operator/platform scope をそのまま転送する。

Field の汎用 OCR は複合 `address` 型を受けないため、住所設定は OCR schema でだけ
郵便番号・都道府県・市区町村・番地・建物名の5つの `text` 列へ展開し、draft で住所
オブジェクトへ戻す。設定 PUT 時に Field と同じキー・ラベル・選択肢・20列・64KiB上限を
検証し、保存後の最初の読取で初めて400になる状態を作らない。

同意は #1255 と同じく顧客作成 payload に含め、Field 側で事前検証と顧客作成後の補償を
一つの受付登録として扱う。固定のゴルフ同意キーは Field の consent item として設定済みで
あることが前提で、未知のキーなら顧客を作る前に400で拒否する。

追加項目はゴルフ固有であるため Field へ送らない。Field の custom-field registry は
業種非依存 capability だが、そこに保存する値の意味はゴルフ場固有であり、CourseBoard
利用者が Field UI を触らずに運用できるという ADR-0010 の境界も維持する。

## UI

受付票画面に「受付票の項目設定」を置く。設定では標準項目の表示・必須・呼称を編集し、
追加項目の追加・削除・型・選択肢・並び順を編集する。読み取り後の各行は同じ設定順で
描画し、必須欄が空なら登録ボタンの理由を表示する。修正前の OCR 値は標準項目と追加項目の
両方で併記する。

## 失敗と整合性

- 設定変更前から開いている画面を信用せず、登録時にサーバで再検証する。
- OCR 実行中に設定が変わった場合、登録時点の設定を正とする。
- 追加項目を削除しても過去回答は物理削除しない。画面からは非表示にし、監査可能性を残す。
- 顧客作成前にすべての追加項目を検証する。作成後に起こりうるのは DB 書込障害だけに絞る。
- 追加項目の DB 書込障害は、作成済み customer id と画面に残した回答から追加項目だけ再試行する。

## 検証

- domain: 既定 merge、固定必須、型・選択肢・必須検証、OCR schema。
- repository: テナント分離、置換、追加項目回答の upsert。
- HTTP: GET/PUT、動的 draft、登録 DTO、認可ルート分類、OpenAPI。
- frontend: 設定編集、動的行、必須理由、payload、修正値表示、i18n 完全性。
- browser: 設定変更 → 異なる様式の画像/PDF読取 → 修正 → 登録 → Field 標準項目と
  CourseBoard 追加項目の保存を別々に確認する。
