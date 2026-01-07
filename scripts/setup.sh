#!/bin/bash
set -e

echo "=== MusicMovers Setup ==="

# Homebrew確認
if ! command -v brew &> /dev/null; then
  echo "Homebrewをインストールしてください: https://brew.sh"
  exit 1
fi

# sox
if ! command -v sox &> /dev/null; then
  echo "Installing sox..."
  brew install sox
fi

# BlackHole
if ! brew list blackhole-2ch &> /dev/null; then
  echo "Installing BlackHole 2ch..."
  brew install --cask blackhole-2ch
fi

# npm依存
if [ ! -d "node_modules" ]; then
  echo "Installing npm dependencies..."
  npm install
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "次の手順でmacOSの音声出力を設定してください："
echo "1. macを再起動"
echo "2. 「audio MIDI設定」から「複数出力装置を作成」"
echo "3. インターフェースなどと「BlackHole 2ch」にチェック"
echo "4. この複数出力装置をデフォルト出力に設定"
echo ""
echo "起動: npm start"
