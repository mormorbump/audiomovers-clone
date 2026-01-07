#!/bin/bash
# MusicMovers + Cloudflare Tunnel 起動スクリプト

set -e

# アプリケーション起動
npm run start &
APP_PID=$!

# トンネル起動
cloudflared tunnel run musicmovers &
TUNNEL_PID=$!

# 終了処理
trap "kill $APP_PID $TUNNEL_PID 2>/dev/null" EXIT

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "MusicMovers is running!"
echo "Public URL: http://figjam.llc"
echo "Local URL:  http://localhost:8080"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

wait