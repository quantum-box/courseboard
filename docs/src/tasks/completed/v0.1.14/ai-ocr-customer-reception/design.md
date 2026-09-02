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

設定ハブの `settings/reception-fields` に「受付票の項目」を置く。設定では標準項目の
表示・必須・呼称を編集し、追加項目の追加・削除・型・選択肢・並び順を編集する。
受付画面は用紙の読み取り・確認・登録だけを扱い、設定フォームを表示しない。読み取り後の
各行は同じ設定順で描画し、必須欄が空なら登録ボタンの理由を表示する。修正前の OCR 値は
標準項目と追加項目の両方で併記する。

### 空用紙からの設定提案

Field #1257 の `POST /v1/erp/membership/reception-fields/analysis` を、CourseBoard の
`POST /v1/course/customer-reception-fields/analysis` から同じ bearer で呼ぶ。返された標準項目の
うち、CourseBoard の既存標準キーへ対応できるものだけを現在の設定案へ反映する。

Field の会員申込書分析は申込者氏名と同意欄を意図的に対象外にしているため、氏名の固定必須と
ゴルフ固有の同意定義は変更しない。`consumer` の custom field 提案は Field の registry へ保存せず、
CourseBoard が所有するゴルフ固有項目の未保存案として取り込む。`customer_subject` など CourseBoard に
保存先のない提案は黙って採用せず warning として表示する。分析結果は自動保存せず、設定画面の
未保存状態へ適用し、係が原本を確認・修正してから既存 PUT API で全量保存する。この操作も
受付作業画面ではなく `settings/reception-fields` で行う。

## 失敗と整合性

- 設定変更前から開いている画面を信用せず、登録時にサーバで再検証する。
- OCR 実行中に設定が変わった場合、登録時点の設定を正とする。
- 追加項目を削除しても過去回答は物理削除しない。画面からは非表示にし、監査可能性を残す。
- 顧客作成前にすべての追加項目を検証する。作成後に起こりうるのは DB 書込障害だけに絞る。
- 追加項目の DB 書込障害は、作成済み customer id と画面に残した回答から追加項目だけ再試行する。

## 同意項目カタログ追随の設計入口

tachyonfield #1271 の `consentItems` を CourseBoard へ接続する境界は
[ADR-0014](../../../../architecture/decisions/ADR-0014-reception-consent-catalog-boundary.md) を正とする。
Field は同意キー、表示名、本文、必須性、規約版、有効状態、並び順と証跡を所有する。
CourseBoard は同意定義を永続化せず、Field の active なカタログを OCR、確認画面、
必須判定、顧客登録へ接続する。

### API

courseboard-api に次を追加する。UI は `/field-api/*` や Tachyon platform API を直接呼ばない。

- `GET /v1/course/customer-consent-items?includeInactive=true`
  - Field `GET /v1/erp/membership/consent-items` を同じ bearer / operator / platform scope で呼ぶ。
  - `items` は `id / consentKey / label / body / required / termsVersion / active / sortOrder`。
  - 設定画面は inactive を含めて重複キーを判定する。OCR と顧客登録は active のみを読む。
- `POST /v1/course/customer-consent-items`
  - `body / consentKey / label / required / termsVersion / sortOrder` を受け、Field の既存 API へ渡す。
  - CourseBoard の設定変更 action と Field `field:ManageMembership` の両方を通った利用者だけが使える。
- `POST /v1/course/customer-reception-fields/analysis`
  - 既存レスポンスへ additive な `consentItems` を追加する。
  - 候補は `consentKey / label / body / required`。欠落時は空配列として旧 Field と互換にする。

Field の同意項目を表す domain type と list/create port を追加するが、CourseBoard repository は
追加しない。Field response の timestamp は Field の監査情報であり、CourseBoard の受付処理では
使わないため domain / public DTO へ持ち込まない。

### OCR と登録

`DraftCustomerReceptionUseCase` は受付項目と Field の active consent items を読み、両方を
`CustomerReceptionOcrGateway` に渡す。OCR schema は同意本文があれば本文、なければ表示名を
boolean column の prompt に使う。Field の `sortOrder`、同値なら `consentKey` の順に安定化する。

draft row は同意ごとに `key / label / required / accepted` を返す。読み取れなかった値は `null` の
ままにする。新しい候補はすべて「チェック＝同意」として扱う。既存の
`golf_marketing_contact` だけはキーで判定し、「チェック＝拒否」を Field の `accepted` 方向へ
一度だけ反転する。

`CreateReceptionCustomerUseCase` は Field を書く前に active catalog を再取得する。送信された
未知キー、inactive key、重複キーを拒否し、Field で `required=true` の項目が `accepted=true`
でなければ顧客を作らない。検証後の回答だけを Field の顧客登録 API へ渡す。ブラウザが分析時に
見た catalog ではなく、登録時点の Field catalog を正とする。

標準項目、CourseBoard 追加項目、active consent items の合計は OCR の20列以下でなければならない。
受付項目 PUT、同意候補 POST、受付 draft の3経路で同じ domain validator を使い、上限を超えた
設定を作る処理と、既に超えている設定での読み取りをどちらも拒否する。

### 設定画面と失敗時の再開

`ReceptionFieldsPage` は受付項目と inactive を含む Field consent items を読み込む。空用紙分析の
候補から既存 `consentKey` を除き、残りを原本と並べて表示する。候補は自動保存しない。

作成は1件ずつ行い、既存最大 `sortOrder + 1` から採番する。途中で失敗したら後続を開始せず、
作成済み候補を除いて未作成候補を残す。POST の response だけが失われた可能性があるため、
失敗時は inactive を含む一覧を再取得し、同じキーがあれば成功扱いにする。分析、受付項目保存、
候補作成、候補取消は相互ロックし、古い処理の完了で新しい候補を消さない。

### 認可と互換性

- CourseBoard route と usecase は設定変更 action を要求する。
- Field GET は `field:ListMembership`、POST は `field:ManageMembership` を利用者 bearer で要求する。
- 受付担当へ `field:ManageMembership` を追加しない。候補作成は manager / admin の設定操作である。
- `consentItems` は additive response で、旧 backend では frontend が空配列へ fallback する。
- 既存の固定3キーと過去の Field 証跡は変更しない。通常経路の定義、label、required、並び順は
  Field catalog へ移し、CourseBoard に残すのは既存 opt-out の極性互換だけとする。
- 新しい opt-out が必要になった場合は CourseBoard 設定を増やさず、Field に汎用 polarity capability を起票する。

### 検証

- Rust domain: key、label/body、required、active、安定順、20列上限、opt-out 反転。
- Rust gateway: Field camelCase、includeInactive、POST body、upstream 4xx/5xx、分析 `consentItems`。
- Rust usecase/HTTP: GET/POST、認可、unknown/inactive/duplicate、required、route classification、OpenAPI。
- frontend models/API: camelCase/snake_case fallback、欠落時空配列、GET/POST body。
- frontend component: 候補表示、既存除外、最大 sortOrder、部分失敗、POST response loss、相互ロック。
- mock UI: 空用紙分析から候補作成、再分析後の保持、active catalog が受付確認画面へ出ること。
- PR Preview: manager/admin で候補作成、受付担当で作成403、実 Field OCR と顧客同意証跡を確認する。

## 検証

- domain: 既定 merge、固定必須、型・選択肢・必須検証、OCR schema。
- repository: テナント分離、置換、追加項目回答の upsert。
- HTTP: GET/PUT、動的 draft、登録 DTO、認可ルート分類、OpenAPI。
- frontend: 設定編集、動的行、必須理由、payload、修正値表示、i18n 完全性。
- browser: 設定変更 → 異なる様式の画像/PDF読取 → 修正 → 登録 → Field 標準項目と
  CourseBoard 追加項目の保存を別々に確認する。
