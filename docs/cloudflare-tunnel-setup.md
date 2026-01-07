# Cloudflare Tunnel 実装計画

MusicMoversをインターネット上に公開するためのCloudflare Tunnelセットアップ手順。

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│                         インターネット                           │
└─────────────────────────────────────────────────────────────────┘
                              ↓ ↑
┌─────────────────────────────────────────────────────────────────┐
│                    Cloudflare Edge                              │
│              (your-domain.example.com)                          │
│                     HTTPS/WSS 対応                               │
└─────────────────────────────────────────────────────────────────┘
                              ↓ ↑
                     トンネル（暗号化）
                              ↓ ↑
┌─────────────────────────────────────────────────────────────────┐
│  macOS                                                          │
│  ┌────────────────┐    ┌──────────────────┐                     │
│  │  cloudflared   │←──→│  MusicMovers     │                     │
│  │  (デーモン)     │    │  localhost:8080  │                     │
│  └────────────────┘    └──────────────────┘                     │
│                              ↑                                   │
│                        BlackHole + sox                           │
│                        (音声キャプチャ)                           │
└─────────────────────────────────────────────────────────────────┘
```

## 前提条件

- [ ] Cloudflareアカウント（無料）
- [ ] 独自ドメイン（Cloudflare DNSで管理）

---

## Phase 1: 環境準備

### 1.1 cloudflaredのインストール

```bash
brew install cloudflared
```

### 1.2 Cloudflareにログイン

```bash
cloudflared tunnel login
```

ブラウザが開き、認証後に証明書が `~/.cloudflared/cert.pem` に保存される。

---

## Phase 2: トンネル作成

### 2.1 トンネル作成

```bash
cloudflared tunnel create musicmovers
```

トンネルIDとcredentialsファイルが生成される。

### 2.2 DNSレコード設定

```bash
cloudflared tunnel route dns musicmovers music.your-domain.com

>>Tunnel credentials written to /Users/matsumotokazuki/.cloudflared/ff73ba7e-06df-43a4-a8ae-b283226c109a.json. cloudflared chose this file based on where your origin certificate was found. Keep this file secret. To revoke these credentials, delete the tunnel.
>>Created tunnel musicmovers with id ff73ba7e-06df-43a4-a8ae-b283226c109a
```

CNAMEレコードが自動作成される。

---

## Phase 3: 設定ファイル作成

### 3.1 config.yml

`~/.cloudflared/config.yml` を作成:

```yaml
tunnel: ff73ba7e-06df-43a4-a8ae-b283226c109a
credentials-file: /Users/<username>/.cloudflared/ff73ba7e-06df-43a4-a8ae-b283226c109a.json

ingress:
  - hostname: music.your-domain.com
    service: http://localhost:8080
    originRequest:
      noTLSVerify: false
  - service: http_status:404
```

---

## Phase 4: 起動スクリプト

### 4.1 start-with-tunnel.sh

プロジェクトルートに作成:

```bash
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
echo "Public URL: https://music.your-domain.com"
echo "Local URL:  http://localhost:8080"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

wait
```

---

## Phase 5: 永続化（オプション）

### macOSサービスとして登録

```bash
cloudflared service install
```

システム起動時に自動でトンネルが起動する。

---

## 作業チェックリスト

| Step | 作業内容 | 完了 |
|------|----------|------|
| 1 | Cloudflareアカウント作成・ドメイン追加 | [ ] |
| 2 | `brew install cloudflared` | [ ] |
| 3 | `cloudflared tunnel login` | [ ] |
| 4 | トンネル作成・DNS設定 | [ ] |
| 5 | config.yml作成 | [ ] |
| 6 | 起動スクリプト作成 | [ ] |
| 7 | 動作確認 | [ ] |

---

## 注意点

1. **WebSocket対応**: Cloudflare TunnelはWebSocketを標準サポート
2. **帯域制限**: 無料プランでも実用的な帯域（24bit/48kHz stereo ≒ 288kbps）
3. **セキュリティ**: 必要に応じてCloudflare Accessで認証追加可能

---

## トラブルシューティング

### トンネルが接続できない

```bash
# ログを確認
cloudflared tunnel run musicmovers --loglevel debug
```

### WebSocketが動作しない

Cloudflare DashboardでWebSocketが有効になっているか確認:
- SSL/TLS → Edge Certificates → WebSockets: ON

### 音声が途切れる

バッファサイズを調整:
- `src/public/player.js` の `PREBUFFER_SAMPLES` を増やす
