#!/usr/bin/env bash
# Unified local launcher for CourseBoard desktop + course-api.
#
# Usage:
#   desktop/scripts/dev.sh <pkce|field|prod-api> [api|vite|both]
#
# Profiles:
#   pkce      Preferred: browser-pkce OIDC + prod Field (.env.browser-pkce)
#   field     CLI JWT shortcut (.env.prod-field)
#   prod-api  Vite only → production courseboard-api (.env.prod-api.local)
#             Overlay may be browser-pkce (React login) or development (CLI JWT)
#
# mise aliases keep the old task names (courseboard:api, courseboard:field-vite, …).
# Run in a dedicated interactive terminal — not an agent shell.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROFILE="${1:-}"
MODE="${2:-}"
RESTART="${RESTART:-0}"
DEFAULT_FIELD_API_URL="${DEFAULT_FIELD_API_URL:-https://tachyon-field-api.txcloud.app}"
DEFAULT_COURSE_API_URL="${DEFAULT_COURSE_API_URL:-https://courseboard-api.txcloud.app}"

usage() {
  echo "Usage: $0 <pkce|field|prod-api> [api|vite|both]" >&2
  echo "  pkce / field default mode: both" >&2
  echo "  prod-api only supports: vite (default)" >&2
  echo "Optional: RESTART=1 $0 pkce both   # pkill previous listeners first" >&2
  echo "Optional: COURSEBOARD_API_ONCE=1 $0 pkce api   # cargo run without bacon" >&2
}

if [[ -z "$PROFILE" ]]; then
  usage
  exit 2
fi

case "$PROFILE" in
  pkce|field|prod-api) ;;
  *)
    usage
    exit 2
    ;;
esac

if [[ "$PROFILE" == "prod-api" ]]; then
  MODE="${MODE:-vite}"
  if [[ "$MODE" != "vite" ]]; then
    echo "prod-api profile only supports vite (got '$MODE')" >&2
    exit 2
  fi
else
  MODE="${MODE:-both}"
fi

if [[ "$RESTART" == "1" ]]; then
  pkill -f 'target/debug/courseboard' 2>/dev/null || true
  pkill -f 'vite --host 127.0.0.1 --port 5173' 2>/dev/null || true
  sleep 1
fi

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

warn_if_api_port_busy() {
  local pids
  pids="$(lsof -nP -iTCP:8080 -sTCP:LISTEN -t 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    return 0
  fi
  echo "WARNING: TCP :8080 is already in use (PID(s): $pids)." >&2
  echo "  mise 'no exit status' usually means bacon/mise was SIGTERM/SIGINT'd (agent pkill, Ctrl-C, or shell teardown) — not a Rust panic." >&2
  echo "  Inspect: lsof -nP -iTCP:8080 -sTCP:LISTEN" >&2
  echo "  Prefer one interactive terminal for: mise run courseboard:api" >&2
  echo "  Do not start a second courseboard from an agent shell while bacon is watching." >&2
  ps -p $(echo "$pids" | tr '\n' ',') -o pid=,etime=,args= 2>/dev/null \
    | sed -E 's/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/<jwt>/g' >&2 || true
}

warn_if_vite_port_busy() {
  local pids
  pids="$(lsof -nP -iTCP:5173 -sTCP:LISTEN -t 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    return 0
  fi
  echo "WARNING: TCP :5173 is already in use (PID(s): $pids)." >&2
  echo "  Stop that Vite yourself, then re-run this task — agents will not kill it." >&2
  echo "  Inspect: lsof -nP -iTCP:5173 -sTCP:LISTEN" >&2
  ps -p "$(echo "$pids" | tr '\n' ',')" -o pid=,etime=,args= 2>/dev/null >&2 || true
}

load_pkce_env() {
  if [[ ! -f "$ROOT/.env.browser-pkce" ]]; then
    echo "Missing $ROOT/.env.browser-pkce — run: mise run courseboard:pkce-env" >&2
    echo "  (or: cd desktop && npm run pkce:env)" >&2
    exit 1
  fi
  if [[ ! -f "$ROOT/desktop/.env.local" ]]; then
    echo "Missing $ROOT/desktop/.env.local — run: mise run courseboard:pkce-env" >&2
    exit 1
  fi
  export COURSEBOARD_LOCAL_ENV_FILE="$ROOT/.env.browser-pkce"
  export COURSEBOARD_CLEAR_DEV_BEARER=1
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env.browser-pkce"
  set +a
  export COURSEBOARD_DEV_BEARER_TOKEN=
  require_field_api_url
}

load_field_env() {
  if [[ ! -f "$ROOT/.env.prod-field" ]]; then
    echo "Missing $ROOT/.env.prod-field — run: mise run courseboard:field-env" >&2
    echo "  (or: cd desktop && npm run field:env)" >&2
    exit 1
  fi
  export COURSEBOARD_LOCAL_ENV_FILE="$ROOT/.env.prod-field"
  export COURSEBOARD_CLEAR_DEV_BEARER=0
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env.prod-field"
  set +a
  require_field_api_url
}

start_api() {
  cd "$ROOT"
  warn_if_api_port_busy
  if [[ "$PROFILE" == "pkce" ]]; then
    echo "Static COURSEBOARD_DEV_BEARER_TOKEN is cleared for this process."
  fi
  if [[ "${COURSEBOARD_API_ONCE:-0}" == "1" ]]; then
    echo "Starting courseboard on :8080 once (no watch; Field: ${TACHYON_FIELD_API_URL})"
    exec bash "$ROOT/desktop/scripts/run-courseboard-with-env.sh"
  fi
  if [[ "$PROFILE" == "pkce" ]]; then
    echo "Starting courseboard on :8080 with bacon hot-reload (job: api; browser-pkce OIDC, Field: ${TACHYON_FIELD_API_URL})"
    echo "Rust save or .env.browser-pkce change → rebuild + restart."
    echo "Field uses the UI login bearer. Session expired? Sign out and sign in again at http://127.0.0.1:5173"
  else
    echo "Starting courseboard on :8080 with bacon hot-reload (job: api; Field: ${TACHYON_FIELD_API_URL})"
    echo "Rust save or .env.prod-field change → rebuild + restart (re-reads Field bearer)."
  fi
  if [[ "${COURSEBOARD_BACON_UI:-0}" == "1" ]]; then
    exec bacon api
  fi
  exec bacon --headless api
}

start_vite_pkce() {
  cd "$ROOT/desktop"
  unset VITE_AUTH_PROXY_TARGET || true
  unset VITE_COURSEBOARD_AUTH_MODE || true
  unset VITE_COURSEBOARD_API_BEARER || true
  echo "Starting Vite on http://127.0.0.1:5173/ (reads desktop/.env.local)"
  exec npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
}

start_vite_field() {
  cd "$ROOT/desktop"
  unset VITE_AUTH_PROXY_TARGET || true
  # Process env wins over .env files — clear leftover browser-pkce client id.
  export VITE_COURSEBOARD_BROWSER_CLIENT_ID=
  export VITE_COURSEBOARD_BROWSER_REDIRECT_URI=
  export VITE_COURSEBOARD_BROWSER_LOGIN_ENDPOINT=
  export VITE_COURSEBOARD_BROWSER_AUTHORIZATION_ENDPOINT=
  export VITE_COURSEBOARD_BROWSER_TOKEN_ENDPOINT=
  export VITE_COURSEBOARD_BROWSER_PROFILE_ENDPOINT=
  export VITE_COURSEBOARD_BROWSER_SCOPES=
  export VITE_COURSEBOARD_AUTH_MODE=development
  export VITE_COURSEBOARD_MOCK_DATA=false
  export VITE_COURSEBOARD_MODE=production
  export VITE_DEV_API_PROXY_TARGET=http://127.0.0.1:8080
  if [[ -n "${COURSEBOARD_DEV_BEARER_TOKEN:-}" ]]; then
    export VITE_COURSEBOARD_API_BEARER="$COURSEBOARD_DEV_BEARER_TOKEN"
  fi
  echo "Starting Vite on http://127.0.0.1:5173/"
  exec npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
}

start_vite_prod_api() {
  local overlay="$ROOT/desktop/.env.prod-api.local"
  local api_target
  local auth_mode
  if [[ ! -f "$overlay" ]]; then
    echo "Missing $overlay — run: mise run courseboard:prod-api-pkce-env" >&2
    echo "  (real user React login) or: mise run courseboard:prod-api-env (Local operator CLI JWT)" >&2
    exit 1
  fi
  api_target="$(rg -n '^VITE_COURSEBOARD_API_BASE_URL=' "$overlay" | head -1 | cut -d= -f2- || true)"
  if [[ -z "$api_target" ]]; then
    echo "WARNING: $overlay has no VITE_COURSEBOARD_API_BASE_URL" >&2
    echo "  Re-run: mise run courseboard:prod-api-pkce-env" >&2
    exit 1
  fi
  auth_mode="$(rg -n '^VITE_COURSEBOARD_AUTH_MODE=' "$overlay" | head -1 | cut -d= -f2- || true)"
  cd "$ROOT/desktop"
  unset VITE_AUTH_PROXY_TARGET || true
  unset VITE_DEV_API_PROXY_TARGET || true
  # Let overlay supply AUTH_MODE + tokens; do not leave process env blocking them.
  unset VITE_COURSEBOARD_AUTH_MODE || true
  unset VITE_COURSEBOARD_API_BEARER || true
  unset VITE_COURSEBOARD_API_BASE_URL || true
  if [[ "$auth_mode" == "browser-pkce" ]]; then
    # Overlay must win for JSON PKCE client keys — do not blank them.
    unset VITE_COURSEBOARD_BROWSER_CLIENT_ID || true
    unset VITE_COURSEBOARD_BROWSER_REDIRECT_URI || true
    unset VITE_COURSEBOARD_BROWSER_LOGIN_ENDPOINT || true
    unset VITE_COURSEBOARD_BROWSER_AUTHORIZATION_ENDPOINT || true
    unset VITE_COURSEBOARD_BROWSER_TOKEN_ENDPOINT || true
    unset VITE_COURSEBOARD_BROWSER_PROFILE_ENDPOINT || true
    unset VITE_COURSEBOARD_BROWSER_SCOPES || true
  else
    # Empty process env beats .env.local browser-pkce leftovers (Vite highest priority).
    export VITE_COURSEBOARD_BROWSER_CLIENT_ID=
    export VITE_COURSEBOARD_BROWSER_REDIRECT_URI=
    export VITE_COURSEBOARD_BROWSER_LOGIN_ENDPOINT=
    export VITE_COURSEBOARD_BROWSER_AUTHORIZATION_ENDPOINT=
    export VITE_COURSEBOARD_BROWSER_TOKEN_ENDPOINT=
    export VITE_COURSEBOARD_BROWSER_PROFILE_ENDPOINT=
    export VITE_COURSEBOARD_BROWSER_SCOPES=
  fi
  warn_if_vite_port_busy
  echo "Starting Vite on http://127.0.0.1:5173/ (--mode prod-api)"
  echo "  API: ${api_target} (direct CORS request)"
  echo "  overlay: $overlay (does not change desktop/.env.local)"
  if [[ "$auth_mode" == "browser-pkce" ]]; then
    echo "  auth: browser-pkce (React password login; real user)"
  else
    echo "  auth: development + CLI Cognito JWT (Local operator)"
  fi
  exec npm run dev -- --host 127.0.0.1 --port 5173 --strictPort --mode prod-api
}

start_both_pkce() {
  echo "Tip: for longevity use two terminals:"
  echo "  mise run courseboard:api"
  echo "  mise run courseboard:vite"
  echo "Starting both in this shell (Ctrl-C stops both)."
  load_pkce_env
  (cd "$ROOT" && bacon --headless api) &
  api_pid=$!
  sleep 2
  (
    cd "$ROOT/desktop"
    unset VITE_AUTH_PROXY_TARGET || true
    unset VITE_COURSEBOARD_AUTH_MODE || true
    unset VITE_COURSEBOARD_API_BEARER || true
    npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
  ) &
  vite_pid=$!
  trap 'kill $api_pid $vite_pid 2>/dev/null || true' INT TERM
  wait
}

start_both_field() {
  echo "Tip: for longevity use two terminals:"
  echo "  mise run courseboard:field-api"
  echo "  mise run courseboard:field-vite"
  echo "Starting both in this shell (Ctrl-C stops both)."
  (cd "$ROOT" && bacon --headless api) &
  api_pid=$!
  sleep 2
  (
    cd "$ROOT/desktop"
    unset VITE_AUTH_PROXY_TARGET || true
    export VITE_COURSEBOARD_BROWSER_CLIENT_ID=
    export VITE_COURSEBOARD_BROWSER_REDIRECT_URI=
    export VITE_COURSEBOARD_BROWSER_LOGIN_ENDPOINT=
    export VITE_COURSEBOARD_BROWSER_AUTHORIZATION_ENDPOINT=
    export VITE_COURSEBOARD_BROWSER_TOKEN_ENDPOINT=
    export VITE_COURSEBOARD_BROWSER_PROFILE_ENDPOINT=
    export VITE_COURSEBOARD_BROWSER_SCOPES=
    export VITE_COURSEBOARD_AUTH_MODE=development
    export VITE_COURSEBOARD_MOCK_DATA=false
    export VITE_COURSEBOARD_MODE=production
    export VITE_DEV_API_PROXY_TARGET=http://127.0.0.1:8080
    [[ -n "${COURSEBOARD_DEV_BEARER_TOKEN:-}" ]] && export VITE_COURSEBOARD_API_BEARER="$COURSEBOARD_DEV_BEARER_TOKEN"
    npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
  ) &
  vite_pid=$!
  trap 'kill $api_pid $vite_pid 2>/dev/null || true' INT TERM
  wait
}

case "$PROFILE" in
  pkce)
    case "$MODE" in
      api) load_pkce_env; start_api ;;
      vite) start_vite_pkce ;;
      both) start_both_pkce ;;
      *) usage; exit 2 ;;
    esac
    ;;
  field)
    load_field_env
    case "$MODE" in
      api) start_api ;;
      vite) start_vite_field ;;
      both) start_both_field ;;
      *) usage; exit 2 ;;
    esac
    ;;
  prod-api)
    start_vite_prod_api
    ;;
esac
