/**
 * MusicMovers Server
 *
 * macOSのシステム音声を24bit PCMでキャプチャし、WebSocketでブラウザに配信
 *
 * 必要:
 * - sox: `brew install sox`
 * - BlackHole: `brew install blackhole-2ch`
 * - システム環境設定で「複数出力装置」を作成し、BlackHoleに出力
 *
 * PCMフォーマット（固定）:
 * - Sample Rate: 48kHz
 * - Bit Depth: 24bit
 * - Channels: Stereo (interleaved, Little-Endian)
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { spawn, ChildProcess } from 'child_process';
import { readFile } from 'fs/promises';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

// 設定
const PORT = parseInt(process.env.PORT || '8080', 10);
const AUDIO_DEVICE = process.env.AUDIO_DEVICE || 'BlackHole 2ch';

// PCMパラメータ
const SAMPLE_RATE = 48000;
const CHUNK_SAMPLES = 2048;
const CHUNK_SIZE = CHUNK_SAMPLES * 2 * 3; // 2ch × 3bytes

// 状態
const viewers = new Set<WebSocket>();
let captureProcess: ChildProcess | null = null;
let isCapturing = false;

// MIMEタイプ
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
};

// HTTPサーバー
const httpServer = createServer(async (req, res) => {
  let pathname = new URL(req.url || '/', `http://localhost:${PORT}`).pathname;
  if (pathname === '/') pathname = '/index.html';

  const filePath = join(PUBLIC_DIR, pathname);
  const mimeType = MIME_TYPES[extname(filePath)] || 'application/octet-stream';

  try {
    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mimeType });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
});

// WebSocketサーバー
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  viewers.add(ws);
  console.log(`[Viewer] Connected (${viewers.size})`);

  ws.on('close', () => {
    viewers.delete(ws);
    console.log(`[Viewer] Disconnected (${viewers.size})`);
  });
});

/**
 * soxで音声キャプチャ開始
 */
function startCapture(): void {
  if (isCapturing) return;
  isCapturing = true;

  captureProcess = spawn('sox', [
    '-t', 'coreaudio', AUDIO_DEVICE,
    '-b', '24', '-r', '48000', '-c', '2',
    '-e', 'signed-integer', '-L',
    '-t', 'raw', '-',
  ]);

  let buffer = Buffer.alloc(0);

  captureProcess.stdout?.on('data', (data: Buffer) => {
    buffer = Buffer.concat([buffer, data]);

    while (buffer.length >= CHUNK_SIZE) {
      const chunk = buffer.subarray(0, CHUNK_SIZE);
      buffer = buffer.subarray(CHUNK_SIZE);

      for (const viewer of viewers) {
        if (viewer.readyState === WebSocket.OPEN) {
          viewer.send(chunk);
        }
      }
      if (viewers.size > 0) {
        console.log(`[Send] ${chunk.length} bytes to ${viewers.size} viewers`);
      }
    }
  });

  captureProcess.stderr?.on('data', (data) => {
    console.error('[sox]', data.toString().trim());
  });

  captureProcess.on('error', (err) => {
    console.error('[Capture] Error:', err.message);
    console.error('Install sox: brew install sox');
  });

  captureProcess.on('close', (code) => {
    console.log('[Capture] Stopped:', code);
    isCapturing = false;
    // 自動再起動
    setTimeout(startCapture, 1000);
  });

  console.log('[Capture] Started:', AUDIO_DEVICE);
}

// 起動
httpServer.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║  MusicMovers - PCM Audio Streaming               ║
╠══════════════════════════════════════════════════╣
║  http://localhost:${PORT}/                          ║
║  Device: ${AUDIO_DEVICE.padEnd(37)} ║
║  Format: 48kHz / 24bit / Stereo                  ║
╚══════════════════════════════════════════════════╝
`);
  startCapture();
});

process.on('SIGINT', () => {
  captureProcess?.kill();
  wss.clients.forEach((c) => c.close());
  httpServer.close();
  process.exit(0);
});
