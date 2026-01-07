#!/bin/bash
# MusicMovers + Cloudflare Tunnel 起動

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

echo "Starting MusicMovers..."
npm run start &
APP_PID=$!
sleep 2

echo "Starting Cloudflare Tunnel..."
docker compose up -d

# URL取得
sleep 5
"$SCRIPT_DIR/get-tunnel-url.sh"

# 終了処理
trap "docker compose down; kill $APP_PID 2>/dev/null" EXIT INT TERM

echo ""
echo "Press Ctrl+C to stop"
wait $APP_PID
