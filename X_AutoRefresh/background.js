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

// 統計処理の並列実行による競合（上書き破壊）を防ぐキュー
let statQueue = Promise.resolve();

// 統計データを安全にインクリメント（日付切り替えも自動判定）
function incrementDailyStat(key, amount = 1) {
  if (amount <= 0) return;

  // 順番に実行されるようにキューへ繋ぐ
  statQueue = statQueue.then(async () => {
    try {
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
        const currentValue = Number(current[key]) || 0;
        await chrome.storage.local.set({
          [key]: currentValue + amount
        });
      }
    } catch (e) {
      console.error("[Background Error] incrementDailyStat:", e);
    }
  });
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
    chrome.storage.local.set({ unreadTweets: message.unreadTweets || [] });
    return;
  }

  // 3. 既読情報保存
  if (message.type === "saveReadTweets") {
    const newReadTweets = message.readTweets || [];

    chrome.storage.local.get({ readTweets: [] }, (data) => {
      const oldReadTweets = data.readTweets || [];
      const oldSet = new Set(oldReadTweets);

      // 新しく増えたツイートの件数を正しく算出
      let addedCount = 0;
      for (const id of newReadTweets) {
        if (!oldSet.has(id)) {
          addedCount++;
        }
      }

      // ★ 最重要: 統計処理とは切り離して、既読ID配列の保存を確実に実行
      chrome.storage.local.set({ readTweets: newReadTweets }, () => {
        // 保存成功後に安全に統計を加算
        if (addedCount > 0) {
          incrementDailyStat("todayReadCount", addedCount);
        }
      });
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
    if (message.keywordHits && message.keywordHits > 0) {
      incrementDailyStat("todayKeywordHitCount", message.keywordHits);
    }
    if (message.userHits && message.userHits > 0) {
      incrementDailyStat("todayUserHitCount", message.userHits);
    }
    return;
  }
});
