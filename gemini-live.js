/**
 * GeminiLive - WebSocket client for Gemini Live API (gemini-3.1-flash-live-preview)
 *
 * Handles:
 * - WebSocket connection with config message
 * - Sending realtime audio/text input
 * - Receiving audio output, transcriptions, tool calls
 * - Sending tool responses
 */
class GeminiLive {
  constructor() {
    this._ws = null;
    this._apiKey = null;
    this._isConnected = false;
    this._isConfigured = false;

    // Callbacks
    this._onAudioData = null;      // (base64Data) => {}
    this._onInputTranscript = null; // (text) => {}
    this._onOutputTranscript = null;// (text) => {}
    this._onToolCall = null;        // (toolCall) => {}
    this._onInterrupted = null;     // () => {}
    this._onTurnComplete = null;    // () => {}
    this._onStatusChange = null;    // (status) => {}
    this._onError = null;           // (error) => {}
  }

  /**
   * Set event callbacks
   */
  on(event, callback) {
    switch (event) {
      case 'audio': this._onAudioData = callback; break;
      case 'inputTranscript': this._onInputTranscript = callback; break;
      case 'outputTranscript': this._onOutputTranscript = callback; break;
      case 'toolCall': this._onToolCall = callback; break;
      case 'interrupted': this._onInterrupted = callback; break;
      case 'turnComplete': this._onTurnComplete = callback; break;
      case 'status': this._onStatusChange = callback; break;
      case 'error': this._onError = callback; break;
    }
  }

  /**
   * Connect to Gemini Live API
   * @param {string} apiKey
   */
  async connect(apiKey) {
    this._apiKey = apiKey;
    this._setStatus('connecting');

    const MODEL = 'gemini-3.1-flash-live-preview';
    const WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;

    return new Promise((resolve, reject) => {
      let settled = false;

      // Connection timeout (15 seconds)
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          if (this._ws) {
            this._ws.close();
            this._ws = null;
          }
          this._setStatus('disconnected');
          reject(new Error('接続がタイムアウトしました（15秒）。ネットワーク接続とAPIキーを確認してください。'));
        }
      }, 15000);

      try {
        this._ws = new WebSocket(WS_URL);
      } catch (err) {
        clearTimeout(timeout);
        this._setStatus('disconnected');
        reject(err);
        return;
      }

      this._ws.onopen = () => {
        console.log('[GeminiLive] WebSocket connected, sending setup...');

        // Send setup message (raw WebSocket protocol)
        const setupMessage = {
          setup: {
            model: `models/${MODEL}`,
            generationConfig: {
              responseModalities: ['AUDIO']
            },
            systemInstruction: {
              parts: [{
                text: `あなたはプロのフィットネスコーチです。ジムでトレーニングしているユーザーに対して、リアルタイムで音声コーチングを行います。

役割:
- ユーザーのトレーニングをサポートする親しみやすいコーチ
- 会話はすべて日本語で行う
- 簡潔で明確な指示を出す（ユーザーはトレーニング中なので長い説明は避ける）
- 安全性を最優先に考える

機能:
- ユーザーが種目名を言ったら set_exercise 関数を呼び出して種目を設定する
- ユーザーが「録画して」「撮影開始」と言ったら start_recording 関数を呼び出す
- ユーザーが「終わり」「録画止めて」と言ったら stop_recording 関数を呼び出す
- ユーザーが「解析して」「フォームチェック」と言ったら analyze_form 関数を呼び出す

重要:
- 関数を呼び出した際は「○○の関数を呼び出しました！」と明確に報告してください
- 解析結果を受け取ったら、データに基づいて具体的なフォーム改善アドバイスを音声で伝えてください
- スコアや数値も含めてわかりやすく説明してください`
              }]
            },
            tools: TOOL_DEFINITIONS,
            inputAudioTranscription: {},
            outputAudioTranscription: {}
          }
        };

        this._ws.send(JSON.stringify(setupMessage));
        console.log('[GeminiLive] Setup message sent, waiting for setupComplete...');
      };

      this._ws.onmessage = (event) => {
        try {
          const response = JSON.parse(event.data);
          console.log('[GeminiLive] Received:', JSON.stringify(response).substring(0, 200));

          // Handle server error responses
          if (response.error) {
            const errMsg = response.error.message || JSON.stringify(response.error);
            console.error('[GeminiLive] Server error:', errMsg);
            clearTimeout(timeout);
            if (!settled) {
              settled = true;
              reject(new Error(`API エラー: ${errMsg}`));
            } else if (this._onError) {
              this._onError(new Error(`API エラー: ${errMsg}`));
            }
            return;
          }

          // Handle setupComplete — resolve the connect promise here
          if (response.setupComplete !== undefined) {
            console.log('[GeminiLive] Setup complete');
            clearTimeout(timeout);
            this._isConfigured = true;
            this._isConnected = true;
            this._setStatus('connected');
            if (!settled) {
              settled = true;
              resolve();
            }
            return;
          }

          this._handleMessage(response);
        } catch (err) {
          console.error('[GeminiLive] Failed to parse message:', err, event.data?.substring?.(0, 200));
        }
      };

      this._ws.onerror = (error) => {
        console.error('[GeminiLive] WebSocket error:', error);
        if (this._onError) this._onError(error);
      };

      this._ws.onclose = (event) => {
        console.log('[GeminiLive] WebSocket closed:', event.code, event.reason);
        const wasConnected = this._isConnected;
        this._isConnected = false;
        this._isConfigured = false;
        this._setStatus('disconnected');

        // If closed before setupComplete, reject the connect promise
        if (!settled) {
          clearTimeout(timeout);
          settled = true;
          const reason = event.reason || `WebSocket closed (code: ${event.code})`;
          reject(new Error(reason));
        } else if (wasConnected) {
          // Unexpected disconnect during active session
          if (this._onError) {
            this._onError(new Error(`接続が切断されました (code: ${event.code}, reason: ${event.reason || 'unknown'})`));
          }
        }
      };
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  _handleMessage(response) {
    // Server content (audio, transcriptions, interruptions, turnComplete)
    if (response.serverContent) {
      const content = response.serverContent;

      // Audio output - process ALL parts in each event
      if (content.modelTurn && content.modelTurn.parts) {
        for (const part of content.modelTurn.parts) {
          if (part.inlineData && this._onAudioData) {
            this._onAudioData(part.inlineData.data);
          }
        }
      }

      // Input transcription
      if (content.inputTranscription && content.inputTranscription.text) {
        if (this._onInputTranscript) {
          this._onInputTranscript(content.inputTranscription.text);
        }
      }

      // Output transcription
      if (content.outputTranscription && content.outputTranscription.text) {
        if (this._onOutputTranscript) {
          this._onOutputTranscript(content.outputTranscription.text);
        }
      }

      // Interruption
      if (content.interrupted === true) {
        console.log('[GeminiLive] Interrupted');
        if (this._onInterrupted) this._onInterrupted();
      }

      // Turn complete
      if (content.turnComplete === true) {
        console.log('[GeminiLive] Turn complete');
        if (this._onTurnComplete) this._onTurnComplete();
      }
    }

    // Tool call
    if (response.toolCall) {
      console.log('[GeminiLive] Tool call received:', response.toolCall);
      if (this._onToolCall) {
        this._onToolCall(response.toolCall);
      }
      return;
    }

    // Usage metadata (informational, ignore)
    if (response.usageMetadata) {
      return;
    }

    // Unknown message type
    if (!response.serverContent && !response.toolCall) {
      console.warn('[GeminiLive] Unknown message type:', JSON.stringify(response).substring(0, 300));
    }
  }

  /**
   * Send audio data to Gemini
   * @param {ArrayBuffer} pcmBuffer - PCM int16 16kHz data
   */
  sendAudio(pcmBuffer) {
    if (!this._isConnected || !this._ws) return;

    const uint8Array = new Uint8Array(pcmBuffer);
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64Data = btoa(binary);

    const message = {
      realtimeInput: {
        audio: {
          data: base64Data,
          mimeType: 'audio/pcm;rate=16000'
        }
      }
    };

    this._ws.send(JSON.stringify(message));
  }

  /**
   * Send text input to Gemini
   * @param {string} text
   */
  sendText(text) {
    if (!this._isConnected || !this._ws) return;

    const message = {
      realtimeInput: {
        text: text
      }
    };

    this._ws.send(JSON.stringify(message));
  }

  /**
   * Send tool response back to Gemini
   * @param {Array} functionResponses - Array of { name, id, response }
   */
  sendToolResponse(functionResponses) {
    if (!this._isConnected || !this._ws) return;

    const message = {
      toolResponse: {
        functionResponses: functionResponses
      }
    };

    console.log('[GeminiLive] Sending tool response:', message);
    this._ws.send(JSON.stringify(message));
  }

  /**
   * Disconnect from the API
   */
  disconnect() {
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._isConnected = false;
    this._isConfigured = false;
    this._setStatus('disconnected');
  }

  _setStatus(status) {
    if (this._onStatusChange) {
      this._onStatusChange(status);
    }
  }

  get isConnected() {
    return this._isConnected;
  }
}
