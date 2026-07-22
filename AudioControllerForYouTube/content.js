// =========================
// 定数定義
// =========================
const CONFIG = {
  INJECT_SCRIPT_PATH: 'inject.js',
  EVENT_RMS_UPDATE: 'ACY_RMS_UPDATE',
  EVENT_AUDIO_CTRL: 'AUDIO_CTRL_EVENT',
  DEFAULT_RMS: -60,
  MARKER_ATTR: 'data-acy-injected',
};

// =========================
// 状態管理
// =========================
let latestRms = CONFIG.DEFAULT_RMS;

// =========================
// inject.js の注入
// =========================
function injectScript() {
  const targetElement = document.head || document.documentElement;
  if (!targetElement) return;

  // 二重注入の防止
  if (targetElement.hasAttribute(CONFIG.MARKER_ATTR)) return;
  targetElement.setAttribute(CONFIG.MARKER_ATTR, 'true');

  const script = document.createElement('script');
  script.src = chrome.runtime.getURL(CONFIG.INJECT_SCRIPT_PATH);
  
  // 読み込み完了またはエラー時にスクリプトタグを削除（DOMのクリーンアップ）
  script.onload = () => script.remove();
  script.onerror = () => script.remove();

  targetElement.appendChild(script);
}

// 初期実行
injectScript();

// =========================
// inject.js からの RMS 通知を受信
// =========================
window.addEventListener('message', (event) => {
  // 同一ウィンドウからのメッセージかつ指定の構造かを検証
  if (event.source !== window || !event.data) return;

  const { type, rms } = event.data;
  if (type === CONFIG.EVENT_RMS_UPDATE && typeof rms === 'number') {
    latestRms = rms;
  }
});

// =========================
// popup.js (拡張機能側) からのメッセージを受信
// =========================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return false;

  // 1. RMS レベルの取得要求
  if (message.action === 'GET_AUDIO_LEVEL') {
    sendResponse({ rms: latestRms });
    return false; // 同期応答
  }

  // 2. inject.js (メインワールド) へ設定更新イベントを転送
  window.dispatchEvent(
    new CustomEvent(CONFIG.EVENT_AUDIO_CTRL, {
      detail: {
        action: message.action,
        payload: message.payload,
      },
    })
  );

  return false;
});
