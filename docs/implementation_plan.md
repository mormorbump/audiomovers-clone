👉 「音声＝非圧縮PCM(24bit)をWebSocketで配信」「映像＝低ビットレートWebRTC or 省略」

⸻

要件整理（設計の前提）
• 身内用（認証・暗号化・再送制御は行わない）
• 1台のPC → 複数端末へ配信
• 音質は劣化なし（最重要）
• レイテンシー・画質は妥協可
• URLを踏むだけで視聴
• 実装コスト最小

⸻

全体アーキテクチャ（最小）

[ 配信PC ]
├─ Audio Capture (PCM 24bit)
├─ (Optional) Screen Capture
└─ WebSocket Client
↓
[ 中継サーバー ]
├─ WebSocket Server（PCMブロードキャスト）
└─ (Optional) WebRTC SFU（映像のみ）
↓
[ 視聴端末 ]
└─ Browser

⸻

音声設計（最重要・非劣化）

方式
• PCM（非圧縮）をそのままストリーミング（可逆圧縮なし）

フォーマット（固定）
• Sample Rate: 48kHz
• Bit Depth: 24bit
• Channels: Stereo
• Codec: なし（raw PCM）

WebSocket payload（仕様固定）
• raw PCM 24bit
• interleaved stereo（L,R,L,R,...）
• little-endian
• ヘッダなし（JSON等で包まない）

データ量（目安）
48,000 × 2ch × 3byte = 約288KB/s（約2.3Mbps）

⸻

配信PC側（送信）

音声キャプチャ
• OSに応じて「PCの出力」を取得（例：macOSなら仮想オーディオデバイス等）
※この設計書ではキャプチャ手段の詳細は実装フェーズで決める

チャンク設計（固定）
• chunk size: 2048 samples / channel（48kHzで約42.7ms）
• 1メッセージのpayloadサイズ目安: 2048 samples × 2ch × 3byte = 12,288 bytes

送信フロー（概念）
AudioDevice
→ 24bit PCM（interleaved, LE）
→ chunk（2048 samples/ch）
→ WebSocket.send(binary)

⸻

中継サーバー（超シンプル）

役割
• 受け取ったPCMをそのまま全クライアントにブロードキャスト（加工しない）

技術
• Node.js + ws
• 1プロセス/1ファイル構成で可

挙動（概念）
• source(配信PC)から来たbinaryを、そのまま接続中の全viewerへ送る

⸻

視聴側（ブラウザ）
基本、一番音質劣化がなく、シンプルな実装を想定

再生
• Web Audio API
• AudioWorklet（ScriptProcessorNodeは使用しない）

バッファリング
• Ring Bufferで受信データを吸収し、AudioWorkletで連続再生する

同期方針（固定）
• サーバー／クライアント間のクロック同期は行わない（バッファ吸収のみ）
• 遅延・ズレは許容する（音質維持を優先）

⸻

映像設計（後ほど追加）

選択肢①：完全オミット（推奨）
• 音声専用URLで成立（最短）

選択肢②：WebRTC（低画質）
理由
• ブラウザ標準
• URL踏むだけ
• 実装が比較的楽

設計
• 音声：使わない（別経路＝本PCM）
• 映像：VP8 / H.264 低ビットレート
Screen Capture → WebRTC Video Track

注意
• WebRTCの音声は絶対に使わない（Opusで必ず劣化する）

選択肢③：MJPEG（最小実装）
構成
• ffmpegでスクショ連番
• HTTPで配信（紙芝居）

例
ffmpeg
-f avfoundation
-r 2fps
-q:v 31

⸻

URL設計
http://{private_ip}:{port_num}

• HTML 1枚
• JSでWebSocket接続し、AudioWorkletで再生

⸻

レイテンシーと音質のトレードオフ

項目        選択
音質        ◎ 非圧縮（24bit PCM）
レイテンシー △ 数百ms〜数秒（許容）
実装難易度   ◎ 低
スケール     × 大人数不可（身内用途でOK）

⸻

まとめ（最短ルート）
• 音声だけ作る（PCM 24bit / WebSocket）
• ブラウザでAudioWorklet再生
• 映像は後回し（必要ならWebRTC映像のみ別線）