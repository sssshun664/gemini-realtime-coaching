// This file is loaded as an AudioWorklet module.
// It captures raw PCM samples from the microphone and posts them to the main thread.

class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferSize = 2400; // ~150ms at 16kHz (after downsampling from 48kHz)
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0]; // mono channel, Float32 samples at sampleRate (usually 48kHz)

    // Downsample from sampleRate to 16kHz
    const ratio = sampleRate / 16000;
    for (let i = 0; i < channelData.length; i += ratio) {
      const idx = Math.floor(i);
      if (idx < channelData.length) {
        // Convert float32 [-1, 1] to int16 [-32768, 32767]
        let sample = channelData[idx];
        sample = Math.max(-1, Math.min(1, sample));
        this._buffer.push(sample * 32767);
      }
    }

    // When buffer is full, send it
    if (this._buffer.length >= this._bufferSize) {
      const pcmData = new Int16Array(this._buffer.splice(0, this._bufferSize));
      this.port.postMessage(pcmData.buffer, [pcmData.buffer]);
    }

    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
