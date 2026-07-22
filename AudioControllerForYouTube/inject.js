(function () {
  'use strict';

  // =========================
  // 定数・設定
  // =========================
  const CONFIG = {
    EVENT_AUDIO_CTRL: 'AUDIO_CTRL_EVENT',
    EVENT_RMS_UPDATE: 'ACY_RMS_UPDATE',
    MIN_RMS_DB: -60,
    SMOOTHING_TIME_CONSTANT: 0.01, // 音量・EQ変更時のポップノイズ防止時間
    RMS_INTERVAL_MS: 50,
  };

  // =========================
  // ノード・状態変数
  // =========================
  let audioCtx = null;
  let sourceNode = null;
  let lowFilter = null;
  let midFilter = null;
  let highFilter = null;
  let gainNode = null;
  let analyserNode = null;
  let attachedVideo = null;
  let rmsIntervalId = null;

  // =========================
  // AudioContext & パイプライン構築
  // =========================
  function createAudioPipeline() {
    if (audioCtx) return;

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // LOW (Lowshelf)
    lowFilter = audioCtx.createBiquadFilter();
    lowFilter.type = 'lowshelf';
    lowFilter.frequency.value = 250;

    // MID (Peaking)
    midFilter = audioCtx.createBiquadFilter();
    midFilter.type = 'peaking';
    midFilter.frequency.value = 1000;
    midFilter.Q.value = 1.0;

    // HIGH (Highshelf)
    highFilter = audioCtx.createBiquadFilter();
    highFilter.type = 'highshelf';
    highFilter.frequency.value = 4000;

    // Gain
    gainNode = audioCtx.createGain();

    // Analyser
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 512;
    analyserNode.smoothingTimeConstant = 0.3;

    // パイプラインの接続: Low -> Mid -> High -> Gain -> Analyser -> Destination
    lowFilter.connect(midFilter);
    midFilter.connect(highFilter);
    highFilter.connect(gainNode);
    gainNode.connect(analyserNode);
    analyserNode.connect(audioCtx.destination);
  }

  // =========================
  // video 要素へのアタッチ
  // =========================
  function attachToVideoElement() {
    const video = document.querySelector('video');
    if (!video || attachedVideo === video) return;

    createAudioPipeline();

    // 同一 video 要素への重複アタッチを防止 (MediaElementAudioSourceNode は 1 回のみ作成可能)
    if (!video.dataset.acyAttached) {
      try {
        sourceNode = audioCtx.createMediaElementSource(video);
        sourceNode.connect(lowFilter);
        video.dataset.acyAttached = 'true';
        attachedVideo = video;
      } catch (e) {
        console.warn('[ACY] MediaElementSource creation skipped:', e);
      }
    }

    startRmsLoop();
  }

  // AudioContext のコンテキストを復帰（Autoplay Policy 対策）
  function ensureAudioContext() {
    attachToVideoElement();
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  // =========================
  // RMS レベルの計算・送信ループ
  // =========================
  function startRmsLoop() {
    if (rmsIntervalId || !analyserNode) return;

    const dataArray = new Float32Array(analyserNode.fftSize);

    rmsIntervalId = setInterval(() => {
      if (!analyserNode) return;

      analyserNode.getFloatTimeDomainData(dataArray);

      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }

      const rms = Math.sqrt(sum / dataArray.length);
      const rmsDb = rms > 0.0001 
        ? Math.max(CONFIG.MIN_RMS_DB, Math.min(0, 20 * Math.log10(rms))) 
        : CONFIG.MIN_RMS_DB;

      // content.js 宛にウィンドウメッセージを送信
      window.postMessage({ type: CONFIG.EVENT_RMS_UPDATE, rms: rmsDb }, '*');
    }, CONFIG.RMS_INTERVAL_MS);
  }

  // =========================
  // イベントハンドラー & リスナー
  // =========================

  // ユーザーのインタラクションまたは動画再生時に AudioContext を確実に起動
  ['click', 'play', 'playing'].forEach((eventName) => {
    window.addEventListener(eventName, ensureAudioContext, { capture: true, passive: true });
  });

  // content.js からの操作イベントを受信
  window.addEventListener(CONFIG.EVENT_AUDIO_CTRL, (e) => {
    ensureAudioContext();

    const { action, payload } = e.detail || {};
    if (!payload || payload.value === undefined) return;

    const val = Number(payload.value);
    const video = attachedVideo || document.querySelector('video');

    switch (action) {
      case 'SET_VOLUME':
        if (gainNode) gainNode.gain.setTargetAtTime(val, audioCtx.currentTime, CONFIG.SMOOTHING_TIME_CONSTANT);
        break;

      case 'SET_SPEED':
        if (video) video.playbackRate = val;
        break;

      case 'SET_EQ_LOW':
        if (lowFilter) lowFilter.gain.setTargetAtTime(val, audioCtx.currentTime, CONFIG.SMOOTHING_TIME_CONSTANT);
        break;

      case 'SET_EQ_MID':
        if (midFilter) midFilter.gain.setTargetAtTime(val, audioCtx.currentTime, CONFIG.SMOOTHING_TIME_CONSTANT);
        break;

      case 'SET_EQ_HIGH':
        if (highFilter) highFilter.gain.setTargetAtTime(val, audioCtx.currentTime, CONFIG.SMOOTHING_TIME_CONSTANT);
        break;
    }
  });

  // =========================
  // YouTube SPA (画面遷移) 対策の監視
  // =========================
  const observer = new MutationObserver(() => {
    const currentVideo = document.querySelector('video');
    if (currentVideo && currentVideo !== attachedVideo) {
      attachToVideoElement();
    }
  });

  // DOMの動的な変更（動画の差し替え）を常時監視
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });

  // 初期化試行
  attachToVideoElement();
})();
