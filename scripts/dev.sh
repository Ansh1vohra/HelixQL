#!/usr/bin/env bash
#
# Runs all three HelixQL tiers together for local development.
#
#   ./scripts/dev.sh
#
# Starts the control plane (:3000) and the gateway (:8000) in the background,
# waits for both to answer, then runs the desktop app in the foreground.
# Closing the desktop app — or Ctrl+C — shuts everything down.
#
# Prerequisites, once:
#   cd control-plane  && npm install
#   cd client-desktop && npm install
#   cd server-gateway && python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
# and a .env in both control-plane/ and server-gateway/ (see .env.example).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTROL_PLANE_PORT="${CONTROL_PLANE_PORT:-3000}"
GATEWAY_PORT="${GATEWAY_PORT:-8000}"
LOG_DIR="$ROOT/.dev-logs"
mkdir -p "$LOG_DIR"

pids=()

port_owner() {
  # Prints the PID listening on $1, if any.
  ss -ltnp 2>/dev/null | awk -v port=":$1\$" '$4 ~ port { if (match($0, /pid=[0-9]+/)) print substr($0, RSTART+4, RLENGTH-4) }' | head -1
}

# Signals a process and everything in its process group. Resolving the PGID
# from the PID matters: `setsid` forks, so the PID bash records in `$!` is
# not necessarily the group leader, and `kill -- -$!` would signal the wrong
# group (or nothing).
kill_tree() {
  local pid="$1" sig="${2:-TERM}" pgid
  [ -z "$pid" ] && return 0
  pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')
  [ -n "$pgid" ] && kill "-$sig" -- "-$pgid" 2>/dev/null || true
  kill "-$sig" "$pid" 2>/dev/null || true
}

cleanup() {
  echo ""
  echo "→ shutting down…"

  # `npm run dev` and `uvicorn` both spawn children. Signalling only the
  # launcher leaves those orphaned and still holding their ports; a stale
  # gateway then answers /health on the next run, this script reports
  # "ready", and every query silently goes to the old process with the old
  # config. That is the exact failure this guards against, so shutdown is
  # verified against the ports rather than assumed.
  for pid in "${pids[@]:-}"; do kill_tree "$pid" TERM; done
  for port in "$CONTROL_PLANE_PORT" "$GATEWAY_PORT"; do
    kill_tree "$(port_owner "$port")" TERM
  done

  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ -z "$(port_owner "$CONTROL_PLANE_PORT")$(port_owner "$GATEWAY_PORT")" ] && break
    sleep 0.3
  done

  # Anything still listening ignored SIGTERM. Don't leave it behind.
  for port in "$CONTROL_PLANE_PORT" "$GATEWAY_PORT"; do
    local straggler
    straggler=$(port_owner "$port")
    [ -n "$straggler" ] && { echo "  (force-stopping pid $straggler on :$port)"; kill_tree "$straggler" KILL; }
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

assert_port_free() {
  local port="$1" name="$2"
  local owner
  owner=$(port_owner "$port")
  [ -z "$owner" ] && return 0

  echo "✗ port $port ($name) is already in use by PID $owner:" >&2
  ps -o pid,lstart,cmd -p "$owner" 2>/dev/null | tail -1 >&2
  echo "" >&2
  echo "  A leftover process from a previous run will keep serving stale code" >&2
  echo "  and stale .env values, so your changes appear to have no effect." >&2
  echo "  Stop it with:  kill $owner" >&2
  exit 1
}

require_env() {
  local file="$1" key="$2"
  if ! grep -qE "^${key}=.+" "$file"; then
    echo "✗ ${key} is empty in ${file#$ROOT/}" >&2
    return 1
  fi
}

echo "→ checking configuration"
[ -f "$ROOT/control-plane/.env" ] || { echo "✗ control-plane/.env is missing (copy .env.example)" >&2; exit 1; }
[ -f "$ROOT/server-gateway/.env" ] || { echo "✗ server-gateway/.env is missing (copy .env.example)" >&2; exit 1; }
require_env "$ROOT/control-plane/.env" MONGODB_URI
require_env "$ROOT/control-plane/.env" GATEWAY_INTERNAL_SECRET
require_env "$ROOT/server-gateway/.env" GEMINI_API_KEY
require_env "$ROOT/server-gateway/.env" CONTROL_PLANE_INTERNAL_SECRET

# The single most common local misconfiguration: the two tiers disagree on
# the shared secret, and every query fails with an opaque 503.
cp_secret=$(grep '^GATEWAY_INTERNAL_SECRET=' "$ROOT/control-plane/.env" | cut -d= -f2-)
gw_secret=$(grep '^CONTROL_PLANE_INTERNAL_SECRET=' "$ROOT/server-gateway/.env" | cut -d= -f2-)
if [ "$cp_secret" != "$gw_secret" ]; then
  echo "✗ control-plane GATEWAY_INTERNAL_SECRET != server-gateway CONTROL_PLANE_INTERNAL_SECRET" >&2
  echo "  These must match exactly, or the gateway cannot authenticate to the control plane." >&2
  exit 1
fi
echo "  ✓ shared secret matches"

wait_for() {
  local name="$1" url="$2" log="$3" pid="$4"
  for _ in $(seq 1 60); do
    # Check liveness first. If the service died — most often because the port
    # was taken — a *different* process may still answer the URL, and
    # reporting "ready" there is how you end up debugging a server that isn't
    # the one you just started.
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "✗ $name exited during startup. Last lines of ${log#$ROOT/}:" >&2
      tail -20 "$log" >&2
      return 1
    fi
    if curl -sf -m 2 "$url" >/dev/null 2>&1; then
      echo "  ✓ $name ready"
      return 0
    fi
    sleep 1
  done
  echo "✗ $name did not come up. Last lines of ${log#$ROOT/}:" >&2
  tail -20 "$log" >&2
  return 1
}

assert_port_free "$CONTROL_PLANE_PORT" "control plane"
assert_port_free "$GATEWAY_PORT" "gateway"

echo "→ starting control plane on :$CONTROL_PLANE_PORT"
setsid bash -c "cd '$ROOT/control-plane' && exec npm run dev -- -p '$CONTROL_PLANE_PORT'" \
  >"$LOG_DIR/control-plane.log" 2>&1 &
control_plane_pid=$!
pids+=("$control_plane_pid")

echo "→ starting gateway on :$GATEWAY_PORT"
setsid bash -c "cd '$ROOT/server-gateway' && exec ./venv/bin/uvicorn app.main:app --port '$GATEWAY_PORT'" \
  >"$LOG_DIR/gateway.log" 2>&1 &
gateway_pid=$!
pids+=("$gateway_pid")

wait_for "gateway" "http://127.0.0.1:$GATEWAY_PORT/health" "$LOG_DIR/gateway.log" "$gateway_pid"
wait_for "control plane" "http://127.0.0.1:$CONTROL_PLANE_PORT" "$LOG_DIR/control-plane.log" "$control_plane_pid"

# Surface which provider actually loaded, so a stale or unexpected config is
# visible immediately rather than after a failed query.
grep -h "SQL synthesis" "$LOG_DIR/gateway.log" | tail -1 | sed 's/^.*INFO/  /' || true

echo ""
echo "  control plane  http://localhost:$CONTROL_PLANE_PORT"
echo "  gateway docs   http://localhost:$GATEWAY_PORT/docs"
echo "  logs           .dev-logs/"
echo ""
echo "→ starting desktop app (close it to stop everything)"

cd "$ROOT/client-desktop"
# Some terminals inherit these from a parent Electron app (VS Code's
# integrated terminal, for one). ELECTRON_RUN_AS_NODE makes the electron
# binary behave as plain Node, so the app dies at startup with a confusing
# "Cannot read properties of undefined (reading 'isPackaged')".
unset ELECTRON_RUN_AS_NODE ELECTRON_NO_ATTACH_CONSOLE

HELIXQL_CONTROL_PLANE_URL="http://localhost:$CONTROL_PLANE_PORT" \
HELIXQL_GATEWAY_URL="http://localhost:$GATEWAY_PORT" \
  npm run dev
