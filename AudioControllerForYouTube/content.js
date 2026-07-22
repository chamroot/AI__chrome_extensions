// inject.jsの埋め込み
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject.js');
(document.head || document.documentElement).appendChild(script);

let latestRms = -60;

// inject.js からの RMS 通知を受信
window.addEventListener('message', (event) => {
  if (event.source === window && event.data && event.data.type === 'ACY_RMS_UPDATE') {
    latestRms = event.data.rms;
  }
});

// popup.js からのメッセージ要求を受信
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'GET_AUDIO_LEVEL') {
    sendResponse({ rms: latestRms });
    return true;
  }

  // 設定操作のイベン配信
  window.dispatchEvent(new CustomEvent('AUDIO_CTRL_EVENT', {
    detail: { action: message.action, payload: message.payload }
  }));
});
