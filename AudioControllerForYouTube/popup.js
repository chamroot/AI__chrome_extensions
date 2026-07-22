// =========================
// 安全な初期化実行（DOMContentLoadedの通過対策）
// =========================
function runWhenReady(fn) {
  if (document.readyState !== "loading") {
    fn();
  } else {
    document.addEventListener("DOMContentLoaded", fn);
  }
}

runWhenReady(async () => {
  // =========================
  // DOM要素の取得
  // =========================
  const elements = {
    appTitle: document.getElementById("app-title"),
    appVersion: document.getElementById("app-version"),
    appIcon: document.getElementById("app-icon"),
    rmsVal: document.getElementById("rms-val"),
    rmsBar: document.getElementById("rms-bar"),
    resetBtn: document.getElementById("reset-btn")
  };

  const controls = {
    volume: {
      slider: document.getElementById("vol-slider"),
      display: document.getElementById("vol-val"),
      action: "SET_VOLUME",
      format: (v) => `${Math.round(v * 100)}%`
    },
    speed: {
      slider: document.getElementById("speed-slider"),
      display: document.getElementById("speed-val"),
      action: "SET_SPEED",
      format: (v) => `${Number(v).toFixed(2)}x`
    },
    eqLow: {
      slider: document.getElementById("low-slider"),
      display: document.getElementById("low-val"),
      action: "SET_EQ_LOW",
      format: (v) => `${v} dB`
    },
    eqMid: {
      slider: document.getElementById("mid-slider"),
      display: document.getElementById("mid-val"),
      action: "SET_EQ_MID",
      format: (v) => `${v} dB`
    },
    eqHigh: {
      slider: document.getElementById("high-slider"),
      display: document.getElementById("high-val"),
      action: "SET_EQ_HIGH",
      format: (v) => `${v} dB`
    }
  };

  const defaultSettings = {
    volume: 1.0,
    speed: 1.0,
    eqLow: 0,
    eqMid: 0,
    eqHigh: 0
  };

  // =========================
  // 拡張機能情報・タイトルの反映
  // =========================
  function initAppInfo() {
    const manifest = chrome.runtime.getManifest();

    if (elements.appTitle) {
      let title = manifest.name || "";
      if (title.startsWith("__MSG_") && title.endsWith("__")) {
        const msgKey = title.slice(6, -2);
        title = chrome.i18n.getMessage(msgKey) || title;
      }
      elements.appTitle.textContent = title;
    }

    if (elements.appVersion && manifest.version) {
      elements.appVersion.textContent = `v${manifest.version}`;
    }

    if (elements.appIcon) {
      const iconPath = manifest.icons
        ? (manifest.icons["48"] || manifest.icons["32"] || manifest.icons["16"])
        : null;

      if (iconPath) {
        elements.appIcon.src = chrome.runtime.getURL(iconPath);
        elements.appIcon.style.display = "";
      } else {
        elements.appIcon.removeAttribute("src");
        elements.appIcon.style.display = "none";
      }
    }
  }

  // アクティブなタブIDを取得
  async function getActiveTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  }

  // content.js へメッセージ送信
  async function sendToContentScript(action, value) {
    const tabId = await getActiveTabId();
    if (!tabId) return;

    try {
      await chrome.tabs.sendMessage(tabId, {
        action,
        payload: { value: parseFloat(value) }
      });
    } catch {
      // content.js が読み込まれていないページでのエラーを非表示でスキップ
    }
  }

  // 設定値の反映・画面更新
  function applyValue(key, value, shouldSave = false) {
    const ctrl = controls[key];
    if (!ctrl || !ctrl.slider || !ctrl.display) return;

    const numValue = parseFloat(value);
    ctrl.slider.value = numValue;
    ctrl.display.textContent = ctrl.format(numValue);
    sendToContentScript(ctrl.action, numValue);

    if (shouldSave) {
      chrome.storage.local.set({ [key]: numValue });
    }
  }

  // 設定のロード
  async function loadSettings() {
    const stored = await chrome.storage.local.get(defaultSettings);
    Object.keys(controls).forEach((key) => {
      const val = stored[key] ?? defaultSettings[key];
      applyValue(key, val, false);
    });
  }

  // イベントリスナーの登録
  function setupEventListeners() {
    Object.keys(controls).forEach((key) => {
      const ctrl = controls[key];
      if (ctrl.slider) {
        ctrl.slider.addEventListener("input", (e) => {
          applyValue(key, e.target.value, true);
        });
      }
    });

    if (elements.resetBtn) {
      elements.resetBtn.addEventListener("click", async () => {
        await chrome.storage.local.clear();
        await chrome.storage.local.set(defaultSettings);
        Object.keys(defaultSettings).forEach((key) => {
          applyValue(key, defaultSettings[key], false);
        });
      });
    }
  }

  // =========================
  // RMS メーターの更新処理
  // =========================
  async function updateMeter() {
    const tabId = await getActiveTabId();
    if (!tabId) return;

    chrome.tabs.sendMessage(tabId, { action: "GET_AUDIO_LEVEL" }, (response) => {
      if (chrome.runtime.lastError || !response || response.rms === undefined) {
        if (elements.rmsVal) elements.rmsVal.textContent = "-∞ dBFS";
        if (elements.rmsBar) elements.rmsBar.style.width = "0%";
        return;
      }

      const rmsDb = response.rms;
      if (elements.rmsVal) {
        elements.rmsVal.textContent = rmsDb <= -59.5 ? "-∞ dBFS" : `${rmsDb.toFixed(1)} dBFS`;
      }

      const percent = Math.max(0, Math.min(100, ((rmsDb + 60) / 60) * 100));
      if (elements.rmsBar) {
        elements.rmsBar.style.width = `${percent}%`;
      }
    });
  }

  // 起動処理
  initAppInfo();
  await loadSettings();
  setupEventListeners();

  // RMSメーターのポーリング
  const meterIntervalId = setInterval(updateMeter, 50);

  // ポップアップが閉じる際のクリーンアップ (pagehide & unload)
  const cleanup = () => {
    if (meterIntervalId) clearInterval(meterIntervalId);
  };
  window.addEventListener("pagehide", cleanup);
  window.addEventListener("unload", cleanup);
});
