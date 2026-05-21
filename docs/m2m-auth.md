# Tachyon Auth M2M Authentication

`tachyonfield-golf` is an API-only Cloud App. TACHYON Field core calls
`POST /calculate` with an OAuth2 client credentials access token from Tachyon
Auth / Auth Platform.

## Runtime Configuration

Configure these values through deployment config or secrets:

```bash
TACHYON_AUTH_ISSUER_URL=https://app.n1.tachy.one
EXPECTED_AUDIENCE=tachyonfield-golf
EXPECTED_CLIENT_ID=tachyonfield-core
```

`OIDC_ISSUER_URL` is also accepted as an alias for
`TACHYON_AUTH_ISSUER_URL`. `EXPECTED_CLIENT_ID` is optional; when set, the JWT
`client_id`, `azp`, or `sub` claim must match one of the comma-separated values.

Do not commit client secrets. The client id, client secret, requested audience,
and scopes for TACHYON Field core must be managed through deployment secrets or
the platform secret store.

## Verification Flow

On startup the Cloud App:

1. Reads `TACHYON_AUTH_ISSUER_URL` or `OIDC_ISSUER_URL`.
2. Fetches `/.well-known/openid-configuration`.
3. Verifies that the discovery document issuer matches the configured issuer.
4. Fetches the `jwks_uri` from the discovery document.
5. Caches the JWKS in memory for JWT verification.

Each `POST /calculate` request must include:

```http
Authorization: Bearer <access-token>
```

The Cloud App rejects requests without a valid token. Validation is fail-closed
and checks the JWT signature, `iss`, `aud`, `exp`, `nbf`, `iat`, and optional
authorized client id.

## TACHYON Field Core Call Sequence

TACHYON Field core should:

1. Read its Tachyon Auth token endpoint, client id, client secret, audience, and
   scope from deployment config or secrets.
2. Request an access token with OAuth2 client credentials.
3. Call `tachyonfield-golf` with `Authorization: Bearer <access-token>`.
4. Refresh the token before expiry or request a new token when needed.

Example shape with placeholder values only:

```bash
TOKEN="$(
  curl -sS "$TACHYON_AUTH_TOKEN_ENDPOINT" \
    -u "$TACHYON_FIELD_CLIENT_ID:$TACHYON_FIELD_CLIENT_SECRET" \
    -d grant_type=client_credentials \
    -d audience=tachyonfield-golf \
    -d scope='tachyonfield-golf:calculate' |
  jq -r .access_token
)"

curl -sS "$TACHYONFIELD_GOLF_URL/calculate" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "tenant_id": "scc",
    "prefecture": "hokkaido",
    "course_grade": "A",
    "players": [{ "age": 42, "has_disability_cert": false }]
  }'
```

The exact Tachyon Auth issuer path, token endpoint, scope, and audience are
environment-specific. Use `https://app.n1.tachy.one` as the Auth Platform
reference issuer unless deployment config specifies a more precise issuer URL.
