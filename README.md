# MusicMovers

macOSのシステム音声を非圧縮24bit PCMでブラウザに配信

## セットアップ

```bash
./setup.sh
```

### macOS音声出力設定

1. Audio MIDI設定から左下の「+」→「複数出力装置を作成」
2. 「使用したいドライバー」と「BlackHole 2ch」にチェック
3. この複数出力装置をデフォルト出力に設定

## 使い方

### ローカルのみ

```bash
npm start
```

ブラウザで http://localhost:8080 にアクセス → 「再生開始」

### インターネット公開（Cloudflare Tunnel）

Docker Desktopが必要です。

#### 起動

```bash
./scripts/start-public.sh
```

起動後、コンソールに表示される `https://xxx.trycloudflare.com` のURLでどこからでもアクセス可能。

#### 手動起動(上の手順を一個ずつやる)

```bash
# ターミナル1: MusicMovers起動
npm start

# ターミナル2: トンネル起動
docker compose up
./scripts/get-tunnel-url.sh
```

#### 終了

```bash
# start-public.sh で起動した場合
Ctrl+C

# backgroundで起動した場合
lsof -ti:8080 | xargs kill -9 2>/dev/null; echo "Done"

# 手動起動した場合
docker compose down
# MusicMoversはCtrl+Cで停止
```

## 環境変数

| 変数 | 説明 | デフォルト |
|------|------|------|
| PORT | ポート番号 | 8080 |
| AUDIO_DEVICE | 音声デバイス名 | BlackHole 2ch |

## 仕様

- Format: 48kHz / 24bit / Stereo / Little-Endian PCM
- 帯域: 約2.3Mbps

## Note

BlackHoleはmacOSカーネルレベルのオーディオドライバのため、Dockerでの実行は不可。
参考: https://qiita.com/dekoboko/items/5c209f4a524242d8a996
