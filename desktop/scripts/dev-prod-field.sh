#!/usr/bin/env bash
# Local Field verification: course-api (:8080) + Vite (:5173).
# Run in a dedicated interactive terminal you control — not an agent shell.
# Agents that pkill/restart will kill whatever this starts if they own the process group.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MODE="${1:-both}" # api | vite | both
RESTART="${RESTART:-0}"
DEFAULT_FIELD_API_URL="${DEFAULT_FIELD_API_URL:-https://tachyon-field-api.txcloud.app}"

if [[ ! -f "$ROOT/.env.prod-field" ]]; then
  echo "Missing $ROOT/.env.prod-field — run: mise run courseboard:field-env" >&2
  echo "  (or: cd desktop && npm run field:env)" >&2
  exit 1
fi

if [[ "$RESTART" == "1" ]]; then
  pkill -f 'target/debug/courseboard' 2>/dev/null || true
  pkill -f 'vite --host 127.0.0.1 --port 5173' 2>/dev/null || true
  sleep 1
fi

export COURSEBOARD_LOCAL_ENV_FILE="$ROOT/.env.prod-field"
export COURSEBOARD_CLEAR_DEV_BEARER=0

set -a
# shellcheck disable=SC1091
source "$ROOT/.env.prod-field"
set +a

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

start_api() {
  cd "$ROOT"
  if [[ "${COURSEBOARD_API_ONCE:-0}" == "1" ]]; then
    echo "Starting courseboard on :8080 once (no watch; Field: ${TACHYON_FIELD_API_URL})"
    exec bash "$ROOT/desktop/scripts/run-courseboard-with-env.sh"
  fi
  echo "Starting courseboard on :8080 with bacon hot-reload (job: api; Field: ${TACHYON_FIELD_API_URL})"
  echo "Rust save or .env.prod-field change → rebuild + restart (re-reads Field bearer)."
  exec bacon api
}

start_vite() {
  cd "$ROOT/desktop"
  unset VITE_AUTH_PROXY_TARGET || true
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

case "$MODE" in
  api) start_api ;;
  vite) start_vite ;;
  both)
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
    ;;
  *)
    echo "Usage: $0 [api|vite|both]" >&2
    echo "Optional: RESTART=1 $0 both   # pkill previous listeners first" >&2
    echo "Optional: COURSEBOARD_API_ONCE=1 $0 api   # cargo run without bacon watch" >&2
    exit 2
    ;;
esac
