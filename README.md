# tachyonfield-golf

TACHYON Field golf extension Cloud App. This service is an API-only extension
deployed independently to Tachyon Compute and called by TACHYON Field core.

## Architecture

- Independent Rust + axum REST API server.
- Deployed as a Tachyon Compute Cloud App via `tachyon.yaml`.
- TACHYON Field core calls `POST /calculate`; this app returns numeric tax
  results only.
- Storefront and user-facing UI remain in TACHYON Field core.
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
