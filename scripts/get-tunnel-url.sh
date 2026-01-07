#!/bin/bash
# Cloudflare TunnelのURLを取得
# docker compose up 時に自動で tunnel_url.txt が更新されます
# このスクリプトは手動でURLを確認したい場合に使用

echo "Waiting for tunnel URL..."

# 最大30秒待機
for i in {1..30}; do
  URL=$(docker compose logs cloudflared 2>&1 | grep -o "https://[^ ]*trycloudflare.com" | head -n 1)
  if [ -n "$URL" ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Public URL: $URL"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "$URL" > tunnel_url.txt
    exit 0
  fi
  sleep 1
done

echo "URL not found. Check logs: docker compose logs cloudflared"
