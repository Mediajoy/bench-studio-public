#!/bin/bash
# Kills any bench-studio-public dev processes (server.mjs, vite, concurrently)
# and anything still bound to its ports, then starts a fresh `pnpm dev`.
# This exists so stale builds/ports never linger between runs — see
# 2026-08-18 session notes on the catalog freshness sweep.

set -e
PROJECT_DIR="/Users/shahramsedehi/Documents/Github Local/bench-studio-public"
LOG_FILE="$HOME/Library/Logs/bench-studio.log"

echo "Stopping any running bench-studio-public processes..."
pkill -f "bench-studio-public.*server/server.mjs" 2>/dev/null || true
pkill -f "bench-studio-public.*vite" 2>/dev/null || true
pkill -f "bench-studio-public.*concurrently" 2>/dev/null || true

for PORT in 5200 5201 8787; do
  PID=$(lsof -ti:"$PORT" 2>/dev/null || true)
  if [ -n "$PID" ]; then
    echo "Freeing port $PORT (pid $PID)..."
    kill "$PID" 2>/dev/null || true
  fi
done

sleep 1

# Clear any stale production build so dev mode can't accidentally pick up
# an old bundle — this app only ever runs via Vite dev + the Express API,
# never a served dist/.
rm -rf "$PROJECT_DIR/dist"

cd "$PROJECT_DIR"
echo "Starting bench-studio-public (pnpm dev)... logging to $LOG_FILE"
exec pnpm dev >> "$LOG_FILE" 2>&1
