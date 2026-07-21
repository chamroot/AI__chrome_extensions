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
  nextUpdateAt: null,

  // 統計用データ (日付単位で管理)
  statsDate: getTodayString(),
  todayRefreshCount: 0,
  todayReadCount: 0,
  todayKeywordHitCount: 0,
  todayUserHitCount: 0
};

// 今日の日付文字列を取得 (YYYY-MM-DD)
function getTodayString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// 統計データを安全にインクリメント（日付切り替えも自動判定）
async function incrementDailyStat(key, amount = 1) {
  if (amount <= 0) return;

  const today = getTodayString();
  const current = await chrome.storage.local.get([
    "statsDate",
    "todayRefreshCount",
    "todayReadCount",
    "todayKeywordHitCount",
    "todayUserHitCount"
  ]);

  // 日付が変わっている場合はリセットして今回のカウントだけセット
  if (current.statsDate !== today) {
    await chrome.storage.local.set({
      statsDate: today,
      todayRefreshCount: 0,
      todayReadCount: 0,
      todayKeywordHitCount: 0,
      todayUserHitCount: 0,
      [key]: amount
    });
  } else {
    // 当日ならそのまま既存値に加算
    const currentValue = current[key] || 0;
    await chrome.storage.local.set({
      [key]: currentValue + amount
    });
  }
}

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
    chrome.storage.local.get({ readTweets: [] }, (data) => {
      const prevCount = data.readTweets ? data.readTweets.length : 0;
      const newCount = message.readTweets ? message.readTweets.length : 0;
      const addedCount = newCount - prevCount;

      chrome.storage.local.set({ readTweets: message.readTweets });

      if (addedCount > 0) {
        incrementDailyStat("todayReadCount", addedCount);
      }
    });
    return;
  }

  // 4. 次回更新時刻保存
  if (message.type === "setNextUpdate") {
    chrome.storage.local.set({ nextUpdateAt: message.nextUpdateAt });
    return;
  }

  // 5. 自動更新実行通知
  if (message.type === "recordRefresh") {
    incrementDailyStat("todayRefreshCount", 1);
    return;
  }

  // 6. ハイライト検知通知
  if (message.type === "recordHits") {
    if (message.keywordHits) {
      incrementDailyStat("todayKeywordHitCount", message.keywordHits);
    }
    if (message.userHits) {
      incrementDailyStat("todayUserHitCount", message.userHits);
    }
    return;
  }
});
