# Docker Compose + Cloudflare Tunnel 実装計画

MusicMoversをDocker Composeとcloudflaredで公開するセットアップ手順。

## 制約事項

**重要**: BlackHoleはmacOSカーネルレベルのオーディオドライバのため、MusicMovers自体はDockerコンテナ内で実行できません。

そのため、以下のハイブリッド構成を採用します：

| コンポーネント | 実行環境 | 理由 |
|---------------|---------|------|
| MusicMovers | ホスト（macOS） | BlackHole + sox が必要 |
| cloudflared | Docker | 管理が容易 |

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│                         インターネット                            │
│                  https://musicmovers.figjam.com                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓ ↑
┌─────────────────────────────────────────────────────────────────┐
│                    Cloudflare Edge                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓ ↑
┌─────────────────────────────────────────────────────────────────┐
│  Docker Container                                               │
│  ┌────────────────────────────────────────┐                     │
│  │  cloudflared                           │                     │
│  │  tunnel --url http://host.docker...    │                     │
│  └────────────────────────────────────────┘                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓ ↑
                    host.docker.internal:8080
                              ↓ ↑
┌─────────────────────────────────────────────────────────────────┐
│  macOS Host                                                     │
│  ┌──────────────────┐                                           │
│  │  MusicMovers     │ ← BlackHole + sox                         │
│  │  localhost:8080  │                                           │
│  └──────────────────┘                                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 実装手順

### Step 1: docker-compose.yml 作成

プロジェクトルートに `docker-compose.yml` を作成：

```yaml
services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: musicmovers-tunnel
    restart: unless-stopped
    command: tunnel --no-autoupdate --url http://host.docker.internal:8080
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

### Step 2: トンネルURL取得スクリプト

`get-tunnel-url.sh` を作成：

```bash
#!/bin/bash
# Cloudflare TunnelのURLを取得

echo "Waiting for tunnel URL..."
sleep 3

URL=$(docker compose logs cloudflared 2>&1 | grep -o "https://[^ ]*trycloudflare.com" | head -n 1)

if [ -n "$URL" ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Public URL: $URL"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "$URL" > tunnel_url.txt
else
  echo "URL not found. Check logs: docker compose logs cloudflared"
fi
```

### Step 3: 起動スクリプト

`start-public.sh` を作成：

```bash
#!/bin/bash
# MusicMovers + Cloudflare Tunnel 起動

set -e

echo "Starting MusicMovers..."
npm run start &
APP_PID=$!
sleep 2

echo "Starting Cloudflare Tunnel..."
docker compose up -d

# URL取得
sleep 5
./get-tunnel-url.sh

# 終了処理
trap "docker compose down; kill $APP_PID 2>/dev/null" EXIT INT TERM

echo ""
echo "Press Ctrl+C to stop"
wait $APP_PID
```

---

## 使い方

### 起動

```bash
# 1. MusicMoversを起動
npm start

# 2. 別ターミナルでトンネル起動
docker compose up

# 3. URLを確認
docker compose logs cloudflared | grep trycloudflare.com
```

または一括起動：

```bash
chmod +x start-public.sh get-tunnel-url.sh
./start-public.sh
```

### 停止

```bash
docker compose down
# MusicMoversはCtrl+Cで停止
```

---

## 作業チェックリスト

| Step | 作業内容 | 完了 |
|------|----------|------|
| 1 | Docker Desktop がインストールされている | [ ] |
| 2 | `docker-compose.yml` を作成 | [ ] |
| 3 | `get-tunnel-url.sh` を作成 | [ ] |
| 4 | `start-public.sh` を作成 | [ ] |
| 5 | 動作確認 | [ ] |

---

## Quick Tunnel vs Named Tunnel

| 項目 | Quick Tunnel | Named Tunnel |
|------|-------------|--------------|
| URL | 毎回ランダム | 固定サブドメイン |
| アカウント | 不要 | 必要 |
| 設定 | 不要 | config.yml必要 |
| 用途 | 一時的な共有 | 本番運用 |

この計画ではQuick Tunnel（アカウント不要）を使用します。
固定URLが必要な場合は `cloudflare-tunnel-setup.md` を参照してください。

---

## 注意点

1. **URL変更**: Quick Tunnelは起動のたびにURLが変わる
2. **WebSocket**: Cloudflare TunnelはWebSocketを標準サポート
3. **帯域**: 24bit/48kHz stereo ≒ 2.3Mbps（Cloudflare無料枠で対応可能）

---

## トラブルシューティング

### host.docker.internal が解決できない

macOS/WindowsのDocker Desktopでは自動で解決されます。
Linuxの場合は `extra_hosts` の設定が必要です（docker-compose.ymlに記載済み）。

### URLが取得できない

```bash
# ログを直接確認
docker compose logs -f cloudflared
```

### MusicMoversに接続できない

```bash
# ホストでMusicMoversが動作しているか確認
curl http://localhost:8080
```
