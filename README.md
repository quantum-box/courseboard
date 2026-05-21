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
  The current skeleton requires a `Bearer` token on `POST /calculate`; real token
  verification against Tachyon Auth is a follow-up.

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
  "course_grade": "A",
  "players": [{ "age": 42, "has_disability_cert": false }]
}
```

Response:

```json
{
  "tax_amount": 400,
  "breakdown": [
    { "player_index": 0, "fee": 400, "exempt": false, "reason": null }
  ]
}
```

The SCC/Hokkaido seed currently includes course grade `A` with a 400 yen fee.
Hokkaido exemptions in the seed are:

- Age under 18
- Age 70 or older
- Disability certificate holder

## Local Development

Run the service:

```bash
cargo run
```

The default database is `sqlite://tachyonfield-golf.db`. Override with
`DATABASE_URL` if needed:

```bash
DATABASE_URL=sqlite://data/tachyonfield-golf.db cargo run
```

Example request:

```bash
curl -sS http://localhost:8080/calculate \
  -H 'Authorization: Bearer local-dev-token' \
  -H 'Content-Type: application/json' \
  -d '{
    "tenant_id": "scc",
    "prefecture": "hokkaido",
    "course_grade": "A",
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
