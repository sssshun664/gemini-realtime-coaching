/**
 * Tools - Function Calling definitions and handlers for the fitness coaching app
 *
 * Functions:
 * - set_exercise: Set the current exercise type
 * - start_recording: Start camera recording
 * - stop_recording: Stop camera recording
 * - analyze_form: Run (dummy) skeleton analysis on recorded video
 */

const TOOL_DEFINITIONS = [
  {
    functionDeclarations: [
      {
        name: 'set_exercise',
        description: 'ユーザーが指定したトレーニング種目を現在の種目として設定します。ユーザーが特定のエクササイズ名を言った場合（例：「ベンチプレスを見て」「スクワットをやる」「デッドリフトのフォームチェック」など）にこの関数を呼び出してください。',
        parameters: {
          type: 'object',
          properties: {
            exercise_name: {
              type: 'string',
              description: 'トレーニング種目名（例：ベンチプレス、スクワット、デッドリフト、ラットプルダウン、ショルダープレス等）'
            }
          },
          required: ['exercise_name']
        }
      },
      {
        name: 'start_recording',
        description: 'カメラでトレーニングフォームの録画を開始します。ユーザーが「録画して」「撮影開始」「撮って」「録画スタート」などと言った場合に呼び出してください。',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'stop_recording',
        description: 'カメラの録画を停止します。ユーザーが「終わり」「録画止めて」「ストップ」「撮影終了」などと言った場合に呼び出してください。',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'analyze_form',
        description: '録画したトレーニング動画の骨格解析を実行し、フォームの評価を行います。ユーザーが「解析して」「フォームチェック」「分析して」「見てくれ」などと言った場合に呼び出してください。現在設定されている種目に基づいて解析パラメータが自動で切り替わります。',
        parameters: {
          type: 'object',
          properties: {
            exercise_name: {
              type: 'string',
              description: '解析対象のトレーニング種目名（set_exerciseで設定されたもの）'
            }
          },
          required: ['exercise_name']
        }
      }
    ]
  }
];

/**
 * Dummy skeleton analysis data by exercise type
 */
const DUMMY_ANALYSIS_DATA = {
  'ベンチプレス': {
    exercise: 'ベンチプレス',
    overall_score: 72,
    rep_count: 8,
    analysis: {
      elbow_angle_bottom: { value: 85, ideal: 90, unit: '度', status: 'やや狭い' },
      grip_width: { value: '肩幅の1.5倍', ideal: '肩幅の1.5〜1.8倍', status: '適正' },
      back_arch: { value: '軽度', ideal: '自然なアーチ', status: '適正' },
      bar_path: { value: '前方にブレあり', ideal: '垂直', status: '改善が必要' },
      scapula_retraction: { value: '不十分', ideal: '寄せて固定', status: '改善が必要' },
      left_right_balance: { value: '左が3%弱い', ideal: '均等', status: 'やや不均衡' },
      lockout: { value: '完全', ideal: '完全伸展', status: '良好' }
    },
    recommendations: [
      '肩甲骨をもう少し寄せてベンチに押し付けてください',
      'バーの軌道が前方にブレています。胸の乳首ラインに降ろすことを意識してください',
      '左腕がやや弱いので、片手ずつのダンベルプレスで補強することをお勧めします'
    ]
  },
  'スクワット': {
    exercise: 'スクワット',
    overall_score: 68,
    rep_count: 10,
    analysis: {
      knee_angle_bottom: { value: 78, ideal: 90, unit: '度', status: '深すぎ' },
      hip_hinge: { value: '良好', ideal: '適切なヒンジ', status: '適正' },
      knee_tracking: { value: '内側にやや入る', ideal: 'つま先と同じ方向', status: '改善が必要' },
      back_angle: { value: 35, ideal: '30-45', unit: '度', status: '適正' },
      depth: { value: 'パラレル以下', ideal: 'パラレル', status: 'やや深い' },
      left_right_balance: { value: '右に2%偏り', ideal: '均等', status: 'ほぼ均等' },
      heel_lift: { value: 'なし', ideal: '踵が浮かない', status: '良好' }
    },
    recommendations: [
      '膝が内側に入る傾向があります。つま先と同じ方向に膝を向けてください',
      'ボトムが少し深すぎます。大腿が床と平行になるところで切り返してください',
      'それ以外のフォームは良好です。この調子で続けてください'
    ]
  },
  'デッドリフト': {
    exercise: 'デッドリフト',
    overall_score: 75,
    rep_count: 5,
    analysis: {
      back_rounding: { value: '上背部にやや丸み', ideal: 'ニュートラル', status: '注意' },
      hip_hinge: { value: '良好', ideal: '適切なヒンジ', status: '適正' },
      bar_path: { value: '体に近い', ideal: '体に沿って垂直', status: '良好' },
      lockout: { value: '完全', ideal: '股関節完全伸展', status: '良好' },
      shin_angle: { value: '適正', ideal: 'バーに軽く触れる', status: '適正' },
      left_right_balance: { value: '均等', ideal: '均等', status: '良好' },
      grip_strength: { value: '8レップ目でバーが回転', ideal: '安定したグリップ', status: 'やや弱い' }
    },
    recommendations: [
      '上背部がやや丸まっています。胸を張って肩甲骨を寄せることを意識してください',
      'グリップが後半で弱くなっています。ストラップの使用またはグリップ強化トレーニングを推奨します',
      'バーパスとヒップヒンジは良好です'
    ]
  }
};

/** Default analysis data for unknown exercises */
const DEFAULT_ANALYSIS = {
  exercise: '不明',
  overall_score: 70,
  rep_count: 0,
  analysis: {
    posture: { value: '概ね良好', ideal: '正しい姿勢', status: '適正' },
    range_of_motion: { value: '適切', ideal: 'フルレンジ', status: '適正' },
    left_right_balance: { value: 'ほぼ均等', ideal: '均等', status: '適正' }
  },
  recommendations: [
    'フォーム全体としては概ね良好です',
    'より詳細な分析のために、種目名を指定してください'
  ]
};


/**
 * ToolHandler - Executes function calls and returns results
 */
class ToolHandler {
  constructor() {
    this._currentExercise = null;
    this._videoRecorder = null;
    this._lastRecordedBlob = null;
    this._onStateChange = null; // Callback for UI updates
  }

  /**
   * Set the video recorder instance
   */
  setVideoRecorder(recorder) {
    this._videoRecorder = recorder;
  }

  /**
   * Set callback for state changes
   * @param {Function} callback - Called with { type, data }
   */
  onStateChange(callback) {
    this._onStateChange = callback;
  }

  /**
   * Handle a function call from Gemini
   * @param {Object} fc - { name, id, args }
   * @returns {Object} - { name, id, response }
   */
  async handleFunctionCall(fc) {
    const name = fc.name;
    const args = fc.args || {};
    let result;

    console.log(`[ToolHandler] Function called: ${name}`, args);

    switch (name) {
      case 'set_exercise':
        result = this._setExercise(args.exercise_name);
        break;
      case 'start_recording':
        result = this._startRecording();
        break;
      case 'stop_recording':
        result = await this._stopRecording();
        break;
      case 'analyze_form':
        result = await this._analyzeForm(args.exercise_name);
        break;
      default:
        result = { error: `Unknown function: ${name}` };
    }

    return {
      name: name,
      id: fc.id,
      response: { result }
    };
  }

  _setExercise(exerciseName) {
    this._currentExercise = exerciseName;
    this._notify('exercise_set', { exercise: exerciseName });
    return {
      status: 'success',
      message: `現在の種目を「${exerciseName}」に設定しました`,
      exercise: exerciseName
    };
  }

  _startRecording() {
    if (!this._videoRecorder) {
      return { status: 'error', message: 'カメラが初期化されていません' };
    }
    const success = this._videoRecorder.startRecording();
    if (success) {
      this._notify('recording_started', {});
      return { status: 'success', message: '録画を開始しました' };
    } else {
      return { status: 'error', message: '録画の開始に失敗しました。カメラが有効か確認してください' };
    }
  }

  async _stopRecording() {
    if (!this._videoRecorder) {
      return { status: 'error', message: 'カメラが初期化されていません' };
    }
    const blob = await this._videoRecorder.stopRecording();
    if (blob) {
      this._lastRecordedBlob = blob;
      const sizeMB = (blob.size / (1024 * 1024)).toFixed(1);
      this._notify('recording_stopped', { sizeMB });
      return {
        status: 'success',
        message: `録画を停止しました。ファイルサイズ: ${sizeMB}MB`,
        file_size_mb: sizeMB
      };
    } else {
      this._notify('recording_stopped', {});
      return { status: 'error', message: '録画データの取得に失敗しました' };
    }
  }

  async _analyzeForm(exerciseName) {
    const exercise = exerciseName || this._currentExercise || '不明';
    this._notify('analysis_started', { exercise });

    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Return dummy analysis data
    const analysisData = DUMMY_ANALYSIS_DATA[exercise] || {
      ...DEFAULT_ANALYSIS,
      exercise: exercise
    };

    this._notify('analysis_complete', analysisData);
    return analysisData;
  }

  _notify(type, data) {
    if (this._onStateChange) {
      this._onStateChange({ type, data });
    }
  }

  get currentExercise() {
    return this._currentExercise;
  }

  get lastRecordedBlob() {
    return this._lastRecordedBlob;
  }
}
