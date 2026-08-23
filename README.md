# Course Board

Course Board は、TACHYON Field のゴルフ場オペレーション向け Cloud App です。
Tachyon Compute に独立してデプロイし、ゴルフ場固有の Rust API と React UI を
このリポジトリで管理します。

リポジトリ名、Rust package、ローカル実行 binary は `courseboard` です。既存の
Cloud App ID、Auth audience、Auth policy は、deployment / registry / auth policy
の移行が完了するまでは互換性のため `tachyonfield-golf` 系の名前を残しています。

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
  "bill_to": {
    "kind": "customer",
    "customerId": "cus_..."
  },
  "customer_name": "山田 太郎",
  "customer_phone": "+819012345678",
  "amount": 5000,
  "currency": "JPY",
  "due_date": "2026-07-04",
  "reason": "当日キャンセル",
  "send_sms": true
}
```

`bill_to` は Field の型付き請求先です。個人は上記の `customer`、法人は
`{"kind":"client","clientId":"cl_...","affiliationId":"ccaf_..."}` を指定します。
Course Board はこの値を Field `POST /v1/invoices` の `billTo` として転送し、legacy `clientId` や
`courseboard:{reference}` の合成 ID は送りません。

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

Field invoice 作成に失敗した場合、または Field API token を取得できない場合、
Course Board は collection と壊れた支払いリンクを作成せず、`424 provider_error`
を返します（Cloudflare がオリジンの 5xx を CORS ヘッダの無いエラーページに
差し替えるため、上流起因の失敗は 4xx で返します）。

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

## Runtime Configuration

runtime 設定は `src/config.rs` の `RuntimeConfig` に集約しています。`clap` が
CLI flag と対応する environment variable を読み、各 module は `env::var` を直接
呼びません。たとえば `--database-url` と `DATABASE_URL` は同じ設定です。

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

Field API は default で production の `https://tachyon-field-api.txcloud.app` に
接続します。ローカルや sandbox の Field API に向ける場合は
`TACHYON_FIELD_API_URL` で上書きしてください。Field invoice 作成に失敗した場合、
Course Board はキャンセル料 collection と支払いリンクを作成しません。

```bash
--public-ui-base-url=https://courseboard.example/ui/index.html
--sms-sender-name="Course Board"
--tachyon-field-api-url=https://tachyon-field-api.txcloud.app
```

対応する environment variable:

```bash
COURSEBOARD_PUBLIC_UI_BASE_URL=https://courseboard.example/ui/index.html
COURSEBOARD_SMS_SENDER_NAME="Course Board"
TACHYON_FIELD_API_URL=https://tachyon-field-api.txcloud.app
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
--tachyon-field-api-url=https://tachyon-field-api.txcloud.app
--field-api-bearer-token=<field-api-access-token>
```

対応する environment variable:

```bash
TACHYON_FIELD_API_URL=https://tachyon-field-api.txcloud.app
TACHYON_FIELD_API_BEARER_TOKEN=<field-api-access-token>
```

`TACHYON_FIELD_API_BEARER_TOKEN` は任意の static bearer override（admin UI / service
account）用です。通常の browser-pkce では不要で、ログイン中の inbound bearer が
Field へ転送されます。

Course Board 自身が Tachyon Auth に OAuth2 client-credentials でログインしてトークンを
取得することもできます。次の env がすべて揃っていると、static token の代わりに
client-credentials provider が選択され、取得したトークンは失効直前までキャッシュされます。

```bash
TACHYON_FIELD_API_URL=https://field-api.example.internal/
TACHYON_FIELD_API_TOKEN_URL=https://app.n1.tachy.one/oauth2/token
TACHYON_FIELD_API_CLIENT_ID=<client-id>
TACHYON_FIELD_API_CLIENT_SECRET=<client-secret>
# optional
TACHYON_FIELD_API_SCOPE=<scope>
TACHYON_FIELD_API_AUDIENCE=<audience>
```

`TACHYON_FIELD_API_TOKEN_URL` / `TACHYON_FIELD_API_CLIENT_ID` /
`TACHYON_FIELD_API_CLIENT_SECRET` が未設定なら従来通り `TACHYON_FIELD_API_BEARER_TOKEN`
の static token に fallback します。client secret は commit せず deployment secret として
渡します。ERP エンドポイントを呼ぶには、この client の principal に対象 tenant の ERP
ポリシーが attach されている必要があります。

## Auth Policy Manifest

Extension-owned Tachyon Auth actions and policies はこの repository で管理します。

- `.tachyon/manifests/tachyonfield-golf-auth.yml`
- action: `field_extension_golf:CalculateTax`
- policy: `field-extension:golf:calculator`

`POST /calculate` を呼べる TACHYON Field core M2M client に
`field-extension:golf:calculator` を attach します。

TACHYON Field 本体の汎用 auth manifest（`field:*` / `accounting:*` などの action と
`field:admin` などの global policy）は tachyonfield repository が単独で所有します。
この repository に copy を置かないでください。`tachyon reconcile` と
`tachyon manifest apply` は `-f` 省略時に `.tachyon/manifests` 配下を全て discovery して
apply 対象にするため、古い copy が残っていると global な action と policy を過去の定義へ
巻き戻します。Field 側の権限を確認したいときは
`quantum-box/tachyonfield` の `.tachyon/manifests/tachyonfield-auth.yml` を直接参照します。

### Feature flags

判断の記録は [ADR-0012](docs/src/architecture/decisions/ADR-0012-feature-flags-on-the-platform-tenant.md) にあります。

フラグは host / platform テナントに置いたものだけが評価されます。利用者テナント
（Operator）に置いたものは tachyon-apps 側が読み込んだうえで捨てるため、置き場は
その上の platform になります。本番 platform は CourseBoard 専用ではなく他社の
Operator も配下にいるので、出し先を絞るときは管理画面
（`/v1beta/{tenant_id}/feature-flags`）で TenantTargeting を設定します。

| 用途 | platform テナント |
| -- | -- |
| 本番 | `tn_01hjjn348rn3t49zz6hvmfq67p` |
| サンドボックス | `tn_01hjryxysgey07h5jz5wagqj0m` |

**フラグの実体は管理画面で作ります。この repository の manifest では作れません。**
`kind: FeatureFlags` の manifest は、apply する request の scope と `tenantId` の
一致を要求します。CourseBoard の manifest は Operator scope で apply されるため、
platform を指す宣言は forbidden になります。かといって Operator に置くと今度は
評価されません。**app が自分の manifest から評価に乗るフラグを宣言する経路は、
現時点で存在しません**（PLT-3418、platform 側の contract 判断待ち）。

キーの接頭辞は必ず `feature.courseboard.` にします（CourseBoard API がそれ以外を
拒否します）。新規作成時は OFF なので、**画面をフラグで包むより先にフラグを作って
ON にしてください。** 順序を逆にすると、その画面はフラグが立つまで 404 になります。

## Local Development

サービスを起動します。

```bash
cargo run
```

ローカル開発で reachable な Tachyon Auth issuer がない場合は、dev-only static bearer
verifier を使えます。

```bash
cargo run -- \
  --dev-bearer-token=local-dev-token \
  --database-url=sqlite:///tmp/courseboard-local.db \
  --public-ui-base-url=http://127.0.0.1:8080/ui/index.html
```

この bypass は `COURSEBOARD_DEV_BEARER_TOKEN` を明示した場合だけ有効です。
production では OIDC configuration を使います。

毎回 inline で環境変数を渡す代わりに、リポジトリ root に `.env` を置けます。起動時に
`.env` が自動で読み込まれます（存在しなくてもエラーにはなりません）。`.env.example`
を `.env` にコピーして使ってください。`.env` は `.gitignore` 済みで、本番のシークレット
は従来通り deployment secret / 環境変数で注入します。

```bash
cp .env.example .env
# 必要に応じて .env を編集
cargo run
```

デフォルト DB は `sqlite://courseboard.db` です。必要に応じて
`DATABASE_URL` を上書きします。

```bash
cargo run -- \
  --tachyon-auth-issuer-url=https://app.n1.tachy.one \
  --expected-audience=tachyonfield-golf \
  --expected-client-id=tachyonfield-core \
  --tachyon-field-api-url=https://tachyon-field-api.txcloud.app \
  --field-api-bearer-token='<field-api-access-token>' \
  --database-url=sqlite://data/courseboard.db
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
