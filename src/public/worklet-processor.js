/**
 * PCM Audio Worklet Processor
 *
 * 役割: Ring Bufferで受信データを管理し、AudioContextのタイミングで連続再生
 *
 * PCMフォーマット（固定）:
 * - Sample Rate: 48kHz
 * - Bit Depth: 24bit (3 bytes per sample)
 * - Channels: Stereo (interleaved: L, R, L, R, ...)
 * - Endian: Little-endian
 */

/**
 * Ring Buffer実装
 * Float32Arrayベースの循環バッファ
 */
class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.buffer = new Float32Array(capacity);
    this.readIndex = 0;
    this.writeIndex = 0;
    this.availableSamples = 0;
  }

  /**
   * バッファに書き込み
   * @param {Float32Array} data
   * @returns {number} 実際に書き込んだサンプル数
   */
  write(data) {
    const toWrite = Math.min(data.length, this.capacity - this.availableSamples);

    for (let i = 0; i < toWrite; i++) {
      this.buffer[this.writeIndex] = data[i];
      this.writeIndex = (this.writeIndex + 1) % this.capacity;
    }

    this.availableSamples += toWrite;
    return toWrite;
  }

  /**
   * バッファから読み込み
   * @param {Float32Array} output
   * @returns {number} 実際に読み込んだサンプル数
   */
  read(output) {
    const toRead = Math.min(output.length, this.availableSamples);

    for (let i = 0; i < toRead; i++) {
      output[i] = this.buffer[this.readIndex];
      this.readIndex = (this.readIndex + 1) % this.capacity;
    }

    this.availableSamples -= toRead;

    // 読み込めなかった分は0で埋める
    for (let i = toRead; i < output.length; i++) {
      output[i] = 0;
    }

    return toRead;
  }

  /**
   * バッファレベル（0-1）
   */
  level() {
    return this.availableSamples / this.capacity;
  }

  /**
   * 利用可能サンプル数
   */
  available() {
    return this.availableSamples;
  }

  /**
   * バッファをクリア
   */
  clear() {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.availableSamples = 0;
  }
}

/**
 * 24bit Little-Endian PCMをFloat32に変換
 * @param {Uint8Array} pcmData - 24bit interleaved PCM (L,R,L,R,...)
 * @returns {{ left: Float32Array, right: Float32Array }}
 */
function decodePCM24bit(pcmData) {
  // 24bit = 3 bytes per sample, stereo = 6 bytes per frame
  const bytesPerSample = 3;
  const bytesPerFrame = bytesPerSample * 2;
  const frameCount = Math.floor(pcmData.length / bytesPerFrame);

  const left = new Float32Array(frameCount);
  const right = new Float32Array(frameCount);

  for (let i = 0; i < frameCount; i++) {
    const offset = i * bytesPerFrame;

    // Left channel (Little-Endian 24bit signed)
    const l0 = pcmData[offset];
    const l1 = pcmData[offset + 1];
    const l2 = pcmData[offset + 2];
    // 24bit signed to 32bit signed (符号拡張)
    let leftSample = (l0 | (l1 << 8) | (l2 << 16));
    if (leftSample & 0x800000) {
      leftSample |= 0xFF000000; // 符号拡張
    }
    left[i] = leftSample / 8388608.0; // 2^23 で正規化

    // Right channel (Little-Endian 24bit signed)
    const r0 = pcmData[offset + 3];
    const r1 = pcmData[offset + 4];
    const r2 = pcmData[offset + 5];
    let rightSample = (r0 | (r1 << 8) | (r2 << 16));
    if (rightSample & 0x800000) {
      rightSample |= 0xFF000000;
    }
    right[i] = rightSample / 8388608.0;
  }

  return { left, right };
}

/**
 * PCM Audio Processor
 */
class PCMAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Ring Buffer（約2秒分のバッファ: 48000 * 2秒 = 96000サンプル/ch）
    const bufferSize = 48000 * 2;
    this.leftBuffer = new RingBuffer(bufferSize);
    this.rightBuffer = new RingBuffer(bufferSize);

    // 統計
    this.totalSamplesReceived = 0;
    this.underrunCount = 0;

    // メインスレッドからのメッセージを処理
    this.port.onmessage = (event) => {
      if (event.data.type === 'pcm') {
        this.handlePCMData(event.data.data);
      } else if (event.data.type === 'clear') {
        this.leftBuffer.clear();
        this.rightBuffer.clear();
      }
    };

    // 定期的に統計を送信
    this.reportInterval = 0;
  }

  /**
   * PCMデータを受け取りバッファに格納
   * @param {ArrayBuffer} arrayBuffer
   */
  handlePCMData(arrayBuffer) {
    const pcmData = new Uint8Array(arrayBuffer);
    const { left, right } = decodePCM24bit(pcmData);

    this.leftBuffer.write(left);
    this.rightBuffer.write(right);
    this.totalSamplesReceived += left.length;

    // デバッグ: 最初の数回だけログ出力
    if (this.totalSamplesReceived < 50000) {
      const maxL = Math.max(...left.slice(0, 100).map(Math.abs));
      const maxR = Math.max(...right.slice(0, 100).map(Math.abs));
      console.log(`[Worklet] Decoded ${left.length} frames, maxL=${maxL.toFixed(4)}, maxR=${maxR.toFixed(4)}, buffer=${this.leftBuffer.available()}`);
    }
  }

  /**
   * オーディオ処理（128サンプル/回）
   */
  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length < 2) {
      return true;
    }

    const leftChannel = output[0];
    const rightChannel = output[1];
    const frameSize = leftChannel.length;

    // バッファから読み込み
    const leftRead = this.leftBuffer.read(leftChannel);
    const rightRead = this.rightBuffer.read(rightChannel);

    // アンダーラン検出
    if (leftRead < frameSize) {
      this.underrunCount++;
    }

    // 統計レポート（約10回/秒で送信: 375回/秒 × 128サンプル = 48000Hz）
    this.reportInterval++;
    if (this.reportInterval >= 37) { // 約100msごと
      this.port.postMessage({
        type: 'stats',
        bufferLevel: this.leftBuffer.level(),
        availableSamples: this.leftBuffer.available(),
        totalSamplesReceived: this.totalSamplesReceived,
        underrunCount: this.underrunCount,
      });
      this.reportInterval = 0;
    }

    return true; // プロセッサを維持
  }
}

registerProcessor('pcm-audio-processor', PCMAudioProcessor);
