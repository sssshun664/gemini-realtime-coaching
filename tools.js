/**
 * System Instruction for the AI Fitness Coach
 */
const SYSTEM_INSTRUCTION = `あなたはプロのフィットネスコーチ「AIコーチ」です。自宅でトレーニングしているユーザーに対して、リアルタイムで音声コーチングを行います。カメラ映像がリアルタイムで送信されているので、ユーザーの様子を観察しながらコーチングしてください。

## あなたの役割
- ユーザーの自重トレーニングのフォームを観察し、改善点をフィードバックする親しみやすいコーチ
- 会話はすべて日本語で行う
- 簡潔で明確な指示を出す（ユーザーはトレーニング中なので長い説明は避ける）
- 安全性を最優先に考える（怪我のリスクがあるフォームは即座に指摘する）

## 対象種目
- 腕立て伏せ（プッシュアップ）
- スクワット（自重）
- 腹筋（クランチ / シットアップ）

## コーチングの流れ
1. まずユーザーに挨拶し、今日のトレーニング種目を確認する
2. ユーザーが種目を伝えたら set_exercise 関数を呼び出して種目を設定する
3. ユーザーが準備できたら start_recording 関数で録画と姿勢計測を開始する
4. トレーニング中はカメラ映像と姿勢データを見ながらリアルタイムでアドバイスする
5. ユーザーが終了を伝えたら stop_recording 関数で録画と姿勢計測を停止する
6. ユーザーが解析を求めたら analyze_form 関数でフォーム解析を実行する
7. 解析結果を受け取ったら、データに基づいて具体的なフォーム改善アドバイスを提供する

## リアルタイム姿勢データについて
録画中に「【姿勢データ】」で始まるテキストが定期的に送信されます。これはMediaPipe骨格検出によるリアルタイムの計測値です。

データの見方:
- 肘角度: 腕の曲げ具合（小さい=深く曲がっている、大きい=伸びている）
- 体幹: 肩-腰-足首の角度（180°に近いほど一直線で良いフォーム）
- 膝角度: 膝の曲げ具合（小さい=深くしゃがんでいる）
- 背中: 前傾角度（度）
- 股関節: 上体の起き上がり具合
- レップ: 検出された回数

このデータを参考に、必要な場合のみ簡潔に声掛けしてください:
- フォームが崩れている場合:「体幹をまっすぐに！」「もう少し深く！」「膝を外に開いて！」
- 良いフォームの場合:「いい感じ！」「その調子！」
- 毎回のデータに逐一コメントする必要はありません。明らかにフォームが崩れたときだけ指摘してください。

## 関数の呼び出しルール
- set_exercise: ユーザーが種目名を言ったとき（例：「腕立て伏せをやる」「スクワットを見て」「腹筋をやりたい」）
- start_recording: ユーザーが「始める」「スタート」「録画して」「やるよ」と言ったとき
- stop_recording: ユーザーが「終わり」「ストップ」「止めて」「おしまい」と言ったとき
- analyze_form: ユーザーが「解析して」「どうだった？」「フォームチェック」「分析して」と言ったとき

## 解析結果のフィードバック
analyze_form の結果にはスコアと詳細分析が含まれます:
- overall_score: 総合スコア（100点満点）
- good_points: 良かった点
- improvements: 改善が必要な点
- safety_warnings: 安全性に関する警告

これらの情報をもとに:
1. まずスコアと良い点を伝えて褒める
2. 改善点を具体的なアクションとして伝える
3. 安全性の警告があれば最優先で伝える`;


/**
 * Tool definitions for Gemini Function Calling
 */
const TOOL_DEFINITIONS = [
  {
    functionDeclarations: [
      {
        name: 'set_exercise',
        description: 'トレーニング種目を設定します。ユーザーが種目名を言った場合に呼び出してください。対応種目: 腕立て伏せ、スクワット、腹筋',
        parameters: {
          type: 'object',
          properties: {
            exercise_name: {
              type: 'string',
              description: 'トレーニング種目名（腕立て伏せ、スクワット、腹筋）'
            }
          },
          required: ['exercise_name']
        }
      },
      {
        name: 'start_recording',
        description: '録画と姿勢計測（MediaPipe骨格検出）を開始します。ユーザーが「始める」「スタート」「録画して」などと言った場合に呼び出してください。',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'stop_recording',
        description: '録画と姿勢計測を停止します。ユーザーが「終わり」「ストップ」「止めて」などと言った場合に呼び出してください。',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'analyze_form',
        description: '収集した姿勢データからフォーム解析を実行し、AI評価結果を返します。ユーザーが「解析して」「どうだった？」「フォームチェック」と言った場合に呼び出してください。',
        parameters: {
          type: 'object',
          properties: {
            exercise_name: {
              type: 'string',
              description: '解析対象のトレーニング種目名'
            }
          },
          required: ['exercise_name']
        }
      }
    ]
  }
];


/**
 * Fallback dummy data (used when MediaPipe or Flash Lite is unavailable)
 */
const DUMMY_ANALYSIS_DATA = {
  '腕立て伏せ': {
    exercise: '腕立て伏せ',
    overall_score: 74,
    rep_count: 10,
    good_points: [
      '一定のテンポでレップを重ねられています',
      'ロックアウト（腕の伸展）がしっかりできています'
    ],
    improvements: [
      'ボトムポジションでもう少し深く下げましょう（肘90度が目安）',
      '後半のレップで腰が落ちる傾向があります。体幹を意識してください'
    ],
    safety_warnings: []
  },
  'スクワット': {
    exercise: 'スクワット',
    overall_score: 70,
    rep_count: 10,
    good_points: [
      '膝の角度は適切な深さまで到達しています',
      '左右のバランスがよく取れています'
    ],
    improvements: [
      '膝が内側に入る傾向があります。つま先と同じ方向に膝を向けてください',
      '前傾が少し大きいです。胸を張ることを意識してみてください'
    ],
    safety_warnings: []
  },
  '腹筋': {
    exercise: '腹筋',
    overall_score: 72,
    rep_count: 15,
    good_points: [
      'レップのリズムが安定しています',
      '可動域を十分に使えています'
    ],
    improvements: [
      '上体を起こしすぎています。肩甲骨が浮く程度で十分です',
      '左右均等に上がるよう意識してください'
    ],
    safety_warnings: [
      '首を手で引っ張らないように注意してください（首を痛める原因になります）'
    ]
  }
};


/**
 * Metrics description for each exercise (sent to Flash Lite for context)
 */
const METRICS_DESCRIPTIONS = {
  '腕立て伏せ': `- elbow_angle_min_avg: ボトムでの平均肘角度（理想: 80-100°、深さの指標）
- elbow_angle_max_avg: トップでの平均肘角度（理想: 160-180°、完全伸展）
- body_alignment_avg: 肩-腰-足首の平均角度（理想: 170-180°、体幹が一直線）
- body_alignment_min: 体幹角度の最悪値（低いほど腰が落ちているか反っている）
- left_right_elbow_diff_avg: 左右肘角度差の平均（理想: 5°以下、左右対称）`,

  'スクワット': `- knee_angle_min_avg: ボトムでの平均膝角度（理想: 80-100°、パラレル）
- knee_angle_max_avg: トップでの平均膝角度（理想: 160-180°、完全伸展）
- back_angle_avg: 平均前傾角度（理想: 15-35°）
- back_angle_max: 最大前傾角度（大きすぎると前傾過多）
- knee_tracking_deviation_avg: 膝のブレ指標（大きいほど膝が内/外に逸脱）
- left_right_knee_diff_avg: 左右膝角度差の平均（理想: 5°以下）`,

  '腹筋': `- hip_angle_min_avg: クランチ時の最小股関節角度（小さいほど深くクランチ）
- hip_angle_max_avg: 戻り時の最大股関節角度（大きいほど完全に戻っている）
- torso_angle_min: 上体の最大挙上角度
- torso_angle_max: 上体の最大降下角度
- left_right_hip_diff_avg: 左右差の平均（理想: 5°以下）`
};


/**
 * ToolHandler - Executes function calls and returns results
 */
class ToolHandler {
  constructor() {
    this._currentExercise = null;
    this._videoRecorder = null;
    this._poseAnalyzer = null;
    this._lastRecordedBlob = null;
    this._onStateChange = null;
  }

  setVideoRecorder(recorder) {
    this._videoRecorder = recorder;
  }

  setPoseAnalyzer(analyzer) {
    this._poseAnalyzer = analyzer;
  }

  onStateChange(callback) {
    this._onStateChange = callback;
  }

  /**
   * Handle a function call from Gemini
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

    const recOk = this._videoRecorder.startRecording();
    if (!recOk) {
      return { status: 'error', message: '録画の開始に失敗しました' };
    }

    // Start pose landmark collection
    let poseOk = false;
    if (this._poseAnalyzer && this._poseAnalyzer.isReady) {
      poseOk = this._poseAnalyzer.startCollecting(this._currentExercise, 8);
    }

    this._notify('recording_started', { poseTracking: poseOk });
    return {
      status: 'success',
      message: '録画と姿勢計測を開始しました',
      pose_tracking: poseOk
    };
  }

  async _stopRecording() {
    if (!this._videoRecorder) {
      return { status: 'error', message: 'カメラが初期化されていません' };
    }

    // Stop pose collection
    let frameCount = 0;
    if (this._poseAnalyzer && this._poseAnalyzer.isCollecting) {
      frameCount = this._poseAnalyzer.stopCollecting();
    }

    // Stop video recording
    const blob = await this._videoRecorder.stopRecording();
    if (blob) {
      this._lastRecordedBlob = blob;
      const sizeMB = (blob.size / (1024 * 1024)).toFixed(1);
      this._notify('recording_stopped', { sizeMB, frameCount });
      return {
        status: 'success',
        message: `録画停止。${frameCount}フレームの姿勢データを収集しました。`,
        file_size_mb: sizeMB,
        pose_frames_collected: frameCount
      };
    } else {
      this._notify('recording_stopped', { frameCount });
      return {
        status: 'success',
        message: `録画停止。${frameCount}フレームの姿勢データを収集しました。`,
        pose_frames_collected: frameCount
      };
    }
  }

  async _analyzeForm(exerciseName) {
    const exercise = exerciseName || this._currentExercise || '不明';
    this._notify('analysis_started', { exercise });

    // Try real analysis: MediaPipe metrics → Flash Lite evaluation
    if (this._poseAnalyzer && this._poseAnalyzer.isReady && this._poseAnalyzer.frameCount > 0) {
      try {
        const metrics = this._poseAnalyzer.getMetricsSummary(exercise);

        if (metrics.status === 'insufficient_data') {
          this._notify('analysis_complete', { overall_score: 0, exercise });
          return {
            exercise,
            status: 'insufficient_data',
            message: metrics.message,
            fallback: 'ダミーデータを使用します',
            ...(DUMMY_ANALYSIS_DATA[exercise] || DUMMY_ANALYSIS_DATA['腕立て伏せ'])
          };
        }

        // Call Flash Lite for AI evaluation of the metrics
        const evaluation = await this._callFlashLiteAnalysis(exercise, metrics);

        if (evaluation) {
          const result = {
            exercise,
            rep_count: metrics.rep_count,
            duration_seconds: metrics.duration_seconds,
            total_frames: metrics.total_frames,
            raw_metrics: metrics.metrics,
            overall_score: evaluation.overall_score,
            good_points: evaluation.good_points,
            improvements: evaluation.improvements,
            safety_warnings: evaluation.safety_warnings
          };
          this._notify('analysis_complete', result);
          return result;
        }

        // Flash Lite failed — return raw metrics for Live API to interpret
        console.warn('[ToolHandler] Flash Lite unavailable, returning raw metrics');
        const rawResult = {
          exercise,
          rep_count: metrics.rep_count,
          duration_seconds: metrics.duration_seconds,
          raw_metrics: metrics.metrics,
          overall_score: null,
          note: 'AI評価が利用できませんでした。上記の計測データを直接解釈してください。'
        };
        this._notify('analysis_complete', rawResult);
        return rawResult;

      } catch (err) {
        console.error('[ToolHandler] Analysis failed:', err);
      }
    }

    // Fallback to dummy data
    console.warn('[ToolHandler] Using dummy analysis data');
    const dummy = DUMMY_ANALYSIS_DATA[exercise] || DUMMY_ANALYSIS_DATA['腕立て伏せ'];
    const fallbackResult = { ...dummy, exercise, fallback: true };
    this._notify('analysis_complete', fallbackResult);
    return fallbackResult;
  }

  /**
   * Call Gemini Flash Lite to evaluate pose metrics
   */
  async _callFlashLiteAnalysis(exercise, metrics) {
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) return null;

    const metricsDesc = METRICS_DESCRIPTIONS[exercise] || '基本的な姿勢メトリクスです。';

    const prompt = `あなたはフィットネストレーニングのフォーム分析AIです。MediaPipe骨格検出で収集された以下のデータを分析し、フォームを評価してください。

## 種目
${exercise}

## 計測データ
${JSON.stringify(metrics, null, 2)}

## 各指標の意味
${metricsDesc}

## 注意
- rep_count はMediaPipeの関節角度の変化から自動検出した値です
- 角度の単位はすべて度(°)です
- overall_scoreは0-100で評価してください（80以上=良好、60-79=改善の余地あり、60未満=要改善）`;

    const schema = {
      type: 'OBJECT',
      properties: {
        overall_score: { type: 'INTEGER' },
        good_points: {
          type: 'ARRAY',
          items: { type: 'STRING' }
        },
        improvements: {
          type: 'ARRAY',
          items: { type: 'STRING' }
        },
        safety_warnings: {
          type: 'ARRAY',
          items: { type: 'STRING' }
        }
      },
      required: ['overall_score', 'good_points', 'improvements', 'safety_warnings']
    };

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: schema
          }
        })
      });

      if (!response.ok) {
        console.error('[ToolHandler] Flash Lite API error:', response.status);
        return null;
      }

      const data = await response.json();
      if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        const text = data.candidates[0].content.parts[0].text;
        return JSON.parse(text);
      }
      return null;
    } catch (err) {
      console.error('[ToolHandler] Flash Lite API call failed:', err);
      return null;
    }
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
