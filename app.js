/**
 * App - Main controller for the Fitness Coach application
 *
 * Wires together: GeminiLive, AudioHandler, VideoRecorder, ToolHandler
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
  const tools = new ToolHandler();

  // ===== State =====
  let isSessionActive = false;
  let currentInputTranscript = '';
  let currentOutputTranscript = '';
  let inputTranscriptEl = null;
  let outputTranscriptEl = null;

  // ===== Initialization =====
  function init() {
    // Restore API key from localStorage
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) {
      apiKeyInput.value = savedKey;
    }

    // Wire up tool handler
    tools.setVideoRecorder(video);
    tools.onStateChange(handleToolStateChange);

    // Wire up event listeners
    startBtn.addEventListener('click', handleStart);
    micBtn.addEventListener('click', toggleSession);
    settingsBtn.addEventListener('click', handleSettings);

    // Wire up Gemini callbacks
    gemini.on('audio', (data) => audio.enqueueAudio(data));
    gemini.on('inputTranscript', handleInputTranscript);
    gemini.on('outputTranscript', handleOutputTranscript);
    gemini.on('toolCall', handleToolCall);
    gemini.on('interrupted', () => audio.clearPlayback());
    gemini.on('status', updateConnectionStatus);
    gemini.on('error', (err) => {
      console.error('Gemini error:', err);
      addSystemMessage('接続エラーが発生しました');
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

    // Save API key
    localStorage.setItem('gemini_api_key', apiKey);

    // Switch to main screen
    setupScreen.classList.remove('active');
    mainScreen.classList.add('active');

    // Start camera preview
    const cameraOk = await video.startPreview(cameraPreview);
    if (!cameraOk) {
      addSystemMessage('カメラへのアクセスが拒否されました。録画機能は使用できません。');
    }

    // Enable mic button
    micBtn.disabled = false;
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

    try {
      // Connect to Gemini
      await gemini.connect(apiKey);

      // Start microphone
      await audio.startMic((pcmBuffer) => {
        gemini.sendAudio(pcmBuffer);
      });

      isSessionActive = true;
      micBtn.classList.add('active');
      micBtn.querySelector('.mic-label').textContent = '停止';
      clearTranscript();
      addSystemMessage('セッションを開始しました。話しかけてください。');
    } catch (err) {
      console.error('Failed to start session:', err);
      addSystemMessage(`接続に失敗しました: ${err.message || 'APIキーを確認してください'}`);
      updateConnectionStatus('disconnected');
    }
  }

  function stopSession() {
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

    // Accumulate input transcript fragments
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

    // Finalize any pending input transcript
    if (inputTranscriptEl) {
      inputTranscriptEl = null;
      currentInputTranscript = '';
    }

    // Accumulate output transcript fragments
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

    // Finalize transcripts before function execution
    finalizeCurrentTranscripts();

    const functionResponses = [];

    for (const fc of toolCall.functionCalls) {
      addFunctionLogEntry(`⚡ ${fc.name}(${JSON.stringify(fc.args || {})}) を実行中...`);
      addSystemMessage(`🔧 ${fc.name} 関数が呼び出されました`);

      const result = await tools.handleFunctionCall(fc);
      functionResponses.push(result);

      addFunctionLogEntry(`✅ ${fc.name} → 完了`);
    }

    // Send all responses back to Gemini
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
        addSystemMessage('📹 録画を開始しました');
        break;

      case 'recording_stopped':
        recIndicator.classList.add('hidden');
        if (data.sizeMB) {
          addSystemMessage(`📹 録画停止 (${data.sizeMB}MB)`);
        } else {
          addSystemMessage('📹 録画を停止しました');
        }
        break;

      case 'analysis_started':
        addSystemMessage(`🔬 「${data.exercise}」のフォーム解析を実行中...`);
        break;

      case 'analysis_complete':
        addSystemMessage(`📊 解析完了 — スコア: ${data.overall_score}/100`);
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

    // Keep only last 10 entries
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
