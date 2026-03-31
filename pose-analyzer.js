/**
 * PoseAnalyzer - MediaPipe Pose Landmarker integration
 *
 * Handles:
 * - Loading MediaPipe via dynamic import
 * - Real-time landmark collection during recording
 * - Skeleton overlay drawing on canvas
 * - Event-driven updates (rep detected, form issue) instead of timed polling
 * - Metric extraction per exercise (push-ups, squats, sit-ups)
 */

const POSE_LANDMARKS = {
  NOSE: 0,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
  LEFT_HEEL: 29, RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31, RIGHT_FOOT_INDEX: 32
};

/** Skeleton connections for drawing */
const POSE_CONNECTIONS = [
  [11, 12],           // shoulders
  [11, 13], [13, 15], // left arm
  [12, 14], [14, 16], // right arm
  [11, 23], [12, 24], // torso sides
  [23, 24],           // hips
  [23, 25], [25, 27], // left leg
  [24, 26], [26, 28], // right leg
  [27, 29], [28, 30], // ankles to heels
  [27, 31], [28, 32], // ankles to feet
];

class PoseAnalyzer {
  constructor() {
    this._poseLandmarker = null;
    this._isReady = false;
    this._isCollecting = false;
    this._frames = [];
    this._collectIntervalId = null;
    this._videoElement = null;
    this._overlayCanvas = null;
    this._overlayCtx = null;
    this._loadError = null;
    this._currentExercise = null;
    this._collectStartTime = null;

    // Event-driven real-time feedback
    this._realtimeCallback = null;
    this._prevRepCount = 0;
    this._prevFormOk = true;
    this._lastUpdateTime = 0;
  }

  get isReady() { return this._isReady; }
  get isCollecting() { return this._isCollecting; }
  get frameCount() { return this._frames.length; }
  get loadError() { return this._loadError; }

  /**
   * Initialize MediaPipe Pose Landmarker via dynamic import
   */
  async init(videoElement) {
    this._videoElement = videoElement;
    try {
      console.log('[PoseAnalyzer] Loading MediaPipe...');
      const vision = await import(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs'
      );
      const filesetResolver = await vision.FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm'
      );
      this._poseLandmarker = await vision.PoseLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
          delegate: 'GPU'
        },
        numPoses: 1,
        runningMode: 'VIDEO'
      });
      this._isReady = true;
      console.log('[PoseAnalyzer] MediaPipe initialized successfully');
    } catch (err) {
      console.error('[PoseAnalyzer] Failed to initialize:', err);
      this._loadError = err;
    }
  }

  /**
   * Set overlay canvas for skeleton drawing
   */
  setOverlayCanvas(canvas) {
    this._overlayCanvas = canvas;
    this._overlayCtx = canvas ? canvas.getContext('2d') : null;
  }

  /**
   * Set callback for event-driven real-time updates
   * Called only when: new rep detected, form issue detected, or periodic (10s)
   */
  setRealtimeCallback(callback) {
    this._realtimeCallback = callback;
  }

  /**
   * Start collecting pose landmarks
   */
  startCollecting(exercise, fps = 8) {
    if (!this._isReady || !this._videoElement) return false;

    this._currentExercise = exercise;
    this._frames = [];
    this._isCollecting = true;
    this._collectStartTime = Date.now();
    this._prevRepCount = 0;
    this._prevFormOk = true;
    this._lastUpdateTime = Date.now();

    const intervalMs = Math.round(1000 / fps);
    this._collectIntervalId = setInterval(() => {
      this._captureFrame();
    }, intervalMs);

    console.log(`[PoseAnalyzer] Started collecting (${exercise}, ${fps} FPS)`);
    return true;
  }

  /**
   * Stop collecting and return frame count
   */
  stopCollecting() {
    if (this._collectIntervalId) {
      clearInterval(this._collectIntervalId);
      this._collectIntervalId = null;
    }
    this._isCollecting = false;
    this._clearOverlay();
    const count = this._frames.length;
    console.log(`[PoseAnalyzer] Stopped. Collected ${count} frames`);
    return count;
  }

  /**
   * Detect pose and store landmarks, draw overlay, check for events
   */
  _captureFrame() {
    if (!this._poseLandmarker || !this._videoElement) return;
    if (this._videoElement.readyState < 2) return;

    try {
      const result = this._poseLandmarker.detectForVideo(
        this._videoElement,
        performance.now()
      );
      if (result.landmarks && result.landmarks.length > 0) {
        const frame = {
          timestamp: Date.now(),
          landmarks: result.landmarks[0],
          worldLandmarks: result.worldLandmarks ? result.worldLandmarks[0] : null
        };
        this._frames.push(frame);

        // Draw skeleton overlay
        this._drawSkeleton(frame.landmarks);

        // Check for events to notify (event-driven, not every frame)
        this._checkRealtimeEvents();
      }
    } catch (err) {
      // Silently skip
    }
  }

  // ======================================================================
  // Skeleton Overlay Drawing
  // ======================================================================

  _drawSkeleton(landmarks) {
    if (!this._overlayCanvas || !this._overlayCtx) return;

    const canvas = this._overlayCanvas;
    const ctx = this._overlayCtx;
    const vw = this._videoElement.videoWidth;
    const vh = this._videoElement.videoHeight;

    if (!vw || !vh) return;

    // Match canvas size to video display size
    const rect = this._videoElement.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Compute scale factors (video might be cropped via object-fit: cover)
    const videoAspect = vw / vh;
    const displayAspect = rect.width / rect.height;
    let scaleX, scaleY, offsetX = 0, offsetY = 0;

    if (videoAspect > displayAspect) {
      // Video is wider — cropped horizontally
      scaleY = rect.height;
      scaleX = rect.height * videoAspect;
      offsetX = (rect.width - scaleX) / 2;
    } else {
      // Video is taller — cropped vertically
      scaleX = rect.width;
      scaleY = rect.width / videoAspect;
      offsetY = (rect.height - scaleY) / 2;
    }

    const toX = (lm) => offsetX + lm.x * scaleX;
    const toY = (lm) => offsetY + lm.y * scaleY;

    // Draw connections
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.7)';
    ctx.lineWidth = 2;
    for (const [i, j] of POSE_CONNECTIONS) {
      if (landmarks[i].visibility > 0.5 && landmarks[j].visibility > 0.5) {
        ctx.beginPath();
        ctx.moveTo(toX(landmarks[i]), toY(landmarks[i]));
        ctx.lineTo(toX(landmarks[j]), toY(landmarks[j]));
        ctx.stroke();
      }
    }

    // Draw landmark dots
    ctx.fillStyle = 'rgba(34, 197, 94, 0.9)';
    for (let k = 0; k < landmarks.length; k++) {
      if (landmarks[k].visibility > 0.5) {
        ctx.beginPath();
        ctx.arc(toX(landmarks[k]), toY(landmarks[k]), 3, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  }

  _clearOverlay() {
    if (this._overlayCanvas && this._overlayCtx) {
      this._overlayCtx.clearRect(0, 0, this._overlayCanvas.width, this._overlayCanvas.height);
    }
  }

  // ======================================================================
  // Event-Driven Real-time Updates
  // ======================================================================

  _checkRealtimeEvents() {
    if (!this._realtimeCallback || this._frames.length < 10) return;

    const now = Date.now();
    const exercise = this._currentExercise;
    const L = POSE_LANDMARKS;

    // Compute current rep count
    const allLm = this._frames.map(f => f.worldLandmarks || f.landmarks);
    let repSeries;
    let flexT, extT;

    switch (exercise) {
      case '腕立て伏せ':
        repSeries = allLm.map(l => (
          this._angle(l[L.LEFT_SHOULDER], l[L.LEFT_ELBOW], l[L.LEFT_WRIST]) +
          this._angle(l[L.RIGHT_SHOULDER], l[L.RIGHT_ELBOW], l[L.RIGHT_WRIST])
        ) / 2);
        flexT = 110; extT = 140;
        break;
      case 'スクワット':
        repSeries = allLm.map(l => (
          this._angle(l[L.LEFT_HIP], l[L.LEFT_KNEE], l[L.LEFT_ANKLE]) +
          this._angle(l[L.RIGHT_HIP], l[L.RIGHT_KNEE], l[L.RIGHT_ANKLE])
        ) / 2);
        flexT = 120; extT = 150;
        break;
      case '腹筋':
        repSeries = allLm.map(l => (
          this._angle(l[L.LEFT_SHOULDER], l[L.LEFT_HIP], l[L.LEFT_KNEE]) +
          this._angle(l[L.RIGHT_SHOULDER], l[L.RIGHT_HIP], l[L.RIGHT_KNEE])
        ) / 2);
        flexT = 90; extT = 120;
        break;
      default:
        return;
    }

    const currentReps = this._countReps(repSeries, flexT, extT);

    // Check form quality (body alignment for push-ups, back angle for squats)
    let formOk = true;
    if (exercise === '腕立て伏せ') {
      const last = allLm[allLm.length - 1];
      const bodyAlign = (
        this._angle(last[L.LEFT_SHOULDER], last[L.LEFT_HIP], last[L.LEFT_ANKLE]) +
        this._angle(last[L.RIGHT_SHOULDER], last[L.RIGHT_HIP], last[L.RIGHT_ANKLE])
      ) / 2;
      formOk = bodyAlign > 160; // Body should be roughly straight
    } else if (exercise === 'スクワット') {
      const last = allLm[allLm.length - 1];
      const sMid = this._mid(last[L.LEFT_SHOULDER], last[L.RIGHT_SHOULDER]);
      const hMid = this._mid(last[L.LEFT_HIP], last[L.RIGHT_HIP]);
      const backAngle = Math.abs(Math.atan2(sMid.x - hMid.x, hMid.y - sMid.y) * 180 / Math.PI);
      formOk = backAngle < 45; // Not too much forward lean
    }

    // Decide whether to send an update
    let shouldSend = false;
    let message = '';

    // Event 1: New rep completed
    if (currentReps > this._prevRepCount) {
      shouldSend = true;
      message = `${currentReps}レップ完了`;
      if (!formOk) {
        message += ' (フォーム注意)';
      }
      this._prevRepCount = currentReps;
    }

    // Event 2: Form deteriorated
    if (this._prevFormOk && !formOk) {
      shouldSend = true;
      if (!message) {
        message = `フォーム注意`;
        if (exercise === '腕立て伏せ') message += ': 体幹が曲がっています';
        if (exercise === 'スクワット') message += ': 前傾しすぎです';
      }
      this._prevFormOk = false;
    } else if (formOk) {
      this._prevFormOk = true;
    }

    // Event 3: Periodic fallback (every 15 seconds if no other events)
    if (!shouldSend && (now - this._lastUpdateTime) > 15000) {
      shouldSend = true;
      const lastAngle = repSeries[repSeries.length - 1];
      message = `${currentReps}レップ 現在角度${this._r(lastAngle)}°`;
    }

    if (shouldSend) {
      this._lastUpdateTime = now;
      const text = `【姿勢データ】${exercise}: ${message}`;
      console.log(`[PoseAnalyzer] Event: ${text}`);
      this._realtimeCallback(text);
    }
  }

  // ======================================================================
  // Metrics Summary (called by ToolHandler when analyze_form is triggered)
  // ======================================================================

  getMetricsSummary(exerciseName) {
    const exercise = exerciseName || this._currentExercise;
    const duration = this._collectStartTime
      ? Math.round((Date.now() - this._collectStartTime) / 1000)
      : 0;

    if (this._frames.length < 5) {
      return {
        exercise,
        status: 'insufficient_data',
        frame_count: this._frames.length,
        duration_seconds: duration,
        message: 'ランドマーク検出フレーム数が不足しています（5フレーム未満）'
      };
    }

    const frameLandmarks = this._frames.map(f => f.worldLandmarks || f.landmarks);

    switch (exercise) {
      case '腕立て伏せ': return this._pushUpMetrics(frameLandmarks, duration);
      case 'スクワット': return this._squatMetrics(frameLandmarks, duration);
      case '腹筋':       return this._sitUpMetrics(frameLandmarks, duration);
      default:           return this._genericMetrics(frameLandmarks, exercise, duration);
    }
  }

  _pushUpMetrics(frames, duration) {
    const L = POSE_LANDMARKS;
    const elbowL = [], elbowR = [], bodyAlign = [];

    for (const lm of frames) {
      elbowL.push(this._angle(lm[L.LEFT_SHOULDER], lm[L.LEFT_ELBOW], lm[L.LEFT_WRIST]));
      elbowR.push(this._angle(lm[L.RIGHT_SHOULDER], lm[L.RIGHT_ELBOW], lm[L.RIGHT_WRIST]));
      const al = this._angle(lm[L.LEFT_SHOULDER], lm[L.LEFT_HIP], lm[L.LEFT_ANKLE]);
      const ar = this._angle(lm[L.RIGHT_SHOULDER], lm[L.RIGHT_HIP], lm[L.RIGHT_ANKLE]);
      bodyAlign.push((al + ar) / 2);
    }

    const avgElbow = elbowL.map((l, i) => (l + elbowR[i]) / 2);

    return {
      exercise: '腕立て伏せ',
      rep_count: this._countReps(avgElbow, 110, 140),
      duration_seconds: duration,
      total_frames: frames.length,
      metrics: {
        elbow_angle_min_avg: this._r(this._min(avgElbow)),
        elbow_angle_max_avg: this._r(this._max(avgElbow)),
        body_alignment_avg: this._r(this._avg(bodyAlign)),
        body_alignment_min: this._r(this._min(bodyAlign)),
        left_right_elbow_diff_avg: this._r(
          this._avg(elbowL.map((l, i) => Math.abs(l - elbowR[i])))
        )
      }
    };
  }

  _squatMetrics(frames, duration) {
    const L = POSE_LANDMARKS;
    const kneeL = [], kneeR = [], backAngles = [], kneeTracking = [];

    for (const lm of frames) {
      kneeL.push(this._angle(lm[L.LEFT_HIP], lm[L.LEFT_KNEE], lm[L.LEFT_ANKLE]));
      kneeR.push(this._angle(lm[L.RIGHT_HIP], lm[L.RIGHT_KNEE], lm[L.RIGHT_ANKLE]));
      const sMid = this._mid(lm[L.LEFT_SHOULDER], lm[L.RIGHT_SHOULDER]);
      const hMid = this._mid(lm[L.LEFT_HIP], lm[L.RIGHT_HIP]);
      backAngles.push(Math.abs(Math.atan2(sMid.x - hMid.x, hMid.y - sMid.y) * 180 / Math.PI));
      const dL = Math.abs(lm[L.LEFT_KNEE].x - lm[L.LEFT_ANKLE].x);
      const dR = Math.abs(lm[L.RIGHT_KNEE].x - lm[L.RIGHT_ANKLE].x);
      kneeTracking.push((dL + dR) / 2);
    }

    const avgKnee = kneeL.map((l, i) => (l + kneeR[i]) / 2);

    return {
      exercise: 'スクワット',
      rep_count: this._countReps(avgKnee, 120, 150),
      duration_seconds: duration,
      total_frames: frames.length,
      metrics: {
        knee_angle_min_avg: this._r(this._min(avgKnee)),
        knee_angle_max_avg: this._r(this._max(avgKnee)),
        back_angle_avg: this._r(this._avg(backAngles)),
        back_angle_max: this._r(this._max(backAngles)),
        knee_tracking_deviation_avg: this._r(this._avg(kneeTracking) * 100),
        left_right_knee_diff_avg: this._r(
          this._avg(kneeL.map((l, i) => Math.abs(l - kneeR[i])))
        )
      }
    };
  }

  _sitUpMetrics(frames, duration) {
    const L = POSE_LANDMARKS;
    const hipL = [], hipR = [], torsoAngles = [];

    for (const lm of frames) {
      hipL.push(this._angle(lm[L.LEFT_SHOULDER], lm[L.LEFT_HIP], lm[L.LEFT_KNEE]));
      hipR.push(this._angle(lm[L.RIGHT_SHOULDER], lm[L.RIGHT_HIP], lm[L.RIGHT_KNEE]));
      const sMid = this._mid(lm[L.LEFT_SHOULDER], lm[L.RIGHT_SHOULDER]);
      const hMid = this._mid(lm[L.LEFT_HIP], lm[L.RIGHT_HIP]);
      torsoAngles.push(Math.abs(Math.atan2(sMid.y - hMid.y, sMid.x - hMid.x) * 180 / Math.PI));
    }

    const avgHip = hipL.map((l, i) => (l + hipR[i]) / 2);

    return {
      exercise: '腹筋',
      rep_count: this._countReps(avgHip, 90, 120),
      duration_seconds: duration,
      total_frames: frames.length,
      metrics: {
        hip_angle_min_avg: this._r(this._min(avgHip)),
        hip_angle_max_avg: this._r(this._max(avgHip)),
        torso_angle_min: this._r(this._min(torsoAngles)),
        torso_angle_max: this._r(this._max(torsoAngles)),
        left_right_hip_diff_avg: this._r(
          this._avg(hipL.map((l, i) => Math.abs(l - hipR[i])))
        )
      }
    };
  }

  _genericMetrics(frames, exercise, duration) {
    const L = POSE_LANDMARKS;
    const shoulderSym = [], hipSym = [];
    for (const lm of frames) {
      shoulderSym.push(Math.abs(lm[L.LEFT_SHOULDER].y - lm[L.RIGHT_SHOULDER].y));
      hipSym.push(Math.abs(lm[L.LEFT_HIP].y - lm[L.RIGHT_HIP].y));
    }
    return {
      exercise,
      rep_count: 0,
      duration_seconds: duration,
      total_frames: frames.length,
      metrics: {
        shoulder_symmetry_avg: this._r(this._avg(shoulderSym) * 100),
        hip_symmetry_avg: this._r(this._avg(hipSym) * 100),
        note: 'この種目の詳細な解析パラメータは未設定です。'
      }
    };
  }

  // ======================================================================
  // Utility
  // ======================================================================

  _angle(a, b, c) {
    const ba = { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) };
    const bc = { x: c.x - b.x, y: c.y - b.y, z: (c.z || 0) - (b.z || 0) };
    const dot = ba.x * bc.x + ba.y * bc.y + ba.z * bc.z;
    const magA = Math.sqrt(ba.x ** 2 + ba.y ** 2 + ba.z ** 2);
    const magC = Math.sqrt(bc.x ** 2 + bc.y ** 2 + bc.z ** 2);
    if (magA === 0 || magC === 0) return 0;
    return Math.acos(Math.max(-1, Math.min(1, dot / (magA * magC)))) * 180 / Math.PI;
  }

  _mid(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2 };
  }

  _countReps(series, flexThreshold, extendThreshold) {
    let reps = 0, flexed = false;
    for (const v of series) {
      if (!flexed && v < flexThreshold) flexed = true;
      else if (flexed && v > extendThreshold) { reps++; flexed = false; }
    }
    return reps;
  }

  _avg(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
  _min(a) { return a.length ? Math.min(...a) : 0; }
  _max(a) { return a.length ? Math.max(...a) : 0; }
  _r(n) { return Math.round(n * 10) / 10; }
}
