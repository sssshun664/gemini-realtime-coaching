/**
 * PoseAnalyzer - MediaPipe Pose Landmarker integration
 *
 * Handles:
 * - Loading MediaPipe via dynamic import
 * - Real-time landmark collection during recording
 * - Metric extraction per exercise (push-ups, squats, sit-ups)
 * - Real-time summary for live coaching feedback
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

class PoseAnalyzer {
  constructor() {
    this._poseLandmarker = null;
    this._isReady = false;
    this._isCollecting = false;
    this._frames = [];
    this._collectIntervalId = null;
    this._realtimeIntervalId = null;
    this._videoElement = null;
    this._loadError = null;
    this._realtimeCallback = null;
    this._currentExercise = null;
    this._collectStartTime = null;
  }

  get isReady() { return this._isReady; }
  get isCollecting() { return this._isCollecting; }
  get frameCount() { return this._frames.length; }
  get loadError() { return this._loadError; }

  /**
   * Initialize MediaPipe Pose Landmarker via dynamic import
   * @param {HTMLVideoElement} videoElement - Camera preview element
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
   * Set callback for real-time metrics during collection
   * @param {Function} callback - Called with summary string every ~3 seconds
   */
  setRealtimeCallback(callback) {
    this._realtimeCallback = callback;
  }

  /**
   * Start collecting pose landmarks
   * @param {string} exercise - Exercise name
   * @param {number} fps - Detection frequency (default 8)
   * @returns {boolean} success
   */
  startCollecting(exercise, fps = 8) {
    if (!this._isReady || !this._videoElement) return false;

    this._currentExercise = exercise;
    this._frames = [];
    this._isCollecting = true;
    this._collectStartTime = Date.now();

    const intervalMs = Math.round(1000 / fps);
    this._collectIntervalId = setInterval(() => {
      this._captureFrame();
    }, intervalMs);

    // Send real-time metrics every 3 seconds
    if (this._realtimeCallback) {
      this._realtimeIntervalId = setInterval(() => {
        const summary = this._computeRealtimeSummary();
        if (summary) {
          this._realtimeCallback(summary);
        }
      }, 3000);
    }

    console.log(`[PoseAnalyzer] Started collecting (${exercise}, ${fps} FPS)`);
    return true;
  }

  /**
   * Stop collecting and return frame count
   * @returns {number} collected frame count
   */
  stopCollecting() {
    if (this._collectIntervalId) {
      clearInterval(this._collectIntervalId);
      this._collectIntervalId = null;
    }
    if (this._realtimeIntervalId) {
      clearInterval(this._realtimeIntervalId);
      this._realtimeIntervalId = null;
    }
    this._isCollecting = false;
    const count = this._frames.length;
    console.log(`[PoseAnalyzer] Stopped. Collected ${count} frames`);
    return count;
  }

  /**
   * Detect pose in current video frame and store landmarks
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
        this._frames.push({
          timestamp: Date.now(),
          landmarks: result.landmarks[0],
          worldLandmarks: result.worldLandmarks ? result.worldLandmarks[0] : null
        });
      }
    } catch (err) {
      // Silently skip failed frames
    }
  }

  // ======================================================================
  // Metrics Summary (called by ToolHandler when analyze_form is triggered)
  // ======================================================================

  /**
   * Extract metrics summary from all collected frames
   * @param {string} exerciseName
   * @returns {Object} metrics summary
   */
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

    // Prefer worldLandmarks (3D meters) for accurate angle calculation
    const frameLandmarks = this._frames.map(f => f.worldLandmarks || f.landmarks);

    switch (exercise) {
      case '腕立て伏せ': return this._pushUpMetrics(frameLandmarks, duration);
      case 'スクワット': return this._squatMetrics(frameLandmarks, duration);
      case '腹筋':       return this._sitUpMetrics(frameLandmarks, duration);
      default:           return this._genericMetrics(frameLandmarks, exercise, duration);
    }
  }

  // ===== Push-Up Metrics =====
  _pushUpMetrics(frames, duration) {
    const L = POSE_LANDMARKS;
    const elbowL = [], elbowR = [], bodyAlign = [];

    for (const lm of frames) {
      elbowL.push(this._angle(lm[L.LEFT_SHOULDER], lm[L.LEFT_ELBOW], lm[L.LEFT_WRIST]));
      elbowR.push(this._angle(lm[L.RIGHT_SHOULDER], lm[L.RIGHT_ELBOW], lm[L.RIGHT_WRIST]));
      const alignL = this._angle(lm[L.LEFT_SHOULDER], lm[L.LEFT_HIP], lm[L.LEFT_ANKLE]);
      const alignR = this._angle(lm[L.RIGHT_SHOULDER], lm[L.RIGHT_HIP], lm[L.RIGHT_ANKLE]);
      bodyAlign.push((alignL + alignR) / 2);
    }

    const avgElbow = elbowL.map((l, i) => (l + elbowR[i]) / 2);
    const repCount = this._countReps(avgElbow, 110, 140);

    return {
      exercise: '腕立て伏せ',
      rep_count: repCount,
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

  // ===== Squat Metrics =====
  _squatMetrics(frames, duration) {
    const L = POSE_LANDMARKS;
    const kneeL = [], kneeR = [], backAngles = [], kneeTracking = [];

    for (const lm of frames) {
      kneeL.push(this._angle(lm[L.LEFT_HIP], lm[L.LEFT_KNEE], lm[L.LEFT_ANKLE]));
      kneeR.push(this._angle(lm[L.RIGHT_HIP], lm[L.RIGHT_KNEE], lm[L.RIGHT_ANKLE]));

      // Back forward-lean: angle from vertical of shoulder→hip line
      const sMid = this._mid(lm[L.LEFT_SHOULDER], lm[L.RIGHT_SHOULDER]);
      const hMid = this._mid(lm[L.LEFT_HIP], lm[L.RIGHT_HIP]);
      backAngles.push(Math.abs(
        Math.atan2(sMid.x - hMid.x, hMid.y - sMid.y) * 180 / Math.PI
      ));

      // Knee tracking: knee-ankle x-offset (valgus indicator)
      const dL = Math.abs(lm[L.LEFT_KNEE].x - lm[L.LEFT_ANKLE].x);
      const dR = Math.abs(lm[L.RIGHT_KNEE].x - lm[L.RIGHT_ANKLE].x);
      kneeTracking.push((dL + dR) / 2);
    }

    const avgKnee = kneeL.map((l, i) => (l + kneeR[i]) / 2);
    const repCount = this._countReps(avgKnee, 120, 150);

    return {
      exercise: 'スクワット',
      rep_count: repCount,
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

  // ===== Sit-Up / Crunch Metrics =====
  _sitUpMetrics(frames, duration) {
    const L = POSE_LANDMARKS;
    const hipL = [], hipR = [], torsoAngles = [];

    for (const lm of frames) {
      hipL.push(this._angle(lm[L.LEFT_SHOULDER], lm[L.LEFT_HIP], lm[L.LEFT_KNEE]));
      hipR.push(this._angle(lm[L.RIGHT_SHOULDER], lm[L.RIGHT_HIP], lm[L.RIGHT_KNEE]));

      const sMid = this._mid(lm[L.LEFT_SHOULDER], lm[L.RIGHT_SHOULDER]);
      const hMid = this._mid(lm[L.LEFT_HIP], lm[L.RIGHT_HIP]);
      torsoAngles.push(Math.abs(
        Math.atan2(sMid.y - hMid.y, sMid.x - hMid.x) * 180 / Math.PI
      ));
    }

    const avgHip = hipL.map((l, i) => (l + hipR[i]) / 2);
    const repCount = this._countReps(avgHip, 90, 120);

    return {
      exercise: '腹筋',
      rep_count: repCount,
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

  // ===== Generic (unknown exercise) =====
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
        note: 'この種目の詳細な解析パラメータは未設定です。基本的な姿勢データのみ取得しました。'
      }
    };
  }

  // ======================================================================
  // Real-time Summary (sent to Live API during exercise)
  // ======================================================================

  _computeRealtimeSummary() {
    if (this._frames.length < 3) return null;

    const exercise = this._currentExercise;
    const L = POSE_LANDMARKS;

    // Current values from latest frame
    const last = this._frames[this._frames.length - 1];
    const lm = last.worldLandmarks || last.landmarks;

    // Accumulated rep count from all frames
    const allLm = this._frames.map(f => f.worldLandmarks || f.landmarks);
    let summary = '';

    switch (exercise) {
      case '腕立て伏せ': {
        const elbow = this._r((
          this._angle(lm[L.LEFT_SHOULDER], lm[L.LEFT_ELBOW], lm[L.LEFT_WRIST]) +
          this._angle(lm[L.RIGHT_SHOULDER], lm[L.RIGHT_ELBOW], lm[L.RIGHT_WRIST])
        ) / 2);
        const body = this._r((
          this._angle(lm[L.LEFT_SHOULDER], lm[L.LEFT_HIP], lm[L.LEFT_ANKLE]) +
          this._angle(lm[L.RIGHT_SHOULDER], lm[L.RIGHT_HIP], lm[L.RIGHT_ANKLE])
        ) / 2);
        const elbowSeries = allLm.map(l => (
          this._angle(l[L.LEFT_SHOULDER], l[L.LEFT_ELBOW], l[L.LEFT_WRIST]) +
          this._angle(l[L.RIGHT_SHOULDER], l[L.RIGHT_ELBOW], l[L.RIGHT_WRIST])
        ) / 2);
        const reps = this._countReps(elbowSeries, 110, 140);
        summary = `肘角度${elbow}° 体幹${body}° ${reps}レップ`;
        break;
      }
      case 'スクワット': {
        const knee = this._r((
          this._angle(lm[L.LEFT_HIP], lm[L.LEFT_KNEE], lm[L.LEFT_ANKLE]) +
          this._angle(lm[L.RIGHT_HIP], lm[L.RIGHT_KNEE], lm[L.RIGHT_ANKLE])
        ) / 2);
        const sMid = this._mid(lm[L.LEFT_SHOULDER], lm[L.RIGHT_SHOULDER]);
        const hMid = this._mid(lm[L.LEFT_HIP], lm[L.RIGHT_HIP]);
        const back = this._r(Math.abs(
          Math.atan2(sMid.x - hMid.x, hMid.y - sMid.y) * 180 / Math.PI
        ));
        const kneeSeries = allLm.map(l => (
          this._angle(l[L.LEFT_HIP], l[L.LEFT_KNEE], l[L.LEFT_ANKLE]) +
          this._angle(l[L.RIGHT_HIP], l[L.RIGHT_KNEE], l[L.RIGHT_ANKLE])
        ) / 2);
        const reps = this._countReps(kneeSeries, 120, 150);
        summary = `膝角度${knee}° 背中${back}° ${reps}レップ`;
        break;
      }
      case '腹筋': {
        const hip = this._r((
          this._angle(lm[L.LEFT_SHOULDER], lm[L.LEFT_HIP], lm[L.LEFT_KNEE]) +
          this._angle(lm[L.RIGHT_SHOULDER], lm[L.RIGHT_HIP], lm[L.RIGHT_KNEE])
        ) / 2);
        const hipSeries = allLm.map(l => (
          this._angle(l[L.LEFT_SHOULDER], l[L.LEFT_HIP], l[L.LEFT_KNEE]) +
          this._angle(l[L.RIGHT_SHOULDER], l[L.RIGHT_HIP], l[L.RIGHT_KNEE])
        ) / 2);
        const reps = this._countReps(hipSeries, 90, 120);
        summary = `股関節${hip}° ${reps}レップ`;
        break;
      }
      default:
        summary = `${this._frames.length}フレーム取得中`;
    }

    return `【姿勢データ】${exercise}: ${summary}`;
  }

  // ======================================================================
  // Utility
  // ======================================================================

  /** Angle at point b (degrees) */
  _angle(a, b, c) {
    const ba = { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) };
    const bc = { x: c.x - b.x, y: c.y - b.y, z: (c.z || 0) - (b.z || 0) };
    const dot = ba.x * bc.x + ba.y * bc.y + ba.z * bc.z;
    const magA = Math.sqrt(ba.x ** 2 + ba.y ** 2 + ba.z ** 2);
    const magC = Math.sqrt(bc.x ** 2 + bc.y ** 2 + bc.z ** 2);
    if (magA === 0 || magC === 0) return 0;
    return Math.acos(Math.max(-1, Math.min(1, dot / (magA * magC)))) * 180 / Math.PI;
  }

  /** Midpoint of two landmarks */
  _mid(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2 };
  }

  /**
   * Count reps from an angle time series using hysteresis
   * A rep = angle drops below flexThreshold, then rises above extendThreshold
   */
  _countReps(series, flexThreshold, extendThreshold) {
    let reps = 0;
    let flexed = false;
    for (const v of series) {
      if (!flexed && v < flexThreshold) {
        flexed = true;
      } else if (flexed && v > extendThreshold) {
        reps++;
        flexed = false;
      }
    }
    return reps;
  }

  _avg(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
  _min(a) { return a.length ? Math.min(...a) : 0; }
  _max(a) { return a.length ? Math.max(...a) : 0; }
  _r(n) { return Math.round(n * 10) / 10; }
}
