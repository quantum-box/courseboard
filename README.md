# tachyonfield-golf

TACHYON Field golf extension Cloud App. This service is deployed independently
to Tachyon Compute and called by TACHYON Field core for golf-specific workflows.
It exposes protected tax calculation APIs plus an operational admin UI for golf
caddie profile and shift management.

## Architecture

- Independent Rust + axum REST API server with minimal server-rendered HTML for
  the golf admin UI.
- Deployed as a Tachyon Compute Cloud App via `tachyon.yaml`.
- TACHYON Field core calls `POST /calculate`; this app returns numeric tax
  results only.
- Storefront and user-facing UI remain in TACHYON Field core. Golf-specific
  caddie administration lives in this Cloud App and consumes generic
  tachyonfield APIs.
- Tax rates and exemption rules are tenant-scoped and backed by SQLite in this
  skeleton. Startup runs deterministic migrations and seeds SCC/Hokkaido data.
- Tachyon Auth M2M authentication is expected through OAuth2 client credentials.
  `POST /calculate` requires a valid JWT access token verified through OIDC
  discovery and JWKS from Tachyon Auth / Auth Platform.

PR #80 in `quantum-box/tachyonfield` is a reference implementation only. This
repository is the separate Cloud App implementation.

## API

### `POST /calculate`

Requires:

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

The SCC/Hokkaido seed resolves course grade from green fee:

- `A`: 7,000 yen and above, 400 yen per taxable visitor
- `B`: 5,000-6,999 yen, 350 yen per taxable visitor
- `C`: 3,500-4,999 yen, 300 yen per taxable visitor
- `D`: under 3,500 yen, 200 yen per taxable visitor

Hokkaido exemptions in the seed are:

- Age under 18
- Age 70 or older
- Disability certificate holder

### `POST /simulate/range`

Requires the same `Authorization` and `Content-Type` headers as `/calculate`.

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

`GET /admin` redirects to `GET /admin/caddies`. The admin UI is protected with
the same bearer-token middleware as the protected POST APIs, so it should be
accessed through an internal admin gateway or with an `Authorization: Bearer
<access-token>` header.

The UI labels staff as caddies, but the integration boundary uses only generic
tachyonfield ERP endpoints:

- `GET/POST /v1/erp/staff-profiles`
- `PATCH /v1/erp/staff-profiles/:id`
- `GET /v1/erp/staff-availability`
- `GET/POST /v1/erp/staff-assignments`
- `PATCH /v1/erp/staff-assignments/:id`
- `POST /v1/erp/reservations/:id/staff-assignment`
- `POST /v1/erp/reservations/:id/staff-assignment/unassign`

Profile create/edit maps caddie language to generic `staff_profile` data and
shows the linked `staff_member_id`. Active and inactive profiles are counted and
rendered distinctly. The shift calendar lists generic `staff_assignment` rows,
creates/edits them, and cancels by PATCHing `status=cancelled`; the field API
does not expose hard DELETE in the current contract. Availability is read from
`staff-availability`.

`GET /admin/reservations` provides the reservation dispatch workflow. Operators
enter a tenant, reservation ID, date, and time window; the Cloud App recommends
caddies by reading generic staff profile, availability, and assignment data.
Assign and unassign actions call the generic reservation staff-assignment API,
keeping golf-specific recommendation logic in this extension.

Smart assign is deterministic and rule-based. It scores active caddies, shift
coverage for the requested tee time, lack of overlapping assignments, optional
course knowledge matches, optional customer/member ratings of 4 or higher, and
rookie/senior metadata when present. Recommendation reasons are rendered in the
UI, and ties are sorted by shift start, caddie code, then staff profile ID so
the same inputs always produce the same order.

Demo seed and headless E2E coverage live in `src/demo_seed.rs`. The seed models
a small golf course tenant with caddies, shifts, reservations, an existing busy
assignment, and past member rating metadata. The regression test proves the
profile → shift → recommendation → reservation assignment flow and verifies that
an overlapping second reservation marks the already assigned caddie as busy. See
[docs/golf-mvp-demo.md](docs/golf-mvp-demo.md) for the trace evidence and local
runner.

Configure the generic field API client with deployment secrets or environment
variables:

```bash
TACHYON_FIELD_API_URL=https://field-api.example.internal/
TACHYON_FIELD_API_BEARER_TOKEN=<field-api-access-token>
```

`TACHYON_FIELD_API_BEARER_TOKEN` is a placeholder contract for the current
static bearer token provider. If Tachyon Auth client-credentials acquisition is
added later, it should replace that provider without changing the UI handlers.
Never commit real tokens, client secrets, expanded env files, or bearer values.

## Tachyon Auth M2M

Set the OIDC issuer and expected token claims through environment variables:

```bash
TACHYON_AUTH_ISSUER_URL=https://app.n1.tachy.one
EXPECTED_AUDIENCE=tachyonfield-golf
EXPECTED_CLIENT_ID=tachyonfield-core
```

`OIDC_ISSUER_URL` is accepted as an alias for `TACHYON_AUTH_ISSUER_URL`.
`EXPECTED_CLIENT_ID` is optional and may be a comma-separated list. Secret values
such as client secrets and token endpoint credentials must be provided through
deployment secrets and must not be committed.

See [docs/m2m-auth.md](docs/m2m-auth.md) for the TACHYON Field core OAuth2
client credentials call sequence.

## Local Development

Run the service:

```bash
cargo run
```

The default database is `sqlite://tachyonfield-golf.db`. Override with
`DATABASE_URL` if needed:

```bash
TACHYON_AUTH_ISSUER_URL=https://app.n1.tachy.one \
EXPECTED_AUDIENCE=tachyonfield-golf \
EXPECTED_CLIENT_ID=tachyonfield-core \
TACHYON_FIELD_API_URL=https://field-api.example.internal/ \
TACHYON_FIELD_API_BEARER_TOKEN='<field-api-access-token>' \
DATABASE_URL=sqlite://data/tachyonfield-golf.db \
cargo run
```

Example request:

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

Run checks:

```bash
cargo fmt
cargo test
cargo clippy --all-targets --all-features -- -D warnings
git diff --check
```
