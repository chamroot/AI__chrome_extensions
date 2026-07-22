(function () {
  let audioCtx = null;
  let source = null;
  let lowFilter = null;
  let midFilter = null;
  let highFilter = null;
  let gainNode = null;
  let analyserNode = null;
  let currentRmsDb = -60;

  function initAudio() {
    const video = document.querySelector('video');
    if (!video || audioCtx) return;

    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      
      // CORS属性が未設定の場合の対策
      if (!video.crossOrigin) video.crossOrigin = 'anonymous';

      source = audioCtx.createMediaElementSource(video);

      lowFilter = audioCtx.createBiquadFilter();
      lowFilter.type = 'lowshelf';
      lowFilter.frequency.value = 250;

      midFilter = audioCtx.createBiquadFilter();
      midFilter.type = 'peaking';
      midFilter.frequency.value = 1000;
      midFilter.Q.value = 1.0;

      highFilter = audioCtx.createBiquadFilter();
      highFilter.type = 'highshelf';
      highFilter.frequency.value = 4000;

      gainNode = audioCtx.createGain();

      analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 512;
      analyserNode.smoothingTimeConstant = 0.3;

      // パイプライン結合
      source.connect(lowFilter);
      lowFilter.connect(midFilter);
      midFilter.connect(highFilter);
      highFilter.connect(gainNode);

      gainNode.connect(analyserNode);
      analyserNode.connect(audioCtx.destination);

      startRmsLoop();
    } catch (e) {
      console.warn("AudioController Init Note:", e);
    }
  }

  function ensureAudioContext() {
    if (!audioCtx) initAudio();
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  window.addEventListener('click', ensureAudioContext);
  window.addEventListener('play', ensureAudioContext, true);

  window.addEventListener('AUDIO_CTRL_EVENT', (e) => {
    ensureAudioContext();
    const { action, payload } = e.detail;
    const video = document.querySelector('video');

    switch (action) {
      case 'SET_VOLUME':
        if (gainNode) gainNode.gain.value = payload.value;
        break;
      case 'SET_SPEED':
        if (video) video.playbackRate = payload.value;
        break;
      case 'SET_EQ_LOW':
        if (lowFilter) lowFilter.gain.value = payload.value;
        break;
      case 'SET_EQ_MID':
        if (midFilter) midFilter.gain.value = payload.value;
        break;
      case 'SET_EQ_HIGH':
        if (highFilter) highFilter.gain.value = payload.value;
        break;
    }
  });

  function startRmsLoop() {
    const dataArray = new Float32Array(analyserNode.fftSize);
    
    function calc() {
      if (analyserNode) {
        analyserNode.getFloatTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length);
        currentRmsDb = rms > 0.0001 ? Math.max(-60, Math.min(0, 20 * Math.log10(rms))) : -60;
        
        // Windowメッセージで外部へ送信
        window.postMessage({ type: 'ACY_RMS_UPDATE', rms: currentRmsDb }, '*');
      }
      requestAnimationFrame(calc);
    }
    calc();
  }

  setTimeout(initAudio, 1000);
})();
