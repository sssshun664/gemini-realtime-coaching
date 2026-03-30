# AI Fitness Coach 🏋️

Gemini Live API (`gemini-3.1-flash-live-preview`) を使ったリアルタイム音声フィットネスコーチングアプリのデモです。

## 概要

スマホを離れた場所に固定し、ワイヤレスイヤホンを通じてAIコーチとリアルタイムに音声会話しながらトレーニングを行います。

### 主な機能

- **リアルタイム音声会話** — 日本語で自然に会話
- **音声文字起こし** — ユーザーとAIの発話をリアルタイム表示
- **音声コマンドによる操作** — すべてFunction Callingで実現
  - `set_exercise` — 種目の設定（「ベンチプレスを見て」）
  - `start_recording` — 録画開始（「録画して」）
  - `stop_recording` — 録画停止（「終わり」）
  - `analyze_form` — フォーム解析（「解析して」）
- **カメラ録画** — ブラウザのMediaRecorder APIでMP4録画
- **ダミー骨格解析** — 種目別の固定データを返し、AIが音声でアドバイス

## セットアップ

### 1. APIキーの取得

[Google AI Studio](https://aistudio.google.com/apikey) でGemini APIキーを取得してください。

### 2. 起動方法

静的ファイルのみで構成されているため、任意のHTTPSサーバーでホスティングできます。

**ローカル開発:**
```bash
# Node.jsがある場合
npx serve .

# Pythonがある場合
python3 -m http.server 8000
```

**GitHub Pages:**
このリポジトリをGitHub Pagesで公開すればそのまま動作します。

### 3. 使い方

1. ページを開き、Gemini APIキーを入力
2. 「コーチングを開始」をタップ
3. マイクボタンをタップしてセッション開始
4. AIコーチと日本語で会話開始

## 技術スタック

| レイヤー | 技術 |
|---|---|
| フロントエンド | HTML + Vanilla JS (フレームワークなし) |
| Live API接続 | Raw WebSocket (ブラウザから直接) |
| 音声入力 | Web Audio API + AudioWorklet |
| 音声出力 | Web Audio API (PCM 24kHz再生) |
| カメラ録画 | MediaRecorder API |

## 注意事項

- APIキーはブラウザのlocalStorageにのみ保存されます
- 骨格解析は現時点ではダミー実装です
- セッションは約10分で自動切断されます（Live APIの制限）
- ヘッドホン/ワイヤレスイヤホンの使用を推奨します（エコー防止）

## ライセンス

MIT
