(() => {
  "use strict";

  // =========================
  // 基本設定
  // =========================
  let enabled = true;
  let intervalSeconds = 30;
  let consoleLogEnabled = true;
  let timer = null;
  let nextUpdateAt = null;
  let isUpdating = false;

  // =========================
  // スクロール状態
  // =========================
  let isUserScrolling = false;
  let scrollStopTimer = null;
  const SCROLL_STOP_DELAY = 1000;

  // =========================
  // 未読管理
  // =========================
  const unreadTweets = new Map();
  const readTweets = new Set();
  const MAX_UNREAD = 100;
  const MAX_READ = 500;
  const UNREAD_EXPIRE_TIME = 60 * 60 * 1000;
  let isInitialized = false;

  // =========================
  // ハイライト設定
  // =========================
  let highlightKeywords = [];
  let highlightUsers = [];

  // =========================
  // スケジュール設定
  // =========================
  let scheduleEnabled = false;
  let scheduleDays = [];
  let scheduleStartTime = "00:00";
  let scheduleEndTime = "23:59";

  // =========================
  // ログ出力
  // =========================
  function log(...args) {
    if (!consoleLogEnabled) return;
    console.log("[XAR]", ...args);
  }

  // =========================
  // 安全なメッセージ送信ラッパー（エラー防止ガード付き）
  // =========================
  function safeSendMessage(message, callback) {
    try {
      // Chrome APIまたはruntime、あるいはAPIが準備できていない場合は無視
      if (
        typeof chrome === "undefined" ||
        !chrome.runtime ||
        typeof chrome.runtime.sendMessage !== "function" ||
        !chrome.runtime.id
      ) {
        return;
      }

      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          // 接続断絶時の警告ログを消去して安全に無視
          return;
        }
        if (typeof callback === "function") {
          callback(response);
        }
      });
    } catch (e) {
      // Extension context invalidated 等のエラーを捕捉して握りつぶす
    }
  }

  // =========================
  // 初期設定読み込み & 起動
  // =========================
  safeSendMessage({ type: "getSettings" }, (settings) => {
    if (!settings) return;

    applySettings(settings);

    log("起動", {
      enabled,
      intervalSeconds,
      consoleLogEnabled,
      highlightKeywords,
      highlightUsers,
      scheduleEnabled,
      scheduleDays,
      scheduleStartTime,
      scheduleEndTime,
      unreadTweets: unreadTweets.size,
      readTweets: readTweets.size
    });

    restoreUnreadTweets(settings.unreadTweets);
    restoreReadTweets(settings.readTweets);

    initializeExistingTweets();
    applyKeywordHighlights();
    applyUserHighlights();

    observeNewTweets();
    observeScroll();

    isInitialized = true;
    startTimer();
  });

  // =========================
  // ストレージ変更のリアルタイム監視
  // =========================
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;

      // 内部状態（未読・既読リスト、次回更新時刻）の変更は無視
      const ignoreKeys = ["unreadTweets", "readTweets", "nextUpdateAt"];
      const updatedKeys = Object.keys(changes).filter(key => !ignoreKeys.includes(key));

      // 監視対象の設定変更がなければ何もしない
      if (updatedKeys.length === 0) return;

      // 変更があった項目だけを { キー: 新しい値 } のオブジェクトにする
      const changedSettings = {};
      for (const key of updatedKeys) {
        changedSettings[key] = changes[key].newValue;
      }

      // 変更のあった項目だけをログ出力
      log("設定の変更を検出:", changedSettings);

      // 値の適用
      if (changes.enabled !== undefined) enabled = changes.enabled.newValue ?? true;
      if (changes.intervalSeconds !== undefined) intervalSeconds = changes.intervalSeconds.newValue ?? 30;
      if (changes.consoleLogEnabled !== undefined) consoleLogEnabled = changes.consoleLogEnabled.newValue ?? true;
      if (changes.highlightKeywords !== undefined) highlightKeywords = changes.highlightKeywords.newValue || [];
      if (changes.highlightUsers !== undefined) highlightUsers = changes.highlightUsers.newValue || [];
      if (changes.scheduleEnabled !== undefined) scheduleEnabled = changes.scheduleEnabled.newValue ?? false;
      if (changes.scheduleDays !== undefined) scheduleDays = changes.scheduleDays.newValue || [];
      if (changes.scheduleStartTime !== undefined) scheduleStartTime = changes.scheduleStartTime.newValue || "00:00";
      if (changes.scheduleEndTime !== undefined) scheduleEndTime = changes.scheduleEndTime.newValue || "23:59";

      clearKeywordHighlights();
      clearUserHighlights();
      applyKeywordHighlights();
      applyUserHighlights();

      startTimer();
    });
  }

  // 設定値を一括更新する関数
  function applySettings(settings) {
    enabled = settings.enabled ?? true;
    intervalSeconds = settings.intervalSeconds ?? 30;
    consoleLogEnabled = settings.consoleLogEnabled ?? true;
    highlightKeywords = settings.highlightKeywords || [];
    highlightUsers = settings.highlightUsers || [];
    scheduleEnabled = settings.scheduleEnabled ?? false;
    scheduleDays = settings.scheduleDays || [];
    scheduleStartTime = settings.scheduleStartTime || "00:00";
    scheduleEndTime = settings.scheduleEndTime || "23:59";
  }

  // =========================
  // 未読情報復元
  // =========================
  function restoreUnreadTweets(savedTweets) {
    const now = Date.now();
    if (!Array.isArray(savedTweets)) return;

    for (const savedTweet of savedTweets) {
      if (!savedTweet || !savedTweet.tweetId || !savedTweet.registeredAt) continue;
      if (now - savedTweet.registeredAt >= UNREAD_EXPIRE_TIME) continue;

      unreadTweets.set(savedTweet.tweetId, {
        registeredAt: savedTweet.registeredAt,
        element: null,
        observer: null
      });
    }

    limitUnreadTweets();
    saveUnreadTweets();
  }

  // =========================
  // 既読情報復元
  // =========================
  function restoreReadTweets(savedTweets) {
    if (!Array.isArray(savedTweets)) return;

    for (const tweetId of savedTweets) {
      if (tweetId) readTweets.add(tweetId);
    }

    limitReadTweets();
    saveReadTweets();
  }

  // =========================
  // 未読/既読情報保存
  // =========================
  function saveUnreadTweets() {
    const data = [];
    for (const [tweetId, tweetData] of unreadTweets) {
      data.push({ tweetId, registeredAt: tweetData.registeredAt });
    }
    safeSendMessage({ type: "saveUnreadTweets", unreadTweets: data });
  }

  function saveReadTweets() {
    safeSendMessage({
      type: "saveReadTweets",
      readTweets: Array.from(readTweets)
    });
  }

  // =========================
  // タイマー管理
  // =========================
  function startTimer() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }

    nextUpdateAt = null;

    if (!enabled) {
      safeSendMessage({ type: "setNextUpdate", nextUpdateAt: null });
      return;
    }

    nextUpdateAt = Date.now() + intervalSeconds * 1000;
    safeSendMessage({ type: "setNextUpdate", nextUpdateAt });

    timer = setInterval(() => {
      refreshTimeline();
      nextUpdateAt = Date.now() + intervalSeconds * 1000;
      safeSendMessage({ type: "setNextUpdate", nextUpdateAt });
    }, intervalSeconds * 1000);
  }

  // =========================
  // スクロール監視
  // =========================
  function observeScroll() {
    window.addEventListener(
      "scroll",
      () => {
        isUserScrolling = true;
        if (scrollStopTimer !== null) clearTimeout(scrollStopTimer);

        scrollStopTimer = setTimeout(() => {
          isUserScrolling = false;
        }, SCROLL_STOP_DELAY);
      },
      { passive: true }
    );
    log("スクロール監視を開始");
  }

  // =========================
  // タイムライン更新
  // =========================
  function refreshTimeline() {
    if (!enabled || isUpdating) return;

    if (isUserScrolling) {
      log("スクロール中のため更新をスキップ");
      return;
    }

    if (!isHomeTimeline()) return;

    if (!isWithinSchedule()) {
      log("スケジュール外のため更新をスキップ");
      return;
    }

    const homeButton = findHomeButton();
    if (!homeButton) {
      log("ホームボタンが見つかりません");
      return;
    }

    isUpdating = true;
    log("TLを更新します");

    const currentScrollY = window.scrollY;
    const activeElement = document.activeElement;

    homeButton.click();

    setTimeout(() => {
      window.scrollTo({ top: currentScrollY, behavior: "instant" });

      if (
        activeElement &&
        typeof activeElement.focus === "function" &&
        document.contains(activeElement)
      ) {
        try {
          activeElement.focus({ preventScroll: true });
        } catch {
          activeElement.focus();
        }
      }
      isUpdating = false;
    }, 1000);
  }

  // =========================
  // スケジュール判定
  // =========================
  function isWithinSchedule() {
    if (!scheduleEnabled) return true;

    const now = new Date();
    const currentDay = now.getDay();
    if (!scheduleDays.includes(currentDay)) return false;

    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = parseTimeToMinutes(scheduleStartTime);
    const endMinutes = parseTimeToMinutes(scheduleEndTime);

    if (startMinutes === null || endMinutes === null) return false;

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    }
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }

  function parseTimeToMinutes(time) {
    if (typeof time !== "string") return null;
    const match = time.match(/^([0-9]{2}):([0-9]{2})$/);
    if (!match) return null;

    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

    return hour * 60 + minute;
  }

  // =========================
  // 既存＆新規ツイート処理
  // =========================
  function initializeExistingTweets() {
    const tweets = getTweetElements();
    log(`初期ツイート ${tweets.length}件を確認`);
    for (const tweet of tweets) {
      processTweetElement(tweet);
    }
  }

  function observeNewTweets() {
    const observer = new MutationObserver((mutations) => {
      if (!isInitialized) return;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          const tweets = [];
          if (node.matches('article[data-testid="tweet"]')) {
            tweets.push(node);
          }
          const childTweets = node.querySelectorAll('article[data-testid="tweet"]');
          tweets.push(...childTweets);

          for (const tweet of tweets) {
            processTweetElement(tweet);
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    log("新しいツイートの監視を開始");
  }

  function processTweetElement(tweetElement) {
    const tweetId = getTweetId(tweetElement);
    if (!tweetId) return;

    cleanupUnreadTweets();

    if (readTweets.has(tweetId)) return;

    if (unreadTweets.has(tweetId)) {
      const tweetData = unreadTweets.get(tweetId);
      tweetData.element = tweetElement;

      applyUnreadHighlight(tweetElement);
      applyKeywordHighlight(tweetElement);
      applyUserHighlight(tweetElement);
      observeReadStatus(tweetId, tweetElement);
      return;
    }

    registerUnreadTweet(tweetId, tweetElement);
  }

  function registerUnreadTweet(tweetId, tweetElement) {
    if (unreadTweets.has(tweetId) || readTweets.has(tweetId)) return;

    const registeredAt = Date.now();
    unreadTweets.set(tweetId, {
      registeredAt,
      element: tweetElement,
      observer: null
    });

    applyUnreadHighlight(tweetElement);
    applyKeywordHighlight(tweetElement);
    applyUserHighlight(tweetElement);
    observeReadStatus(tweetId, tweetElement);

    log("未読ツイートを登録", tweetId);

    cleanupUnreadTweets();
    limitUnreadTweets();
    saveUnreadTweets();
  }

  // =========================
  // 既読判定・化
  // =========================
  function observeReadStatus(tweetId, tweetElement) {
    const tweetData = unreadTweets.get(tweetId);
    if (!tweetData) return;

    if (tweetData.observer) tweetData.observer.disconnect();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio >= 0.5) {
            markAsRead(tweetId);
          }
        }
      },
      { threshold: [0.5] }
    );

    tweetData.observer = observer;
    observer.observe(tweetElement);
  }

  function markAsRead(tweetId) {
    const tweetData = unreadTweets.get(tweetId);
    if (!tweetData) return;

    if (tweetData.element) removeUnreadHighlight(tweetData.element);
    if (tweetData.observer) tweetData.observer.disconnect();

    unreadTweets.delete(tweetId);
    readTweets.add(tweetId);

    limitReadTweets();
    saveUnreadTweets();
    saveReadTweets();

    log("ツイートを既読化", tweetId);
  }

  // =========================
  // ハイライト制御
  // =========================
  function applyUnreadHighlight(tweetElement) {
    if (!tweetElement) return;
    tweetElement.dataset.xarUnread = "true";
    tweetElement.style.borderLeft = "4px solid rgb(120, 86, 255)";
    tweetElement.style.backgroundColor = "rgba(120, 86, 255, 0.05)";
  }

  function removeUnreadHighlight(tweetElement) {
    if (!tweetElement) return;
    delete tweetElement.dataset.xarUnread;
    tweetElement.style.borderLeft = "";
    tweetElement.style.backgroundColor = "";
  }

  function applyKeywordHighlights() {
    const tweets = getTweetElements();
    for (const tweet of tweets) applyKeywordHighlight(tweet);
  }

  function applyKeywordHighlight(tweetElement) {
    if (!tweetElement || !highlightKeywords.length) return;

    const textNodes = getTextNodes(tweetElement);
    for (const textNode of textNodes) {
      const text = textNode.nodeValue;
      if (!text) continue;

      for (const keyword of highlightKeywords) {
        if (!keyword) continue;
        if (text.toLowerCase().includes(keyword.toLowerCase())) {
          highlightTextNode(textNode, keyword);
          break;
        }
      }
    }
  }

  function clearKeywordHighlights() {
    const marks = document.querySelectorAll('mark[data-xar-keyword="true"]');
    for (const mark of marks) {
      const parent = mark.parentNode;
      if (!parent) continue;

      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    }
  }

  function getTextNodes(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let currentNode;

    while ((currentNode = walker.nextNode())) {
      if (
        currentNode.parentElement &&
        currentNode.parentElement.closest('mark[data-xar-keyword="true"]')
      ) {
        continue;
      }
      textNodes.push(currentNode);
    }
    return textNodes;
  }

  function highlightTextNode(textNode, keyword) {
    const text = textNode.nodeValue;
    const index = text.toLowerCase().indexOf(keyword.toLowerCase());
    if (index === -1) return;

    const fragment = document.createDocumentFragment();
    const beforeText = text.slice(0, index);
    const matchedText = text.slice(index, index + keyword.length);
    const afterText = text.slice(index + keyword.length);

    if (beforeText) fragment.appendChild(document.createTextNode(beforeText));

    const mark = document.createElement("mark");
    mark.dataset.xarKeyword = "true";
    mark.textContent = matchedText;
    mark.style.backgroundColor = "rgba(255, 200, 0, 0.35)";
    mark.style.color = "inherit";
    mark.style.borderRadius = "3px";
    mark.style.padding = "1px 2px";
    fragment.appendChild(mark);

    if (afterText) fragment.appendChild(document.createTextNode(afterText));

    textNode.parentNode.replaceChild(fragment, textNode);
  }

  function applyUserHighlights() {
    const tweets = getTweetElements();
    for (const tweet of tweets) applyUserHighlight(tweet);
  }

  function applyUserHighlight(tweetElement) {
    if (!tweetElement) return;
    const username = getTweetUsername(tweetElement);
    if (!username || !highlightUsers.includes(username)) return;

    tweetElement.dataset.xarUserHighlight = "true";
    tweetElement.style.boxShadow = "inset 4px 0 0 rgb(255, 193, 7)";
  }

  function clearUserHighlights() {
    const tweets = document.querySelectorAll(
      'article[data-testid="tweet"][data-xar-user-highlight="true"]'
    );
    for (const tweet of tweets) {
      delete tweet.dataset.xarUserHighlight;
      tweet.style.boxShadow = "";
    }
  }

  // =========================
  // 制限 & メモリ管理
  // =========================
  function cleanupUnreadTweets() {
    const now = Date.now();
    let changed = false;

    for (const [tweetId, tweetData] of unreadTweets) {
      if (now - tweetData.registeredAt >= UNREAD_EXPIRE_TIME) {
        if (tweetData.element) removeUnreadHighlight(tweetData.element);
        if (tweetData.observer) tweetData.observer.disconnect();

        unreadTweets.delete(tweetId);
        changed = true;
        log("未読期限切れ", tweetId);
      }
    }
    if (changed) saveUnreadTweets();
  }

  function limitUnreadTweets() {
    let changed = false;
    while (unreadTweets.size > MAX_UNREAD) {
      const oldestTweetId = unreadTweets.keys().next().value;
      const oldestTweet = unreadTweets.get(oldestTweetId);

      if (oldestTweet) {
        if (oldestTweet.element) removeUnreadHighlight(oldestTweet.element);
        if (oldestTweet.observer) oldestTweet.observer.disconnect();
      }

      unreadTweets.delete(oldestTweetId);
      changed = true;
      log("古い未読ツイートを削除", oldestTweetId);
    }
    if (changed) saveUnreadTweets();
  }

  function limitReadTweets() {
    while (readTweets.size > MAX_READ) {
      const oldestTweetId = readTweets.values().next().value;
      readTweets.delete(oldestTweetId);
    }
  }

  // =========================
  // DOM取得ヘルパー
  // =========================
  function getTweetUsername(tweetElement) {
    const userNameContainer = tweetElement.querySelector('[data-testid="User-Name"]');
    if (!userNameContainer) return null;

    const links = userNameContainer.querySelectorAll('a[href^="/"]');
    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const match = href.match(/^\/([A-Za-z0-9_]+)$/);
      if (match && !["home", "explore", "notifications", "messages"].includes(match[1])) {
        return match[1];
      }
    }
    return null;
  }

  function getTweetElements() {
    return document.querySelectorAll('article[data-testid="tweet"]');
  }

  function getTweetId(tweetElement) {
    const links = tweetElement.querySelectorAll('a[href*="/status/"]');
    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const match = href.match(/\/status\/(\d+)/);
      if (match) return match[1];
    }
    return null;
  }

  function isHomeTimeline() {
    const path = window.location.pathname;
    return path === "/" || path === "/home" || path === "/i/home";
  }

  function findHomeButton() {
    const elements = document.querySelectorAll('a, button, [role="button"]');
    for (const element of elements) {
      const href = element.getAttribute("href") || "";
      const ariaLabel = element.getAttribute("aria-label") || "";
      const text = (element.innerText || element.textContent || "").trim();

      if (href === "/home" || href === "/") return element;

      const combined = (ariaLabel + " " + text).toLowerCase();
      if (combined === "ホーム" || combined === "home") return element;
    }
    return null;
  }
})();
