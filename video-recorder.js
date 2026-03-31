/**
 * VideoRecorder - Manages camera preview, camera switching, and MP4 recording
 * Optimized for iPhone Safari
 */
class VideoRecorder {
  constructor() {
    this._stream = null;
    this._mediaRecorder = null;
    this._chunks = [];
    this._isRecording = false;
    this._previewEl = null;
    this._captureCanvas = null;
    this._captureCtx = null;
    this._frameInterval = null;
    this._facingMode = 'user'; // Default to front camera for self-view
  }

  /**
   * Start camera preview
   * @param {HTMLVideoElement} videoElement
   */
  async startPreview(videoElement) {
    this._previewEl = videoElement;
    return this._openCamera();
  }

  /**
   * Toggle between front and rear camera
   * @returns {Promise<boolean>} success
   */
  async toggleCamera() {
    this._facingMode = this._facingMode === 'user' ? 'environment' : 'user';

    // Stop current stream
    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop());
      this._stream = null;
    }

    const ok = await this._openCamera();
    console.log(`[VideoRecorder] Camera switched to ${this._facingMode} (${ok ? 'ok' : 'failed'})`);
    return ok;
  }

  /**
   * Open camera with current facingMode
   */
  async _openCamera() {
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: this._facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      if (this._previewEl) {
        this._previewEl.srcObject = this._stream;
        await this._previewEl.play();
      }
      return true;
    } catch (err) {
      console.warn('[VideoRecorder] Camera access failed:', err);
      return false;
    }
  }

  /**
   * Stop camera preview
   */
  stopPreview() {
    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop());
      this._stream = null;
    }
    if (this._previewEl) {
      this._previewEl.srcObject = null;
    }
  }

  /**
   * Start recording video to MP4
   * @returns {boolean} success
   */
  startRecording() {
    if (!this._stream || this._isRecording) return false;

    this._chunks = [];

    let mimeType = 'video/mp4';
    if (typeof MediaRecorder.isTypeSupported === 'function') {
      if (MediaRecorder.isTypeSupported('video/mp4;codecs=h264')) {
        mimeType = 'video/mp4;codecs=h264';
      } else if (MediaRecorder.isTypeSupported('video/mp4')) {
        mimeType = 'video/mp4';
      } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
        mimeType = 'video/webm;codecs=vp9';
      } else if (MediaRecorder.isTypeSupported('video/webm')) {
        mimeType = 'video/webm';
      }
    }

    try {
      this._mediaRecorder = new MediaRecorder(this._stream, {
        mimeType: mimeType,
        videoBitsPerSecond: 2500000
      });
    } catch (e) {
      this._mediaRecorder = new MediaRecorder(this._stream);
    }

    this._mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this._chunks.push(event.data);
      }
    };

    this._mediaRecorder.start(1000);
    this._isRecording = true;
    return true;
  }

  /**
   * Stop recording and return the video blob
   */
  stopRecording() {
    return new Promise((resolve) => {
      if (!this._mediaRecorder || !this._isRecording) {
        resolve(null);
        return;
      }

      this._mediaRecorder.onstop = () => {
        const mimeType = this._mediaRecorder.mimeType || 'video/mp4';
        const blob = new Blob(this._chunks, { type: mimeType });
        this._chunks = [];
        this._isRecording = false;
        resolve(blob);
      };

      this._mediaRecorder.stop();
    });
  }

  /**
   * Download the recorded video
   */
  downloadVideo(blob, filename) {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `recording_${Date.now()}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Start periodic frame capture
   */
  startFrameCapture(onFrame, intervalMs = 1000) {
    if (!this._previewEl || !this._stream) return;

    this.stopFrameCapture();

    this._captureCanvas = document.createElement('canvas');
    this._captureCtx = this._captureCanvas.getContext('2d');

    this._frameInterval = setInterval(() => {
      if (!this._previewEl || this._previewEl.readyState < 2) return;

      const maxWidth = 640;
      const vw = this._previewEl.videoWidth;
      const vh = this._previewEl.videoHeight;
      if (!vw || !vh) return;

      const scale = Math.min(1, maxWidth / vw);
      this._captureCanvas.width = Math.round(vw * scale);
      this._captureCanvas.height = Math.round(vh * scale);

      this._captureCtx.drawImage(this._previewEl, 0, 0, this._captureCanvas.width, this._captureCanvas.height);

      const dataUrl = this._captureCanvas.toDataURL('image/jpeg', 0.6);
      const base64Data = dataUrl.split(',')[1];
      if (base64Data) {
        onFrame(base64Data);
      }
    }, intervalMs);

    console.log(`[VideoRecorder] Frame capture started (every ${intervalMs}ms)`);
  }

  /**
   * Stop periodic frame capture
   */
  stopFrameCapture() {
    if (this._frameInterval) {
      clearInterval(this._frameInterval);
      this._frameInterval = null;
      console.log('[VideoRecorder] Frame capture stopped');
    }
    this._captureCanvas = null;
    this._captureCtx = null;
  }

  get isRecording() { return this._isRecording; }
  get isCapturingFrames() { return this._frameInterval !== null; }
  get previewElement() { return this._previewEl; }
  get facingMode() { return this._facingMode; }
}
