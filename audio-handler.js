/**
 * AudioHandler - Manages microphone input (PCM 16kHz 16-bit) and audio output playback (PCM 24kHz 16-bit)
 */
class AudioHandler {
  constructor() {
    this._micContext = null;
    this._playbackContext = null;
    this._micStream = null;
    this._workletNode = null;
    this._scriptNode = null;
    this._onAudioData = null;

    // Playback
    this._playbackQueue = [];
    this._isPlaying = false;
    this._playbackSampleRate = 24000;
    this._currentSource = null;
  }

  /**
   * Initialize microphone capture
   * Uses AudioWorklet where supported, falls back to ScriptProcessorNode
   * @param {Function} onAudioData - Callback receiving ArrayBuffer of PCM int16 data
   */
  async startMic(onAudioData) {
    this._onAudioData = onAudioData;

    // Request microphone
    try {
      this._micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: 48000 },
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new Error('マイクへのアクセスが拒否されました。ブラウザの設定を確認してください。');
      } else if (err.name === 'NotFoundError') {
        throw new Error('マイクが見つかりません。デバイスにマイクが接続されているか確認してください。');
      }
      throw new Error(`マイクの初期化に失敗しました: ${err.message}`);
    }

    try {
      this._micContext = new AudioContext({ sampleRate: 48000 });

      // iOS Safari requires explicit resume after user gesture
      if (this._micContext.state === 'suspended') {
        await this._micContext.resume();
      }

      const source = this._micContext.createMediaStreamSource(this._micStream);

      // Try AudioWorklet first, fall back to ScriptProcessorNode
      if (this._micContext.audioWorklet) {
        try {
          await this._micContext.audioWorklet.addModule('audio-worklet.js');
          this._workletNode = new AudioWorkletNode(this._micContext, 'pcm-processor');
          this._workletNode.port.onmessage = (event) => {
            if (this._onAudioData) {
              this._onAudioData(event.data);
            }
          };
          source.connect(this._workletNode);
          console.log('[AudioHandler] Mic started with AudioWorklet');
          return;
        } catch (workletErr) {
          console.warn('[AudioHandler] AudioWorklet failed, falling back to ScriptProcessor:', workletErr);
        }
      }

      // Fallback: ScriptProcessorNode (deprecated but widely supported)
      this._setupScriptProcessor(source);
      console.log('[AudioHandler] Mic started with ScriptProcessorNode (fallback)');
    } catch (err) {
      this.stopMic();
      throw new Error(`音声処理の初期化に失敗しました: ${err.message}`);
    }
  }

  /**
   * Fallback mic capture using ScriptProcessorNode
   */
  _setupScriptProcessor(source) {
    const bufferSize = 4096;
    this._scriptNode = this._micContext.createScriptProcessor(bufferSize, 1, 1);
    let pcmBuffer = [];
    const targetBufferSize = 2400;

    this._scriptNode.onaudioprocess = (event) => {
      const channelData = event.inputBuffer.getChannelData(0);
      const ratio = this._micContext.sampleRate / 16000;

      for (let i = 0; i < channelData.length; i += ratio) {
        const idx = Math.floor(i);
        if (idx < channelData.length) {
          let sample = channelData[idx];
          sample = Math.max(-1, Math.min(1, sample));
          pcmBuffer.push(sample * 32767);
        }
      }

      if (pcmBuffer.length >= targetBufferSize) {
        const pcmData = new Int16Array(pcmBuffer.splice(0, targetBufferSize));
        if (this._onAudioData) {
          this._onAudioData(pcmData.buffer);
        }
      }
    };

    source.connect(this._scriptNode);
    // ScriptProcessorNode requires connection to destination to fire events
    this._scriptNode.connect(this._micContext.destination);
  }

  /**
   * Stop microphone capture
   */
  stopMic() {
    if (this._workletNode) {
      this._workletNode.disconnect();
      this._workletNode = null;
    }
    if (this._scriptNode) {
      this._scriptNode.disconnect();
      this._scriptNode = null;
    }
    if (this._micStream) {
      this._micStream.getTracks().forEach(t => t.stop());
      this._micStream = null;
    }
    if (this._micContext) {
      this._micContext.close().catch(() => {});
      this._micContext = null;
    }
  }

  /**
   * Enqueue PCM audio data for playback
   * @param {string} base64Data - Base64 encoded PCM int16 24kHz data
   */
  enqueueAudio(base64Data) {
    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    this._playbackQueue.push(bytes.buffer);
    if (!this._isPlaying) {
      this._playNext();
    }
  }

  /**
   * Play next chunk from the queue
   */
  _playNext() {
    if (this._playbackQueue.length === 0) {
      this._isPlaying = false;
      return;
    }
    this._isPlaying = true;

    // Use a dedicated playback context at 24kHz
    if (!this._playbackContext || this._playbackContext.state === 'closed') {
      this._playbackContext = new AudioContext({ sampleRate: this._playbackSampleRate });
    }

    // Resume if suspended (iOS)
    if (this._playbackContext.state === 'suspended') {
      this._playbackContext.resume();
    }

    const pcmBuffer = this._playbackQueue.shift();
    const int16Array = new Int16Array(pcmBuffer);
    const float32Array = new Float32Array(int16Array.length);

    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768;
    }

    const audioBuffer = this._playbackContext.createBuffer(1, float32Array.length, this._playbackSampleRate);
    audioBuffer.getChannelData(0).set(float32Array);

    this._currentSource = this._playbackContext.createBufferSource();
    this._currentSource.buffer = audioBuffer;
    this._currentSource.connect(this._playbackContext.destination);
    this._currentSource.onended = () => {
      this._currentSource = null;
      this._playNext();
    };
    this._currentSource.start();
  }

  /**
   * Clear playback queue and stop current playback (for interruption handling)
   */
  clearPlayback() {
    this._playbackQueue = [];
    if (this._currentSource) {
      try { this._currentSource.stop(); } catch (e) { /* ignore */ }
      this._currentSource = null;
    }
    this._isPlaying = false;
  }
}
