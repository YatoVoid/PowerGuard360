#!/usr/bin/env bash
# Starts everything on the host laptop: ML service, plant server, website, then the Expo app in front.
# Ctrl+C stops all of it. Logs go to .logs/.
#   ./deploy.sh            everything
#   ./deploy.sh --no-ml    skip the ML service (the server uses its decision tree)
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$PWD"
LOGS="$ROOT/.logs"
mkdir -p "$LOGS"

WITH_ML=1
[[ "${1:-}" == "--no-ml" ]] && WITH_ML=0

if [[ ! -f server/.env ]]; then
  echo "server/.env is missing (DEVICE_TOKEN, MODEL_TOKEN, GEMINI_API_KEY). Get it from Wali." >&2
  exit 1
fi

busy() { ss -ltn "sport = :$1" | grep -q LISTEN; }

if command -v ufw >/dev/null && sudo ufw status | grep -q "Status: active"; then
  sudo ufw allow 8787/tcp >/dev/null
  sudo ufw allow 5180/tcp >/dev/null
  echo "Firewall: 8787 and 5180 open"
fi

PIDS=()
STOPPED=0
cleanup() {
  (( STOPPED )) && return
  STOPPED=1
  echo
  echo "Stopping..."
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

start() {
  local name=$1 port=$2 dir=$3; shift 3
  if busy "$port"; then
    echo "$name: port $port already in use, leaving the running one alone"
    return
  fi
  (cd "$ROOT/$dir" && exec "$@") > "$LOGS/$name.log" 2>&1 &
  PIDS+=($!)
  echo "$name: starting on :$port (log .logs/$name.log)"
}

wait_port() {
  local name=$1 port=$2 secs=$3
  for _ in $(seq "$secs"); do busy "$port" && return 0; sleep 1; done
  echo "$name did not come up on :$port. Last log lines:" >&2
  tail -n 20 "$LOGS/$name.log" >&2
  exit 1
}

if (( WITH_ML )); then
  if [[ ! -x machine_learning/.venv/bin/uvicorn ]]; then
    echo "ML service: first-time setup of machine_learning/.venv"
    python3 -m venv machine_learning/.venv
    machine_learning/.venv/bin/pip install -q -r machine_learning/requirements-api.txt
  fi
  start ml 8790 machine_learning .venv/bin/uvicorn api:app --host 127.0.0.1 --port 8790 --no-access-log
  wait_port ml 8790 60
fi

# On the demo hotspot every screen may run the plant, as before admin sign-in existed. OPEN_CONTROL=0 ./deploy.sh to require it.
start server 8787 server env OPEN_CONTROL="${OPEN_CONTROL:-1}" npx tsx --env-file=.env src/server.ts
start web 5180 web npx vite --host --port 5180
wait_port server 8787 30
wait_port web 5180 30

IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')
echo
echo "Website:      http://${IP:-<host-ip>}:5180  (this laptop: http://localhost:5180)"
echo "Plant server: ws://${IP:-<host-ip>}:8787/ws"
if (( WITH_ML )); then
  for _ in $(seq 10); do grep -q "\[ml\] scoring" "$LOGS/server.log" 2>/dev/null && break; sleep 1; done
  grep -q "\[ml\] scoring" "$LOGS/server.log" 2>/dev/null && echo "ML service:   connected, Random Forest scoring every turbine" \
    || echo "ML service:   not connected yet, see .logs/server.log and .logs/ml.log"
fi
echo

if command -v adb >/dev/null && adb get-state >/dev/null 2>&1; then
  adb reverse tcp:8081 tcp:8081
  adb reverse tcp:8787 tcp:8787
  echo "Phone over USB: ports 8081 and 8787 forwarded. Open exp://127.0.0.1:8081 in Expo Go."
else
  echo "No phone on USB. On Wi-Fi, scan the QR code below in Expo Go."
fi
echo

cd "$ROOT/mobile"
npx expo start --lan
