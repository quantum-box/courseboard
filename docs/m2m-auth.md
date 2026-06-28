# Tachyon Auth M2M 認証

Course Board の operator API は、Tachyon Auth / Auth Platform の OAuth2 client
credentials で発行された access token を受け取ります。

既存の Cloud App ID と Auth audience は、registry、deployment、auth policy の
rename が完了するまでは `tachyonfield-golf` を使います。repository は
`quantum-box/courseboard` です。

公開 payment endpoint の `/public/cancellation-fees/{token}` 以下は SMS から開く
お客様向け endpoint なので、operator bearer token は要求しません。

## Runtime Configuration

deployment config または secret で次の値を設定します。

```bash
TACHYON_AUTH_ISSUER_URL=https://app.n1.tachy.one
EXPECTED_AUDIENCE=tachyonfield-golf
EXPECTED_CLIENT_ID=tachyonfield-core
```

`OIDC_ISSUER_URL` は `TACHYON_AUTH_ISSUER_URL` の alias として使えます。
`EXPECTED_CLIENT_ID` は optional です。設定した場合、JWT の `client_id`、`azp`、
または `sub` claim が comma-separated list のいずれかに一致する必要があります。

client secret は commit しません。TACHYON Field core の client id、client secret、
requested audience、scope は deployment secrets または platform secret store で
管理します。

## Verification Flow

Course Board は起動時に次の順で token verifier を構成します。

1. `TACHYON_AUTH_ISSUER_URL` または `OIDC_ISSUER_URL` を読む。
2. `/.well-known/openid-configuration` を取得する。
3. discovery document の issuer が設定値と一致することを確認する。
4. discovery document の `jwks_uri` を取得する。
5. JWKS を memory に cache し、JWT verification に使う。

`POST /calculate` や `POST /cancellation-fee-collections` などの operator API には
次の header が必要です。

```http
Authorization: Bearer <access-token>
```

token がない、または無効な request は拒否します。validation は fail-closed で、
JWT signature、`iss`、`aud`、`exp`、`nbf`、`iat`、optional authorized client id
を検証します。

## TACHYON Field Core からの呼び出し

TACHYON Field core は次の流れで Course Board を呼びます。

1. Tachyon Auth token endpoint、client id、client secret、audience、scope を deployment config または secrets から読む。
2. OAuth2 client credentials で access token を取得する。
3. `Authorization: Bearer <access-token>` 付きで Course Board operator API を呼ぶ。
4. token expiry 前に refresh するか、必要に応じて新しい token を取得する。

placeholder 値だけを使った例です。

```bash
TOKEN="$(
  curl -sS "$TACHYON_AUTH_TOKEN_ENDPOINT" \
    -u "$TACHYON_FIELD_CLIENT_ID:$TACHYON_FIELD_CLIENT_SECRET" \
    -d grant_type=client_credentials \
    -d audience=tachyonfield-golf \
    -d scope='tachyonfield-golf:calculate' |
  jq -r .access_token
)"

curl -sS "$COURSEBOARD_URL/calculate" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "tenant_id": "scc",
    "prefecture": "hokkaido",
    "green_fee": 8000,
    "players": [{ "age": 42, "has_disability_cert": false }]
  }'
```

Tachyon Auth issuer path、token endpoint、scope、audience は環境ごとに異なります。
deployment config がより具体的な issuer URL を持つ場合はその値を使います。
