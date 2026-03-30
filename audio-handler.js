/**
 * AudioHandler - Manages microphone input (PCM 16kHz 16-bit) and audio output playback (PCM 24kHz 16-bit)
 */
class AudioHandler {
  constructor() {
    this._audioContext = null;
    this._micStream = null;
    this._workletNode = null;
    this._onAudioData = null;

    // Playback
    this._playbackQueue = [];
    this._isPlaying = false;
    this._playbackSampleRate = 24000;
    this._currentSource = null;
  }

  /**
   * Initialize microphone capture with AudioWorklet
   * @param {Function} onAudioData - Callback receiving ArrayBuffer of PCM int16 data
   */
  async startMic(onAudioData) {
    this._onAudioData = onAudioData;

    // Request microphone
    this._micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: { ideal: 48000 },
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    this._audioContext = new AudioContext({ sampleRate: 48000 });

    // Load AudioWorklet
    const workletBlob = new Blob([`
      class PCMProcessor extends AudioWorkletProcessor {
        constructor() {
          super();
          this._buffer = [];
          this._bufferSize = 2400;
        }
        process(inputs) {
          const input = inputs[0];
          if (!input || !input[0]) return true;
          const channelData = input[0];
          const ratio = sampleRate / 16000;
          for (let i = 0; i < channelData.length; i += ratio) {
            const idx = Math.floor(i);
            if (idx < channelData.length) {
              let sample = channelData[idx];
              sample = Math.max(-1, Math.min(1, sample));
              this._buffer.push(sample * 32767);
            }
          }
          if (this._buffer.length >= this._bufferSize) {
            const pcmData = new Int16Array(this._buffer.splice(0, this._bufferSize));
            this.port.postMessage(pcmData.buffer, [pcmData.buffer]);
          }
          return true;
        }
      }
      registerProcessor('pcm-processor', PCMProcessor);
    `], { type: 'application/javascript' });

    const workletUrl = URL.createObjectURL(workletBlob);
    await this._audioContext.audioWorklet.addModule(workletUrl);
    URL.revokeObjectURL(workletUrl);

    const source = this._audioContext.createMediaStreamSource(this._micStream);
    this._workletNode = new AudioWorkletNode(this._audioContext, 'pcm-processor');

    this._workletNode.port.onmessage = (event) => {
      if (this._onAudioData) {
        this._onAudioData(event.data);
      }
    };

    source.connect(this._workletNode);
    // Don't connect to destination (we don't want to hear ourselves)
  }

  /**
   * Stop microphone capture
   */
  stopMic() {
    if (this._workletNode) {
      this._workletNode.disconnect();
      this._workletNode = null;
    }
    if (this._micStream) {
      this._micStream.getTracks().forEach(t => t.stop());
      this._micStream = null;
    }
    if (this._audioContext) {
      this._audioContext.close();
      this._audioContext = null;
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

    // Ensure we have an AudioContext for playback
    if (!this._audioContext || this._audioContext.state === 'closed') {
      this._audioContext = new AudioContext({ sampleRate: this._playbackSampleRate });
    }

    const pcmBuffer = this._playbackQueue.shift();
    const int16Array = new Int16Array(pcmBuffer);
    const float32Array = new Float32Array(int16Array.length);

    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768;
    }

    const audioBuffer = this._audioContext.createBuffer(1, float32Array.length, this._playbackSampleRate);
    audioBuffer.getChannelData(0).set(float32Array);

    this._currentSource = this._audioContext.createBufferSource();
    this._currentSource.buffer = audioBuffer;
    this._currentSource.connect(this._audioContext.destination);
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

  /**
   * Get the mic MediaStream (for video recorder to use same permissions context)
   */
  getMicStream() {
    return this._micStream;
  }
}
