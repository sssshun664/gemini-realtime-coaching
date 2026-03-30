/**
 * GeminiLive - WebSocket client for Gemini Live API (gemini-3.1-flash-live-preview)
 *
 * Handles:
 * - WebSocket connection with config message
 * - Sending realtime audio/video/text input
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

        // Send setup message (raw WebSocket protocol: BidiGenerateContentSetup)
        const setupMessage = {
          setup: {
            model: `models/${MODEL}`,
            generationConfig: {
              responseModalities: ['AUDIO']
            },
            systemInstruction: {
              parts: [{
                text: SYSTEM_INSTRUCTION
              }]
            },
            tools: TOOL_DEFINITIONS,
            inputAudioTranscription: {},
            outputAudioTranscription: {}
          }
        };

        this._ws.send(JSON.stringify(setupMessage));
        console.log('[GeminiLive] Setup sent, waiting for setupComplete...');
      };

      this._ws.onmessage = async (event) => {
        try {
          // Handle Blob data (Safari sends binary as Blob)
          let rawData = event.data;
          if (rawData instanceof Blob) {
            rawData = await rawData.text();
          } else if (rawData instanceof ArrayBuffer) {
            rawData = new TextDecoder().decode(rawData);
          }

          const response = JSON.parse(rawData);
          console.log('[GeminiLive] Received:', JSON.stringify(response).substring(0, 300));

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
          console.error('[GeminiLive] Failed to parse message:', err);
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
   * Send video frame to Gemini
   * @param {string} base64Data - Base64 encoded JPEG image data
   * @param {string} mimeType - MIME type (default: image/jpeg)
   */
  sendVideo(base64Data, mimeType = 'image/jpeg') {
    if (!this._isConnected || !this._ws) return;

    const message = {
      realtimeInput: {
        video: {
          data: base64Data,
          mimeType: mimeType
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
