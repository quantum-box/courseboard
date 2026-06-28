# Course Board

Course Board は、TACHYON Field のゴルフ場オペレーション向け Cloud App です。
Tachyon Compute に独立してデプロイし、ゴルフ場固有の Rust API と React UI を
このリポジトリで管理します。

リポジトリ名は `quantum-box/courseboard` です。既存の Cloud App ID、Auth
audience、Auth policy は、deployment / registry / auth policy の移行が完了する
までは互換性のため `tachyonfield-golf` 系の名前を残しています。

## アーキテクチャ

- Rust + axum の独立した REST API サーバです。
- React + Vite UI は `desktop/` 配下にあります。ブラウザで開ける UI として使います。
- `tachyon.yaml` を通じて Tachyon Compute Cloud App としてデプロイします。
- TACHYON Field core は `POST /calculate` を呼び、この app は税額計算結果だけを返します。
- キャンセル料徴収では Course Board が Field API に Field invoice を作成し、公開 payment URL を SMS で送ります。
- 税率、免除ルール、キャンセル料 collection は tenant scope で SQLite に保存します。
- Tachyon Auth M2M 認証は OAuth2 client credentials を前提にします。
  operator endpoint は Tachyon Auth / Auth Platform の OIDC discovery と JWKS で検証できる JWT access token を要求します。

`quantum-box/tachyonfield` の PR #80 は reference implementation です。この
repository は分離された Cloud App 実装です。

## キャンセル料徴収

まず移植する対象はキャンセル料徴収 flow です。

1. Operator が Course Board にキャンセル料 collection を作成します。
2. Course Board は operator の bearer token と tenant context を引き継いで TACHYON Field API に Field invoice を作成します。
3. Course Board は自分の公開 payment URL を SMS で送信します。
4. お客様は URL を開き、Course Board の画面に埋め込まれた Stripe Payment Element で支払います。
5. Stripe publishable key、PaymentIntent client secret、支払い状態は Field public invoice API から取得します。
6. Field invoice の status が `Paid` になったら、Course Board の collection も paid に同期します。

Course Board は Stripe secret key を持ちません。Stripe の支払い準備は Field invoice
側に集約し、Course Board は埋め込みフォームに必要な公開情報だけを受け取ります。

### `POST /cancellation-fee-collections`

operator endpoint は既存の bearer-token middleware で保護します。

```http
POST /cancellation-fee-collections
Authorization: Bearer <access-token>
Content-Type: application/json
```

Request:

```json
{
  "tenant_id": "scc",
  "reference": "RSV-1001",
  "customer_name": "山田 太郎",
  "customer_phone": "+819012345678",
  "amount": 5000,
  "currency": "JPY",
  "due_date": "2026-07-04",
  "reason": "当日キャンセル",
  "send_sms": true
}
```

Response には公開 payment URL と SMS status が含まれます。

```json
{
  "collection": {
    "id": "cfc_...",
    "tenant_id": "scc",
    "reference": "RSV-1001",
    "customer_name": "山田 太郎",
    "amount": 5000,
    "currency": "JPY",
    "due_date": "2026-07-04",
    "reason": "当日キャンセル",
    "payment_url": "https://courseboard.example/ui/index.html#/pay/...",
    "field_invoice_id": "inv_...",
    "status": "pending",
    "sms_status": "sent",
    "paid_at": null
  },
  "sms_message": "Course Boardより、キャンセル料5000円のお支払いをお願いします..."
}
```

`TACHYON_FIELD_API_URL` が未設定、または Field invoice 作成に失敗した場合、
Course Board は collection と壊れた支払いリンクを作成せず、`502 provider_error`
を返します。

### 公開 payment endpoint

SMS から開く公開 endpoint です。operator bearer token は要求しません。

- `GET /public/cancellation-fees/{token}`
- `POST /public/cancellation-fees/{token}/stripe-payment-intent`
- `POST /public/cancellation-fees/{token}/confirm`

`GET /public/cancellation-fees/{token}` は Field invoice の公開状態を読み、paid
であれば Course Board 側の collection も paid に同期します。

## 税額計算 API

### `POST /calculate`

必要な header:

```http
Authorization: Bearer <access-token>
Content-Type: application/json
```

Request:

```json
{
  "tenant_id": "scc",
  "prefecture": "hokkaido",
  "green_fee": 8000,
  "players": [{ "age": 42, "has_disability_cert": false }]
}
```

Response:

```json
{
  "course_grade": "A",
  "tax_amount": 400,
  "breakdown": [
    { "player_index": 0, "fee": 400, "exempt": false, "reason": null }
  ]
}
```

SCC/Hokkaido seed は green fee から course grade を解決します。

- `A`: 7,000 円以上、課税対象者 1 人あたり 400 円
- `B`: 5,000-6,999 円、課税対象者 1 人あたり 350 円
- `C`: 3,500-4,999 円、課税対象者 1 人あたり 300 円
- `D`: 3,500 円未満、課税対象者 1 人あたり 200 円

Hokkaido seed の免除条件:

- 18 歳未満
- 70 歳以上
- 障害者手帳の保持者

### `POST /simulate/range`

`/calculate` と同じ `Authorization` / `Content-Type` header が必要です。

Request:

```json
{
  "tenant_id": "scc",
  "prefecture": "hokkaido",
  "green_fee_range": { "min": 3500, "max": 12000, "step": 500 },
  "base_visitors": 60,
  "base_green_fee": 8000,
  "price_elasticity": -1.2,
  "taxable_ratio": 0.85,
  "fixed_cost": 300000,
  "variable_cost_per_visitor": 1500
}
```

Response:

```json
{
  "rows": [
    {
      "green_fee": 3500,
      "course_grade": "C",
      "visitors": 162,
      "taxable_visitors": 138,
      "revenue": 567000,
      "tax_total": 41400,
      "variable_cost": 243000,
      "fixed_cost": 300000,
      "profit": -17400,
      "profit_margin_pct": -3.068783068783069
    }
  ]
}
```

## Admin UI

`GET /admin` は `GET /admin/caddies` に redirect します。admin UI は保護された
POST API と同じ bearer-token middleware を使うため、内部 admin gateway 経由、
または `Authorization: Bearer <access-token>` header 付きでアクセスします。

UI 上は staff を caddie と表示しますが、integration boundary は generic な
TACHYON Field ERP endpoint だけを使います。

- `GET/POST /v1/erp/staff-profiles`
- `PATCH /v1/erp/staff-profiles/:id`
- `GET /v1/erp/staff-availability`
- `GET/POST /v1/erp/staff-assignments`
- `PATCH /v1/erp/staff-assignments/:id`
- `POST /v1/erp/reservations/:id/staff-assignment`
- `POST /v1/erp/reservations/:id/staff-assignment/unassign`

Profile create/edit は caddie language を generic `staff_profile` data に map し、
linked `staff_member_id` を表示します。Active / inactive profile は別々に count
して表示します。Shift calendar は generic `staff_assignment` row を表示し、
作成・編集・cancel を行います。現時点の Field API contract は hard DELETE を
公開していないため、cancel は `status=cancelled` の PATCH として扱います。
Availability は `staff-availability` から read します。

`GET /admin/dispatch` は daily caddie dispatch board です。operator が tenant と
date を入力すると、Course Board は generic staff availability と staff
assignment row から caddie の day status を導出し、tee-time reservation
assignment と並べて scheduled / checked-in / waiting / assigned / absent /
cancelled state を表示します。この board は dispatch operation に scoped し、
HR、payroll、time-clock behavior は実装しません。

`GET /admin/reservations` は reservation dispatch workflow です。operator が tenant、
reservation ID、date、time window を入力すると、Course Board は generic staff
profile、availability、assignment data を読み、caddie recommendation を返します。
Assign / unassign は generic reservation staff-assignment API を呼びます。

Smart assign は deterministic な rule-based scoring です。active caddie、tee time
を覆う shift、overlap の有無、course knowledge、member rating、rookie/senior
metadata を評価します。同点は shift start、caddie code、staff profile ID の順に
sort し、同じ input なら同じ recommendation になります。

Demo seed と headless E2E coverage は `src/demo_seed.rs` にあります。詳細は
[docs/golf-mvp-demo.md](docs/golf-mvp-demo.md) を参照してください。

現在の generic Field API contract で daily board の read model は表示できます。
check-in、waiting、absence、cancellation transition を書き込みたい場合は、
golf-specific core code ではなく generic daily staff status update contract として
TACHYON Field 側に追加します。

## 環境変数

### Tachyon Auth M2M

```bash
TACHYON_AUTH_ISSUER_URL=https://app.n1.tachy.one
EXPECTED_AUDIENCE=tachyonfield-golf
EXPECTED_CLIENT_ID=tachyonfield-core
```

`OIDC_ISSUER_URL` は `TACHYON_AUTH_ISSUER_URL` の alias として利用できます。
`EXPECTED_CLIENT_ID` は optional で、comma-separated list も指定できます。client
secret や token endpoint credential などの secret は deployment secret として
渡し、commit してはいけません。

TACHYON Field core からの OAuth2 client credentials 呼び出し手順は
[docs/m2m-auth.md](docs/m2m-auth.md) を参照してください。

### Field API と SMS

Field invoice を作成するには `TACHYON_FIELD_API_URL` が必要です。ローカルや
sandbox の Field API に向ける場合もこの値を明示してください。未設定の場合、
Course Board はキャンセル料 collection と支払いリンクを作成しません。

```bash
COURSEBOARD_PUBLIC_UI_BASE_URL=https://courseboard.example/ui/index.html
COURSEBOARD_SMS_SENDER_NAME="Course Board"
TACHYON_FIELD_API_URL=https://tachyon-field-api.example.internal
```

SMS provider secret がない場合、SMS 送信は `skipped` として記録されます。

```bash
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_MESSAGING_SERVICE_SID=MG...
# or
TWILIO_FROM_NUMBER=+1...
```

provider secret は commit せず、Cloud App secret として設定してください。

Generic Field API admin client は deployment secrets または environment variables で
設定します。

```bash
TACHYON_FIELD_API_URL=https://field-api.example.internal/
TACHYON_FIELD_API_BEARER_TOKEN=<field-api-access-token>
```

`TACHYON_FIELD_API_BEARER_TOKEN` は現在の static bearer token provider 用の placeholder
contract です。Tachyon Auth client-credentials acquisition を追加する場合は、UI
handler を変えず provider 実装だけを差し替えます。

## Auth Policy Manifest

Extension-owned Tachyon Auth actions and policies はこの repository で管理します。

- `.tachyon/manifests/tachyonfield-golf-auth.yml`
- action: `field_extension_golf:CalculateTax`
- policy: `field-extension:golf:calculator`

`POST /calculate` を呼べる TACHYON Field core M2M client に
`field-extension:golf:calculator` を attach します。

## Local Development

サービスを起動します。

```bash
cargo run
```

ローカル開発で reachable な Tachyon Auth issuer がない場合は、dev-only static bearer
verifier を使えます。

```bash
COURSEBOARD_DEV_BEARER_TOKEN=local-dev-token \
DATABASE_URL=sqlite:///tmp/courseboard-local.db \
COURSEBOARD_PUBLIC_UI_BASE_URL=http://127.0.0.1:8080/ui/index.html \
cargo run
```

この bypass は `COURSEBOARD_DEV_BEARER_TOKEN` を明示した場合だけ有効です。
production では OIDC configuration を使います。

デフォルト DB は `sqlite://tachyonfield-golf.db` です。必要に応じて
`DATABASE_URL` を上書きします。

```bash
TACHYON_AUTH_ISSUER_URL=https://app.n1.tachy.one \
EXPECTED_AUDIENCE=tachyonfield-golf \
EXPECTED_CLIENT_ID=tachyonfield-core \
TACHYON_FIELD_API_URL=https://field-api.example.internal/ \
TACHYON_FIELD_API_BEARER_TOKEN='<field-api-access-token>' \
DATABASE_URL=sqlite://data/tachyonfield-golf.db \
cargo run
```

税額計算 API の例:

```bash
curl -sS http://localhost:8080/calculate \
  -H 'Authorization: Bearer <valid-local-or-dev-access-token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "tenant_id": "scc",
    "prefecture": "hokkaido",
    "green_fee": 8000,
    "players": [{ "age": 42, "has_disability_cert": false }]
  }'
```

React UI をブラウザで起動します。

```bash
cd desktop
npm install
VITE_COURSEBOARD_API_BASE_URL=http://localhost:8080 npm run dev
```

デフォルト UI route はキャンセル料 SMS payment link 作成画面です。公開 SMS payment
page は `/#/pay/{token}` です。legacy course-map prototype は `/#/course-map` に
残しています。

Rust server の static `/ui` hosting を確認する場合:

```bash
cd desktop
VITE_BASE_PATH=/ui/ npm run build
rm -rf ../ui
cp -R dist ../ui
```

## Checks

```bash
cargo fmt
cargo test
cargo clippy --all-targets --all-features -- -D warnings
git diff --check
```
