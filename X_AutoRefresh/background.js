"use strict";

// デフォルト設定の定義
const DEFAULT_SETTINGS = {
  enabled: true,
  intervalSeconds: 30,
  consoleLogEnabled: true,
  highlightKeywords: [],
  highlightUsers: [],
  scheduleEnabled: false,
  scheduleDays: [],
  scheduleStartTime: "00:00",
  scheduleEndTime: "23:59",
  unreadTweets: [],
  readTweets: [],
  nextUpdateAt: null
};

// =========================
// インストール時の初期化
// =========================
chrome.runtime.onInstalled.addListener(async () => {
  const currentSettings = await chrome.storage.local.get(null);
  // 未設定の項目だけデフォルト値で埋める
  const initialSettings = { ...DEFAULT_SETTINGS, ...currentSettings };
  await chrome.storage.local.set(initialSettings);
});

// =========================
// メッセージ受信
// =========================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  
  // 1. 設定読み込み
  if (message.type === "getSettings") {
    chrome.storage.local.get(DEFAULT_SETTINGS).then((settings) => {
      sendResponse(settings);
    });
    return true; // 非同期レスポンスのために必須
  }

  // 2. 未読情報保存
  if (message.type === "saveUnreadTweets") {
    chrome.storage.local.set({ unreadTweets: message.unreadTweets });
    return;
  }

  // 3. 既読情報保存
  if (message.type === "saveReadTweets") {
    chrome.storage.local.set({ readTweets: message.readTweets });
    return;
  }

  // 4. 次回更新時刻保存
  if (message.type === "setNextUpdate") {
    chrome.storage.local.set({ nextUpdateAt: message.nextUpdateAt });
    return;
  }
});
