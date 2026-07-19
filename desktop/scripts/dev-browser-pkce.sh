#!/usr/bin/env bash
# Local browser-pkce + prod Field: course-api (:8080) + Vite (:5173).
# Preferred interactive flow (password login). See also dev-prod-field.sh for CLI JWT.
# Run in a dedicated interactive terminal you control — not an agent shell.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MODE="${1:-both}" # api | vite | both
RESTART="${RESTART:-0}"

if [[ ! -f "$ROOT/.env.browser-pkce" ]]; then
  echo "Missing $ROOT/.env.browser-pkce — run: mise run courseboard:pkce-env" >&2
  echo "  (or: cd desktop && npm run pkce:env)" >&2
  exit 1
fi

if [[ ! -f "$ROOT/desktop/.env.local" ]]; then
  echo "Missing $ROOT/desktop/.env.local — run: mise run courseboard:pkce-env" >&2
  exit 1
fi

if [[ "$RESTART" == "1" ]]; then
  pkill -f 'target/debug/courseboard' 2>/dev/null || true
  pkill -f 'vite --host 127.0.0.1 --port 5173' 2>/dev/null || true
  sleep 1
fi

DEFAULT_FIELD_API_URL="${DEFAULT_FIELD_API_URL:-https://tachyon-field-api.txcloud.app}"

require_field_api_url() {
  if [[ -z "${TACHYON_FIELD_API_URL:-}" ]]; then
    export TACHYON_FIELD_API_URL="$DEFAULT_FIELD_API_URL"
    echo "TACHYON_FIELD_API_URL unset — defaulting to $TACHYON_FIELD_API_URL"
  fi
  case "${TACHYON_FIELD_API_URL}" in
    empty://*)
      echo "Refusing empty:// Field URL for local API start." >&2
      echo "Local course-api must connect to Field. Unset empty:// or set:" >&2
      echo "  TACHYON_FIELD_API_URL=$DEFAULT_FIELD_API_URL" >&2
      exit 1
      ;;
  esac
}

load_api_env() {
  export COURSEBOARD_LOCAL_ENV_FILE="$ROOT/.env.browser-pkce"
  export COURSEBOARD_CLEAR_DEV_BEARER=1
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env.browser-pkce"
  set +a
  # Force OIDC: dotenvy loads repo-root .env but will not override this empty value.
  export COURSEBOARD_DEV_BEARER_TOKEN=
  require_field_api_url
}

start_api() {
  load_api_env
  cd "$ROOT"
  echo "Static COURSEBOARD_DEV_BEARER_TOKEN is cleared for this process."
  if [[ "${COURSEBOARD_API_ONCE:-0}" == "1" ]]; then
    echo "Starting courseboard on :8080 once (no watch; browser-pkce OIDC, Field: ${TACHYON_FIELD_API_URL})"
    exec bash "$ROOT/desktop/scripts/run-courseboard-with-env.sh"
  fi
  echo "Starting courseboard on :8080 with bacon hot-reload (job: api; browser-pkce OIDC, Field: ${TACHYON_FIELD_API_URL})"
  echo "Rust save or .env.browser-pkce change → rebuild + restart."
  echo "Field uses the UI login bearer. Session expired? Sign out and sign in again at http://127.0.0.1:5173"
  exec bacon api
}

start_vite() {
  cd "$ROOT/desktop"
  unset VITE_AUTH_PROXY_TARGET || true
  # desktop/.env.local from pkce:env sets browser-pkce + proxy to :8080.
  echo "Starting Vite on http://127.0.0.1:5173/ (reads desktop/.env.local)"
  exec npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
}

case "$MODE" in
  api) start_api ;;
  vite) start_vite ;;
  both)
    echo "Tip: for longevity use two terminals:"
    echo "  mise run courseboard:api"
    echo "  mise run courseboard:vite"
    echo "Starting both in this shell (Ctrl-C stops both)."
    load_api_env
    # Headless bacon: watch/rebuild API without the interactive TUI (Vite shares this terminal).
    # COURSEBOARD_LOCAL_ENV_FILE is inherited so each restart re-sources .env.browser-pkce.
    (cd "$ROOT" && bacon --headless api) &    api_pid=$!
    sleep 2
    (
      cd "$ROOT/desktop"
      unset VITE_AUTH_PROXY_TARGET || true
      npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
    ) &
    vite_pid=$!
    trap 'kill $api_pid $vite_pid 2>/dev/null || true' INT TERM
    wait
    ;;
  *)
    echo "Usage: $0 [api|vite|both]" >&2
    echo "Optional: RESTART=1 $0 both   # pkill previous listeners first" >&2
    echo "Optional: COURSEBOARD_API_ONCE=1 $0 api   # cargo run without bacon watch" >&2
    exit 2
    ;;
esac
