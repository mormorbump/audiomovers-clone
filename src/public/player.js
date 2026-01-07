/**
 * MusicMovers Player
 */

const SAMPLE_RATE = 48000;
const PREBUFFER_SAMPLES = 48000 * 0.3; // 300ms

let audioContext = null;
let workletNode = null;
let websocket = null;
let isPlaying = false;
let bytesReceived = 0;
let prebufferComplete = false;

const playButton = document.getElementById('playButton');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const bufferLevelEl = document.getElementById('bufferLevel');
const bytesReceivedEl = document.getElementById('bytesReceived');
const latencyEl = document.getElementById('latency');

function updateStatus(status, text) {
  statusDot.className = 'status-dot ' + status;
  statusText.textContent = text;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

async function initAudio() {
  audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
  await audioContext.audioWorklet.addModule('worklet-processor.js');

  workletNode = new AudioWorkletNode(audioContext, 'pcm-audio-processor', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });

  // 最初から接続（process()が呼ばれるために必要）
  // バッファが空の間は無音が出力される
  workletNode.connect(audioContext.destination);
  console.log('[Audio] Worklet connected to destination');

  workletNode.port.onmessage = (event) => {
    if (event.data.type === 'stats') {
      const { bufferLevel, availableSamples, underrunCount } = event.data;
      bufferLevelEl.textContent = Math.round(bufferLevel * 100) + '%';
      console.log(`[Stats] bufferLevel=${(bufferLevel*100).toFixed(1)}%, samples=${availableSamples}, underruns=${underrunCount}, prebufferComplete=${prebufferComplete}`);

      if (!prebufferComplete && availableSamples >= PREBUFFER_SAMPLES) {
        prebufferComplete = true;
        console.log('[Audio] Prebuffer complete, playback starting');
        updateStatus('playing', '再生中');
        latencyEl.textContent = Math.round((availableSamples / SAMPLE_RATE) * 1000) + ' ms';
      }
    }
  };
}

function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}/`;

  updateStatus('connecting', '接続中...');
  websocket = new WebSocket(wsUrl);
  websocket.binaryType = 'arraybuffer';

  websocket.onopen = () => {
    updateStatus('connected', 'バッファリング中...');
    prebufferComplete = false;
  };

  websocket.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      bytesReceived += event.data.byteLength;
      bytesReceivedEl.textContent = formatBytes(bytesReceived);
      if (bytesReceived < 50000) {
        console.log(`[WS] Received ${event.data.byteLength} bytes, total=${bytesReceived}`);
      }
      workletNode?.port.postMessage({ type: 'pcm', data: event.data });
    }
  };

  websocket.onclose = () => {
    updateStatus('', '切断');
    if (isPlaying) setTimeout(connectWebSocket, 2000);
  };

  websocket.onerror = () => updateStatus('error', 'エラー');
}

async function startPlayback() {
  await initAudio();
  if (audioContext.state === 'suspended') await audioContext.resume();
  connectWebSocket();
  isPlaying = true;
  playButton.textContent = '停止';
  playButton.classList.add('stop');
}

function stopPlayback() {
  isPlaying = false;
  websocket?.close();
  websocket = null;
  workletNode?.disconnect();
  workletNode = null;
  audioContext?.close();
  audioContext = null;
  bytesReceived = 0;
  prebufferComplete = false;
  bytesReceivedEl.textContent = '0 KB';
  bufferLevelEl.textContent = '0%';
  latencyEl.textContent = '- ms';
  updateStatus('', '待機中');
  playButton.textContent = '再生開始';
  playButton.classList.remove('stop');
}

playButton.addEventListener('click', () => isPlaying ? stopPlayback() : startPlayback());
updateStatus('', '待機中');
