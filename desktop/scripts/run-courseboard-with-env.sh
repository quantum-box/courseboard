#!/usr/bin/env bash
# Re-source local env on every bacon/cargo restart so refreshed Field bearers apply.
# Start scripts set COURSEBOARD_LOCAL_ENV_FILE (.env.browser-pkce or .env.prod-field).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${COURSEBOARD_LOCAL_ENV_FILE:-$ROOT/.env.browser-pkce}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  echo "Run: mise run courseboard:pkce-env   # or courseboard:field-env" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090,SC1091
source "$ENV_FILE"
set +a

# browser-pkce: force OIDC inbound (dotenvy must not keep a static verifier).
if [[ "${COURSEBOARD_CLEAR_DEV_BEARER:-0}" == "1" ]]; then
  export COURSEBOARD_DEV_BEARER_TOKEN=
fi

DEFAULT_FIELD_API_URL="${DEFAULT_FIELD_API_URL:-https://tachyon-field-api.txcloud.app}"
if [[ -z "${TACHYON_FIELD_API_URL:-}" ]]; then
  export TACHYON_FIELD_API_URL="$DEFAULT_FIELD_API_URL"
fi
case "${TACHYON_FIELD_API_URL}" in
  empty://*)
    echo "Refusing empty:// Field URL for local API start." >&2
    exit 1
    ;;
esac

cd "$ROOT"
cargo run --bin courseboard-migrate
exec cargo run --bin courseboard "$@"
