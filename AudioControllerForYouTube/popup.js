document.addEventListener('DOMContentLoaded', async () => {
  // manifest.json の "name" を動的設定
  const manifestData = chrome.runtime.getManifest();
  const titleEl = document.getElementById('app-title');
  if (titleEl && manifestData.name) {
    titleEl.textContent = manifestData.name;
  }

  const DEFAULT_SETTINGS = {
    volume: 1.0,
    speed: 1.0,
    eqLow: 0,
    eqMid: 0,
    eqHigh: 0
  };

  const controls = {
    volume: { slider: document.getElementById('vol-slider'), display: document.getElementById('vol-val'), action: 'SET_VOLUME', format: (v) => `${Math.round(v * 100)}%` },
    speed: { slider: document.getElementById('speed-slider'), display: document.getElementById('speed-val'), action: 'SET_SPEED', format: (v) => `${parseFloat(v).toFixed(2)}x` },
    eqLow: { slider: document.getElementById('low-slider'), display: document.getElementById('low-val'), action: 'SET_EQ_LOW', format: (v) => `${v} dB` },
    eqMid: { slider: document.getElementById('mid-slider'), display: document.getElementById('mid-val'), action: 'SET_EQ_MID', format: (v) => `${v} dB` },
    eqHigh: { slider: document.getElementById('high-slider'), display: document.getElementById('high-val'), action: 'SET_EQ_HIGH', format: (v) => `${v} dB` }
  };

  const resetBtn = document.getElementById('reset-btn');
  const rmsBar = document.getElementById('rms-bar');
  const rmsVal = document.getElementById('rms-val');

  let timerId = null;

  async function sendToContentScript(action, value) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { action: action, payload: { value: parseFloat(value) } }).catch(() => {});
    }
  }

  function applyValue(key, value, shouldSave = true) {
    const ctrl = controls[key];
    if (!ctrl) return;
    ctrl.slider.value = value;
    ctrl.display.textContent = ctrl.format(value);
    sendToContentScript(ctrl.action, value);
    if (shouldSave) chrome.storage.local.set({ [key]: parseFloat(value) });
  }

  async function loadSettings() {
    const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
    Object.keys(controls).forEach((key) => {
      applyValue(key, stored[key] !== undefined ? stored[key] : DEFAULT_SETTINGS[key], false);
    });
  }

  Object.keys(controls).forEach((key) => {
    controls[key].slider.addEventListener('input', (e) => applyValue(key, e.target.value, true));
  });

  // 設定をリセット
  resetBtn.addEventListener('click', async () => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set(DEFAULT_SETTINGS);
    Object.keys(DEFAULT_SETTINGS).forEach((key) => {
      applyValue(key, DEFAULT_SETTINGS[key], false);
    });
  });

  // RMS メーターのポーリング更新
  async function updateMeter() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;

    chrome.tabs.sendMessage(tab.id, { action: 'GET_AUDIO_LEVEL' }, (response) => {
      if (chrome.runtime.lastError || !response || response.rms === undefined) {
        if (rmsVal) rmsVal.textContent = '-∞ dBFS';
        if (rmsBar) rmsBar.style.width = '0%';
        return;
      }

      const rmsDb = response.rms;
      if (rmsVal) {
        rmsVal.textContent = rmsDb <= -59.5 ? '-∞ dBFS' : `${rmsDb.toFixed(1)} dBFS`;
      }

      // -60dBFS ～ 0dBFS を 0% ～ 100% にマッピング
      const percent = Math.max(0, Math.min(100, ((rmsDb + 60) / 60) * 100));
      if (rmsBar) {
        rmsBar.style.width = `${percent}%`;
      }
    });
  }

  await loadSettings();
  timerId = setInterval(updateMeter, 50);

  window.addEventListener('unload', () => {
    if (timerId) clearInterval(timerId);
  });
});
