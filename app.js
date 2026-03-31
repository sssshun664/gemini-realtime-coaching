/**
 * App - Main controller for the Fitness Coach application
 *
 * Wires together: GeminiLive, AudioHandler, VideoRecorder, PoseAnalyzer, ToolHandler
 * Manages UI state and user interactions
 */
(function () {
  'use strict';

  // ===== DOM References =====
  const setupScreen = document.getElementById('setup-screen');
  const mainScreen = document.getElementById('main-screen');
  const apiKeyInput = document.getElementById('api-key-input');
  const startBtn = document.getElementById('start-btn');
  const cameraPreview = document.getElementById('camera-preview');
  const poseOverlay = document.getElementById('pose-overlay');
  const cameraToggleBtn = document.getElementById('camera-toggle-btn');
  const recIndicator = document.getElementById('rec-indicator');
  const exerciseLabel = document.getElementById('exercise-label');
  const connectionStatus = document.getElementById('connection-status');
  const functionLog = document.getElementById('function-log');
  const functionLogContent = document.getElementById('function-log-content');
  const transcriptArea = document.getElementById('transcript-area');
  const transcriptContent = document.getElementById('transcript-content');
  const micBtn = document.getElementById('mic-btn');
  const settingsBtn = document.getElementById('settings-btn');

  // ===== Module Instances =====
  const gemini = new GeminiLive();
  const audio = new AudioHandler();
  const video = new VideoRecorder();
  const pose = new PoseAnalyzer();
  const tools = new ToolHandler();

  // ===== State =====
  let isSessionActive = false;
  let currentInputTranscript = '';
  let currentOutputTranscript = '';
  let inputTranscriptEl = null;
  let outputTranscriptEl = null;

  // ===== Initialization =====
  function init() {
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) {
      apiKeyInput.value = savedKey;
    }

    // Wire up tool handler
    tools.setVideoRecorder(video);
    tools.setPoseAnalyzer(pose);
    tools.onStateChange(handleToolStateChange);

    // Wire up pose overlay canvas
    pose.setOverlayCanvas(poseOverlay);

    // Wire up event-driven pose feedback → send to Gemini Live as text
    pose.setRealtimeCallback((summary) => {
      if (gemini.isConnected) {
        gemini.sendText(summary);
      }
    });

    // Wire up event listeners
    startBtn.addEventListener('click', handleStart);
    micBtn.addEventListener('click', toggleSession);
    settingsBtn.addEventListener('click', handleSettings);
    cameraToggleBtn.addEventListener('click', handleCameraToggle);

    // Wire up Gemini callbacks
    gemini.on('audio', (data) => audio.enqueueAudio(data));
    gemini.on('inputTranscript', handleInputTranscript);
    gemini.on('outputTranscript', handleOutputTranscript);
    gemini.on('toolCall', handleToolCall);
    gemini.on('interrupted', () => {
      audio.clearPlayback();
      finalizeCurrentTranscripts();
    });
    gemini.on('turnComplete', () => {
      finalizeCurrentTranscripts();
    });
    gemini.on('status', updateConnectionStatus);
    gemini.on('error', (err) => {
      console.error('Gemini error:', err);
      addSystemMessage(`エラー: ${err.message || '接続エラーが発生しました'}`);
      if (isSessionActive) {
        stopSession();
      }
    });
  }

  // ===== Screen Management =====
  async function handleStart() {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      apiKeyInput.focus();
      apiKeyInput.style.borderColor = '#ef4444';
      setTimeout(() => { apiKeyInput.style.borderColor = ''; }, 1500);
      return;
    }

    localStorage.setItem('gemini_api_key', apiKey);

    setupScreen.classList.remove('active');
    mainScreen.classList.add('active');

    // Start camera preview (front camera by default)
    const cameraOk = await video.startPreview(cameraPreview);
    if (cameraOk) {
      addSystemMessage('骨格検出エンジンを読み込み中...');
      pose.init(video.previewElement).then(() => {
        if (pose.isReady) {
          addSystemMessage('骨格検出エンジンの初期化が完了しました');
        } else {
          addSystemMessage('骨格検出の初期化に失敗しました（フォールバックモードで動作します）');
          console.warn('PoseAnalyzer load error:', pose.loadError);
        }
      });
    } else {
      addSystemMessage('カメラへのアクセスが拒否されました。');
    }

    micBtn.disabled = false;
  }

  // ===== Camera Toggle =====
  async function handleCameraToggle() {
    cameraToggleBtn.disabled = true;
    const ok = await video.toggleCamera();
    if (!ok) {
      addSystemMessage('カメラの切り替えに失敗しました');
    }
    cameraToggleBtn.disabled = false;
  }

  // ===== Session Management =====
  async function toggleSession() {
    if (isSessionActive) {
      stopSession();
    } else {
      await startSession();
    }
  }

  async function startSession() {
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) return;

    micBtn.disabled = true;
    clearTranscript();

    addSystemMessage('マイクを起動中...');
    try {
      await audio.startMic((pcmBuffer) => {
        gemini.sendAudio(pcmBuffer);
      });
    } catch (err) {
      console.error('Failed to start mic:', err);
      addSystemMessage(`マイクの起動に失敗しました: ${err.message}`);
      micBtn.disabled = false;
      return;
    }

    addSystemMessage('Gemini Live APIに接続中...');
    try {
      await gemini.connect(apiKey);
    } catch (err) {
      console.error('Failed to connect to Gemini:', err);
      addSystemMessage(`接続に失敗しました: ${err.message || 'APIキーを確認してください'}`);
      audio.stopMic();
      updateConnectionStatus('disconnected');
      micBtn.disabled = false;
      return;
    }

    video.startFrameCapture((base64Jpeg) => {
      gemini.sendVideo(base64Jpeg);
    }, 1000);

    isSessionActive = true;
    micBtn.disabled = false;
    micBtn.classList.add('active');
    micBtn.querySelector('.mic-label').textContent = '停止';
    addSystemMessage('セッションを開始しました。話しかけてください。');
  }

  function stopSession() {
    if (pose.isCollecting) {
      pose.stopCollecting();
    }

    video.stopFrameCapture();
    gemini.disconnect();
    audio.stopMic();
    audio.clearPlayback();

    isSessionActive = false;
    micBtn.classList.remove('active');
    micBtn.querySelector('.mic-label').textContent = '接続';
    addSystemMessage('セッションを終了しました');
  }

  // ===== Transcript Management =====
  function handleInputTranscript(text) {
    if (!text || !text.trim()) return;
    if (!inputTranscriptEl) {
      inputTranscriptEl = document.createElement('div');
      inputTranscriptEl.className = 'transcript-entry user';
      transcriptContent.appendChild(inputTranscriptEl);
    }
    currentInputTranscript += text;
    inputTranscriptEl.textContent = currentInputTranscript;
    scrollTranscript();
  }

  function handleOutputTranscript(text) {
    if (!text || !text.trim()) return;
    if (inputTranscriptEl) {
      inputTranscriptEl = null;
      currentInputTranscript = '';
    }
    if (!outputTranscriptEl) {
      outputTranscriptEl = document.createElement('div');
      outputTranscriptEl.className = 'transcript-entry ai';
      transcriptContent.appendChild(outputTranscriptEl);
    }
    currentOutputTranscript += text;
    outputTranscriptEl.textContent = currentOutputTranscript;
    scrollTranscript();
  }

  function finalizeCurrentTranscripts() {
    inputTranscriptEl = null;
    outputTranscriptEl = null;
    currentInputTranscript = '';
    currentOutputTranscript = '';
  }

  function addSystemMessage(text) {
    finalizeCurrentTranscripts();
    const el = document.createElement('div');
    el.className = 'transcript-entry system';
    el.textContent = text;
    transcriptContent.appendChild(el);
    scrollTranscript();
  }

  function clearTranscript() {
    transcriptContent.innerHTML = '';
    finalizeCurrentTranscripts();
  }

  function scrollTranscript() {
    transcriptArea.scrollTop = transcriptArea.scrollHeight;
  }

  // ===== Tool Call Handling =====
  async function handleToolCall(toolCall) {
    if (!toolCall.functionCalls) return;
    finalizeCurrentTranscripts();

    const functionResponses = [];
    for (const fc of toolCall.functionCalls) {
      addFunctionLogEntry(`⚡ ${fc.name}(${JSON.stringify(fc.args || {})}) を実行中...`);
      addSystemMessage(`🔧 ${fc.name} 関数が呼び出されました`);

      const result = await tools.handleFunctionCall(fc);
      functionResponses.push(result);

      addFunctionLogEntry(`✅ ${fc.name} → 完了`);
    }

    gemini.sendToolResponse(functionResponses);
  }

  // ===== Tool State Change Handling =====
  function handleToolStateChange({ type, data }) {
    switch (type) {
      case 'exercise_set':
        exerciseLabel.textContent = `種目: ${data.exercise}`;
        exerciseLabel.classList.add('active');
        break;

      case 'recording_started':
        recIndicator.classList.remove('hidden');
        if (data.poseTracking) {
          addSystemMessage('📹 録画 + 姿勢計測を開始しました');
        } else {
          addSystemMessage('📹 録画を開始しました（姿勢計測は利用不可）');
        }
        break;

      case 'recording_stopped':
        recIndicator.classList.add('hidden');
        if (data.frameCount > 0) {
          addSystemMessage(`📹 録画停止 — ${data.frameCount}フレームの姿勢データを収集`);
        } else {
          addSystemMessage('📹 録画を停止しました');
        }
        break;

      case 'analysis_started':
        addSystemMessage(`🔬 「${data.exercise}」のフォーム解析を実行中...`);
        break;

      case 'analysis_complete':
        if (data.overall_score != null) {
          addSystemMessage(`📊 解析完了 — スコア: ${data.overall_score}/100`);
        } else {
          addSystemMessage('📊 解析完了');
        }
        break;
    }
  }

  // ===== Function Call Log =====
  function addFunctionLogEntry(text) {
    functionLog.classList.remove('hidden');
    const entry = document.createElement('div');
    entry.className = 'fn-log-entry';
    entry.textContent = `[${new Date().toLocaleTimeString('ja-JP')}] ${text}`;
    functionLogContent.appendChild(entry);
    functionLog.scrollTop = functionLog.scrollHeight;
    while (functionLogContent.children.length > 10) {
      functionLogContent.removeChild(functionLogContent.firstChild);
    }
  }

  // ===== Connection Status =====
  function updateConnectionStatus(status) {
    connectionStatus.className = '';
    switch (status) {
      case 'connecting':
        connectionStatus.classList.add('status-connecting');
        connectionStatus.textContent = '接続中...';
        break;
      case 'connected':
        connectionStatus.classList.add('status-connected');
        connectionStatus.textContent = '接続済み';
        break;
      case 'disconnected':
        connectionStatus.classList.add('status-disconnected');
        connectionStatus.textContent = '未接続';
        break;
    }
  }

  // ===== Settings =====
  function handleSettings() {
    if (isSessionActive) {
      stopSession();
    }
    mainScreen.classList.remove('active');
    setupScreen.classList.add('active');
  }

  // ===== Start =====
  init();
})();
