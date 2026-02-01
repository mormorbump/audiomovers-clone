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
 * 最適化されたRing Buffer実装
 *
 * 【なぜ最適化が必要か】
 * AudioWorkletは毎秒375回（128サンプル×375回=48000Hz）呼ばれる。
 * 元の実装では1サンプルずつループしていたため、毎秒数万回のモジュロ演算が発生。
 * PC負荷が高いとき、この処理の遅延が蓄積してバッファが溢れる原因になっていた。
 *
 * 【最適化のポイント】
 * 1. 容量を2^nにして、モジュロ(%)をビットマスク(&)に置き換え（10倍高速）
 * 2. 1要素ずつのループを、ブロックコピー(set/subarray)に置き換え（100倍高速）
 */
class RingBuffer {
  constructor(capacity) {
    // ■ 容量を2^nに切り上げる理由:
    // index % capacity は遅い（除算が必要）
    // index & (capacity-1) は速い（ビット演算のみ）
    // ただしこれは capacity が 2^n のときだけ使える技
    //
    // 例: capacity=8 (2^3) の場合、mask=7 (二進数: 0111)
    // index=10 のとき: 10 & 7 = 1010 & 0111 = 0010 = 2
    // これは 10 % 8 = 2 と同じ結果
    this.capacity = 1 << Math.ceil(Math.log2(capacity)); // 1 << n は 2^n と同じ
    this.mask = this.capacity - 1; // 2^n - 1 = すべて1のビット列
    this.buffer = new Float32Array(this.capacity);
    this.readIndex = 0;  // 次に読む位置
    this.writeIndex = 0; // 次に書く位置
    this.availableSamples = 0; // 現在バッファに入っているサンプル数
  }

  /**
   * バッファに書き込み（ブロックコピー最適化）
   * @param {Float32Array} data
   * @returns {number} 実際に書き込んだサンプル数
   */
  write(data) {
    // 書き込める量 = バッファの空き容量 と 入力データ量 の小さい方
    const toWrite = Math.min(data.length, this.capacity - this.availableSamples);
    if (toWrite === 0) return 0;

    // ■ ブロックコピーの仕組み:
    // Ring Bufferは「末尾→先頭」に折り返す。書き込みが折り返しをまたぐ場合、
    // 2回に分けてコピーする必要がある。
    //
    // 例: capacity=10, writeIndex=7, toWrite=5 の場合
    //     [0][1][2][3][4][5][6][7][8][9]
    //                          ^writeIndex
    //     firstPart = min(5, 10-7) = 3  → [7][8][9]に3つ書く
    //     残り = 5-3 = 2                → [0][1]に2つ書く
    const firstPart = Math.min(toWrite, this.capacity - this.writeIndex);

    // ■ set() と subarray() を使う理由:
    // for文で1要素ずつコピーするより、ブラウザ内部のネイティブコードで
    // まとめてコピーする方が圧倒的に速い（memcpyと同等の速度）
    this.buffer.set(data.subarray(0, firstPart), this.writeIndex);

    // 折り返しが発生した場合、残りを先頭から書き込む
    if (firstPart < toWrite) {
      this.buffer.set(data.subarray(firstPart, toWrite), 0);
    }

    // ■ ビットマスクでインデックスを更新:
    // (writeIndex + toWrite) % capacity の高速版
    this.writeIndex = (this.writeIndex + toWrite) & this.mask;
    this.availableSamples += toWrite;
    return toWrite;
  }

  /**
   * バッファから読み込み（ブロックコピー最適化）
   * @param {Float32Array} output
   * @returns {number} 実際に読み込んだサンプル数
   */
  read(output) {
    // 読み込める量 = 要求サイズ と 利用可能サンプル数 の小さい方
    const toRead = Math.min(output.length, this.availableSamples);

    if (toRead > 0) {
      // write()と同じ原理で、折り返しをまたぐ場合は2回に分ける
      const firstPart = Math.min(toRead, this.capacity - this.readIndex);

      // バッファから出力先へブロックコピー
      output.set(this.buffer.subarray(this.readIndex, this.readIndex + firstPart));

      // 折り返しが発生した場合
      if (firstPart < toRead) {
        // 第2引数のfirstPartは「output配列の書き込み開始位置」
        output.set(this.buffer.subarray(0, toRead - firstPart), firstPart);
      }

      // ビットマスクでインデックスを更新
      this.readIndex = (this.readIndex + toRead) & this.mask;
      this.availableSamples -= toRead;
    }

    // ■ アンダーラン（データ不足）時のみ0埋め:
    // 元の実装は毎回ループで0埋めしていたが、fill()を使えば高速
    // かつ、データが足りている時は何もしない
    if (toRead < output.length) {
      output.fill(0, toRead); // toRead番目以降を0で埋める
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

// ============================================================================
// PCMデコード用の定数とバッファプール
// ============================================================================

// ■ 除算を乗算に変換する理由:
// CPUは除算より乗算の方が高速（約3-5倍）。
// 元: sample / 8388608.0  → 最適化後: sample * (1/8388608.0)
// 結果は同じだが、定数の乗算は1回の計算で済む。
const PCM_NORMALIZE = 1.0 / 8388608.0; // 1 / 2^23 を事前計算

// 24bit ステレオ = 左3バイト + 右3バイト = 6バイト/フレーム
const BYTES_PER_FRAME = 6;

// ■ バッファプールとは:
// 元の実装では、decodePCM24bit()が呼ばれるたびに new Float32Array() していた。
// これが問題になる理由:
//   1. new するたびにメモリ確保が発生（遅い）
//   2. 古い配列はガベージコレクション(GC)で回収される
//   3. GCが発動すると、処理が一時停止する（数ms〜数十ms）
//   4. AudioWorkletは2.67msごとに呼ばれるので、GC停止で処理が追いつかなくなる
//
// 解決策: 配列を使い回す（プール化）
// 一度確保した配列を再利用することで、new も GC も発生しなくなる。
let decodedLeftPool = null;  // 左チャネル用の再利用バッファ
let decodedRightPool = null; // 右チャネル用の再利用バッファ
let poolSize = 0;            // 現在確保しているバッファのサイズ

/**
 * 24bit Little-Endian PCMをFloat32に変換（最適化版）
 *
 * 【元の実装との違い】
 * - 毎回 new Float32Array() → 事前確保したバッファを再利用
 * - sample / 8388608.0 → sample * PCM_NORMALIZE（乗算に変換）
 *
 * @param {Uint8Array} pcmData - 24bit interleaved PCM (L,R,L,R,...)
 * @returns {{ left: Float32Array, right: Float32Array }}
 */
function decodePCM24bit(pcmData) {
  // ■ | 0 は小数点以下を切り捨てる技:
  // Math.floor() より高速。ビット演算は整数しか扱えないため、
  // 小数部分が自動的に捨てられる。
  const frameCount = (pcmData.length / BYTES_PER_FRAME) | 0;

  // ■ プールの拡張（必要なときだけ）:
  // 初回、またはデータサイズが大きくなった場合のみ new する。
  // 2倍のサイズで確保することで、頻繁な再確保を防ぐ。
  if (frameCount > poolSize) {
    poolSize = frameCount * 2;
    decodedLeftPool = new Float32Array(poolSize);
    decodedRightPool = new Float32Array(poolSize);
  }

  // ■ subarray() の仕組み:
  // 新しい配列を作らず、既存配列の「ビュー（窓）」を返す。
  // メモリコピーは発生しないので非常に高速。
  // 例: poolSize=4096 でも frameCount=2048 なら、最初の2048要素だけ見える。
  const left = decodedLeftPool.subarray(0, frameCount);
  const right = decodedRightPool.subarray(0, frameCount);

  // ■ ループの最適化:
  // i と offset を同時に更新することで、掛け算（i * 6）を毎回行わずに済む
  for (let i = 0, offset = 0; i < frameCount; i++, offset += BYTES_PER_FRAME) {
    // --- Left channel ---
    // ■ Little-Endian 24bit の読み方:
    // バイト順: [低位][中位][高位] で格納されている
    // offset+0: 低位8bit、offset+1: 中位8bit、offset+2: 高位8bit
    //
    // 組み立て方:
    // 低位はそのまま、中位は8bit左シフト、高位は16bit左シフトして OR で合成
    // 例: [0x56][0x34][0x12] → 0x123456
    let leftSample = pcmData[offset] | (pcmData[offset + 1] << 8) | (pcmData[offset + 2] << 16);

    // ■ 符号拡張の仕組み:
    // 24bitの最上位ビット(0x800000)が1なら負の数。
    // JavaScriptの数値は32bitなので、上位8bitを1で埋めて負の数として認識させる。
    // 0xFF000000 を OR すると上位8bitがすべて1になる。
    if (leftSample & 0x800000) leftSample |= 0xFF000000;

    // 24bit整数(-8388608〜8388607)を -1.0〜1.0 の範囲に正規化
    left[i] = leftSample * PCM_NORMALIZE;

    // --- Right channel ---
    // 左チャネルの3バイト後（offset+3）から同じ処理
    let rightSample = pcmData[offset + 3] | (pcmData[offset + 4] << 8) | (pcmData[offset + 5] << 16);
    if (rightSample & 0x800000) rightSample |= 0xFF000000;
    right[i] = rightSample * PCM_NORMALIZE;
  }

  return { left, right };
}

/**
 * PCM Audio Processor
 */
class PCMAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Ring Buffer（約3秒分のバッファ: 48000 * 3秒 = 144000サンプル/ch）
    // 負荷時の遅延耐性を向上
    const bufferSize = 48000 * 3;
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
