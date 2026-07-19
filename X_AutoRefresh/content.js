(() => {
  "use strict";

  // =========================
  // 基本設定
  // =========================

  let enabled = true;
  let intervalSeconds = 30;
  let timer = null;
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

  const MAX_UNREAD = 100;
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
  // 初期設定読み込み
  // =========================

  chrome.storage.local.get(
    {
      enabled: true,
      intervalSeconds: 30,
      highlightKeywords: [],
      highlightUsers: [],
      scheduleEnabled: false,
      scheduleDays: [],
      scheduleStartTime: "00:00",
      scheduleEndTime: "23:59",
      unreadTweets: []
    },
    (settings) => {
      enabled = settings.enabled;
      intervalSeconds = settings.intervalSeconds;

      highlightKeywords =
        settings.highlightKeywords || [];

      highlightUsers =
        settings.highlightUsers || [];

      scheduleEnabled =
        settings.scheduleEnabled;

      scheduleDays =
        settings.scheduleDays || [];

      scheduleStartTime =
        settings.scheduleStartTime || "00:00";

      scheduleEndTime =
        settings.scheduleEndTime || "23:59";

      restoreUnreadTweets(
        settings.unreadTweets
      );

      console.log(
        "[X Auto Refresh] 起動",
        {
          enabled,
          intervalSeconds,
          highlightKeywords,
          highlightUsers,
          scheduleEnabled,
          scheduleDays,
          scheduleStartTime,
          scheduleEndTime,
          unreadTweets: unreadTweets.size
        }
      );

      initializeExistingTweets();

      applyKeywordHighlights();
      applyUserHighlights();

      observeNewTweets();
      observeScroll();

      isInitialized = true;

      startTimer();
    }
  );

  // =========================
  // 設定変更監視
  // =========================

  chrome.storage.onChanged.addListener(
    (changes) => {
      if (changes.enabled) {
        enabled =
          changes.enabled.newValue;
      }

      if (changes.intervalSeconds) {
        intervalSeconds =
          changes.intervalSeconds.newValue;
      }

      if (changes.highlightKeywords) {
        highlightKeywords =
          changes.highlightKeywords.newValue || [];

        clearKeywordHighlights();
        applyKeywordHighlights();
      }

      if (changes.highlightUsers) {
        highlightUsers =
          changes.highlightUsers.newValue || [];

        clearUserHighlights();
        applyUserHighlights();
      }

      if (changes.scheduleEnabled) {
        scheduleEnabled =
          changes.scheduleEnabled.newValue;
      }

      if (changes.scheduleDays) {
        scheduleDays =
          changes.scheduleDays.newValue || [];
      }

      if (changes.scheduleStartTime) {
        scheduleStartTime =
          changes.scheduleStartTime.newValue || "00:00";
      }

      if (changes.scheduleEndTime) {
        scheduleEndTime =
          changes.scheduleEndTime.newValue || "23:59";
      }

      startTimer();

      console.log(
        "[X Auto Refresh] 設定変更",
        {
          enabled,
          intervalSeconds,
          highlightKeywords,
          highlightUsers,
          scheduleEnabled,
          scheduleDays,
          scheduleStartTime,
          scheduleEndTime
        }
      );
    }
  );

  // =========================
  // 未読情報復元
  // =========================

  function restoreUnreadTweets(
    savedTweets
  ) {
    const now = Date.now();

    if (!Array.isArray(savedTweets)) {
      return;
    }

    for (
      const savedTweet of savedTweets
    ) {
      if (
        !savedTweet ||
        !savedTweet.tweetId ||
        !savedTweet.registeredAt
      ) {
        continue;
      }

      if (
        now - savedTweet.registeredAt >=
        UNREAD_EXPIRE_TIME
      ) {
        continue;
      }

      unreadTweets.set(
        savedTweet.tweetId,
        {
          registeredAt:
            savedTweet.registeredAt,

          element: null,

          observer: null
        }
      );
    }

    limitUnreadTweets();

    saveUnreadTweets();
  }

  // =========================
  // 未読情報保存
  // =========================

  function saveUnreadTweets() {
    const data = [];

    for (
      const [
        tweetId,
        tweetData
      ] of unreadTweets
    ) {
      data.push(
        {
          tweetId,

          registeredAt:
            tweetData.registeredAt
        }
      );
    }

    chrome.storage.local.set(
      {
        unreadTweets: data
      }
    );
  }

  // =========================
  // タイマー
  // =========================

  function startTimer() {
    if (timer !== null) {
      clearInterval(timer);

      timer = null;
    }

    if (!enabled) {
      console.log(
        "[X Auto Refresh] OFF"
      );

      return;
    }

    timer = setInterval(
      refreshTimeline,
      intervalSeconds * 1000
    );

    console.log(
      `[X Auto Refresh] ${intervalSeconds}秒ごとにTLを更新`
    );
  }

  // =========================
  // スクロール監視
  // =========================

  function observeScroll() {
    window.addEventListener(
      "scroll",
      () => {
        isUserScrolling = true;

        if (
          scrollStopTimer !== null
        ) {
          clearTimeout(
            scrollStopTimer
          );
        }

        scrollStopTimer = setTimeout(
          () => {
            isUserScrolling = false;
          },
          SCROLL_STOP_DELAY
        );
      },
      {
        passive: true
      }
    );

    console.log(
      "[X Auto Refresh] スクロール監視を開始"
    );
  }

  // =========================
  // TL更新
  // =========================

  function refreshTimeline() {
    if (
      !enabled ||
      isUpdating
    ) {
      return;
    }

    if (isUserScrolling) {
      console.log(
        "[X Auto Refresh] スクロール中のため更新をスキップ"
      );

      return;
    }

    if (!isHomeTimeline()) {
      return;
    }

    if (!isWithinSchedule()) {
      console.log(
        "[X Auto Refresh] スケジュール外のため更新をスキップ"
      );

      return;
    }

    const newTweetsButton =
      findNewTweetsButton();

    if (!newTweetsButton) {
      console.log(
        "[X Auto Refresh] 新着ツイートボタンが見つかりません"
      );

      return;
    }

    isUpdating = true;

    console.log(
      "[X Auto Refresh] 新着ツイートを取得します"
    );

    const currentScrollY =
      window.scrollY;

    const activeElement =
      document.activeElement;

    newTweetsButton.click();

    setTimeout(
      () => {
        window.scrollTo(
          {
            top: currentScrollY,

            behavior: "instant"
          }
        );

        if (
          activeElement &&
          typeof activeElement.focus ===
            "function" &&
          document.contains(
            activeElement
          )
        ) {
          try {
            activeElement.focus(
              {
                preventScroll: true
              }
            );
          } catch {
            activeElement.focus();
          }
        }

        isUpdating = false;
      },
      1000
    );
  }

  // =========================
  // スケジュール判定
  // =========================

  function isWithinSchedule() {
    if (!scheduleEnabled) {
      return true;
    }

    const now = new Date();

    const currentDay =
      now.getDay();

    if (
      !scheduleDays.includes(
        currentDay
      )
    ) {
      return false;
    }

    const currentMinutes =
      now.getHours() * 60 +
      now.getMinutes();

    const startMinutes =
      parseTimeToMinutes(
        scheduleStartTime
      );

    const endMinutes =
      parseTimeToMinutes(
        scheduleEndTime
      );

    if (
      startMinutes === null ||
      endMinutes === null
    ) {
      return false;
    }

    if (
      startMinutes <= endMinutes
    ) {
      return (
        currentMinutes >=
          startMinutes &&
        currentMinutes <=
          endMinutes
      );
    }

    return (
      currentMinutes >=
        startMinutes ||
      currentMinutes <=
        endMinutes
    );
  }

  // =========================
  // 時刻を分に変換
  // =========================

  function parseTimeToMinutes(
    time
  ) {
    if (
      typeof time !==
      "string"
    ) {
      return null;
    }

    const match =
      time.match(
        /^([0-9]{2}):([0-9]{2})$/
      );

    if (!match) {
      return null;
    }

    const hour =
      Number(match[1]);

    const minute =
      Number(match[2]);

    if (
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59
    ) {
      return null;
    }

    return (
      hour * 60 +
      minute
    );
  }

  // =========================
  // 起動時の既存ツイート
  // =========================

  function initializeExistingTweets() {
    const tweets =
      getTweetElements();

    console.log(
      `[X Auto Refresh] 初期ツイート ${tweets.length}件を確認`
    );

    for (
      const tweet of tweets
    ) {
      processTweetElement(
        tweet
      );
    }
  }

  // =========================
  // 新しいツイート監視
  // =========================

  function observeNewTweets() {
    const observer =
      new MutationObserver(
        (mutations) => {
          if (!isInitialized) {
            return;
          }

          for (
            const mutation of mutations
          ) {
            for (
              const node of mutation.addedNodes
            ) {
              if (
                node.nodeType !==
                Node.ELEMENT_NODE
              ) {
                continue;
              }

              const tweets = [];

              if (
                node.matches(
                  'article[data-testid="tweet"]'
                )
              ) {
                tweets.push(node);
              }

              const childTweets =
                node.querySelectorAll(
                  'article[data-testid="tweet"]'
                );

              tweets.push(
                ...childTweets
              );

              for (
                const tweet of tweets
              ) {
                processTweetElement(
                  tweet
                );
              }
            }
          }
        }
      );

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );

    console.log(
      "[X Auto Refresh] 新しいツイートの監視を開始"
    );
  }

  // =========================
  // ツイート処理
  // =========================

  function processTweetElement(
    tweetElement
  ) {
    const tweetId =
      getTweetId(
        tweetElement
      );

    if (!tweetId) {
      return;
    }

    cleanupUnreadTweets();

    // =========================
    // 保存済み未読
    // =========================

    if (
      unreadTweets.has(
        tweetId
      )
    ) {
      const tweetData =
        unreadTweets.get(
          tweetId
        );

      tweetData.element =
        tweetElement;

      applyUnreadHighlight(
        tweetElement
      );

      applyKeywordHighlight(
        tweetElement
      );

      applyUserHighlight(
        tweetElement
      );

      observeReadStatus(
        tweetId,
        tweetElement
      );

      return;
    }

    // =========================
    // 新規ツイート
    // =========================

    registerUnreadTweet(
      tweetId,
      tweetElement
    );
  }

  // =========================
  // 未読ツイート登録
  // =========================

  function registerUnreadTweet(
    tweetId,
    tweetElement
  ) {
    if (
      unreadTweets.has(
        tweetId
      )
    ) {
      return;
    }

    const registeredAt =
      Date.now();

    unreadTweets.set(
      tweetId,
      {
        registeredAt,

        element:
          tweetElement,

        observer:
          null
      }
    );

    applyUnreadHighlight(
      tweetElement
    );

    applyKeywordHighlight(
      tweetElement
    );

    applyUserHighlight(
      tweetElement
    );

    observeReadStatus(
      tweetId,
      tweetElement
    );

    console.log(
      "[X Auto Refresh] 未読ツイートを登録",
      tweetId
    );

    cleanupUnreadTweets();

    limitUnreadTweets();

    saveUnreadTweets();
  }

  // =========================
  // 既読判定
  // =========================

  function observeReadStatus(
    tweetId,
    tweetElement
  ) {
    const tweetData =
      unreadTweets.get(
        tweetId
      );

    if (!tweetData) {
      return;
    }

    if (
      tweetData.observer
    ) {
      tweetData.observer.disconnect();
    }

    const observer =
      new IntersectionObserver(
        (entries) => {
          for (
            const entry of entries
          ) {
            if (
              entry.intersectionRatio >=
              0.5
            ) {
              markAsRead(
                tweetId
              );
            }
          }
        },
        {
          threshold: [0.5]
        }
      );

    tweetData.observer =
      observer;

    observer.observe(
      tweetElement
    );
  }

  // =========================
  // 既読化
  // =========================

  function markAsRead(
    tweetId
  ) {
    const tweetData =
      unreadTweets.get(
        tweetId
      );

    if (!tweetData) {
      return;
    }

    if (
      tweetData.element
    ) {
      removeUnreadHighlight(
        tweetData.element
      );
    }

    if (
      tweetData.observer
    ) {
      tweetData.observer.disconnect();
    }

    unreadTweets.delete(
      tweetId
    );

    saveUnreadTweets();

    console.log(
      "[X Auto Refresh] ツイートを既読化",
      tweetId
    );
  }

  // =========================
  // 未読ハイライト
  // =========================

  function applyUnreadHighlight(
    tweetElement
  ) {
    if (!tweetElement) {
      return;
    }

    tweetElement.dataset.xarUnread =
      "true";

    tweetElement.style.borderLeft =
      "4px solid rgb(120, 86, 255)";

    tweetElement.style.backgroundColor =
      "rgba(120, 86, 255, 0.05)";
  }

  function removeUnreadHighlight(
    tweetElement
  ) {
    if (!tweetElement) {
      return;
    }

    delete tweetElement.dataset.xarUnread;

    tweetElement.style.borderLeft =
      "";

    tweetElement.style.backgroundColor =
      "";
  }

  // =========================
  // 未読期限切れ処理
  // =========================

  function cleanupUnreadTweets() {
    const now =
      Date.now();

    let changed = false;

    for (
      const [
        tweetId,
        tweetData
      ] of unreadTweets
    ) {
      if (
        now -
          tweetData.registeredAt >=
        UNREAD_EXPIRE_TIME
      ) {
        if (
          tweetData.element
        ) {
          removeUnreadHighlight(
            tweetData.element
          );
        }

        if (
          tweetData.observer
        ) {
          tweetData.observer.disconnect();
        }

        unreadTweets.delete(
          tweetId
        );

        changed = true;

        console.log(
          "[X Auto Refresh] 未読期限切れ",
          tweetId
        );
      }
    }

    if (changed) {
      saveUnreadTweets();
    }
  }

  // =========================
  // 最大100件に制限
  // =========================

  function limitUnreadTweets() {
    let changed = false;

    while (
      unreadTweets.size >
      MAX_UNREAD
    ) {
      const oldestTweetId =
        unreadTweets.keys()
          .next()
          .value;

      const oldestTweet =
        unreadTweets.get(
          oldestTweetId
        );

      if (oldestTweet) {
        if (
          oldestTweet.element
        ) {
          removeUnreadHighlight(
            oldestTweet.element
          );
        }

        if (
          oldestTweet.observer
        ) {
          oldestTweet.observer.disconnect();
        }
      }

      unreadTweets.delete(
        oldestTweetId
      );

      changed = true;

      console.log(
        "[X Auto Refresh] 古い未読ツイートを削除",
        oldestTweetId
      );
    }

    if (changed) {
      saveUnreadTweets();
    }
  }

  // =========================
  // キーワードハイライト
  // =========================

  function applyKeywordHighlights() {
    const tweets =
      getTweetElements();

    for (
      const tweet of tweets
    ) {
      applyKeywordHighlight(
        tweet
      );
    }
  }

  function applyKeywordHighlight(
    tweetElement
  ) {
    if (!tweetElement) {
      return;
    }

    if (
      !highlightKeywords.length
    ) {
      return;
    }

    const textNodes =
      getTextNodes(
        tweetElement
      );

    for (
      const textNode of textNodes
    ) {
      const text =
        textNode.nodeValue;

      if (!text) {
        continue;
      }

      const matchedKeyword =
        highlightKeywords.find(
          (keyword) => {
            if (!keyword) {
              return false;
            }

            return text
              .toLowerCase()
              .includes(
                keyword.toLowerCase()
              );
          }
        );

      if (!matchedKeyword) {
        continue;
      }

      highlightTextNode(
        textNode,
        matchedKeyword
      );
    }
  }

  // =========================
  // キーワードハイライト解除
  // =========================

  function clearKeywordHighlights() {
    const marks =
      document.querySelectorAll(
        'mark[data-xar-keyword="true"]'
      );

    for (
      const mark of marks
    ) {
      const parent =
        mark.parentNode;

      if (!parent) {
        continue;
      }

      parent.replaceChild(
        document.createTextNode(
          mark.textContent
        ),
        mark
      );

      parent.normalize();
    }
  }

  // =========================
  // テキストノード取得
  // =========================

  function getTextNodes(
    element
  ) {
    const walker =
      document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT
      );

    const textNodes = [];

    let currentNode;

    while (
      currentNode =
        walker.nextNode()
    ) {
      if (
        currentNode.parentElement &&
        currentNode.parentElement.closest(
          'mark[data-xar-keyword="true"]'
        )
      ) {
        continue;
      }

      textNodes.push(
        currentNode
      );
    }

    return textNodes;
  }

  // =========================
  // キーワード部分をハイライト
  // =========================

  function highlightTextNode(
    textNode,
    keyword
  ) {
    const text =
      textNode.nodeValue;

    const lowerText =
      text.toLowerCase();

    const lowerKeyword =
      keyword.toLowerCase();

    const index =
      lowerText.indexOf(
        lowerKeyword
      );

    if (index === -1) {
      return;
    }

    const fragment =
      document.createDocumentFragment();

    const beforeText =
      text.slice(
        0,
        index
      );

    const matchedText =
      text.slice(
        index,
        index + keyword.length
      );

    const afterText =
      text.slice(
        index + keyword.length
      );

    if (beforeText) {
      fragment.appendChild(
        document.createTextNode(
          beforeText
        )
      );
    }

    const mark =
      document.createElement(
        "mark"
      );

    mark.dataset.xarKeyword =
      "true";

    mark.textContent =
      matchedText;

    mark.style.backgroundColor =
      "rgba(255, 200, 0, 0.35)";

    mark.style.color =
      "inherit";

    mark.style.borderRadius =
      "3px";

    mark.style.padding =
      "1px 2px";

    fragment.appendChild(
      mark
    );

    if (afterText) {
      fragment.appendChild(
        document.createTextNode(
          afterText
        )
      );
    }

    textNode.parentNode.replaceChild(
      fragment,
      textNode
    );
  }

  // =========================
  // ユーザーハイライト
  // =========================

  function applyUserHighlights() {
    const tweets =
      getTweetElements();

    for (
      const tweet of tweets
    ) {
      applyUserHighlight(
        tweet
      );
    }
  }

  function applyUserHighlight(
    tweetElement
  ) {
    if (!tweetElement) {
      return;
    }

    const username =
      getTweetUsername(
        tweetElement
      );

    if (!username) {
      return;
    }

    if (
      !highlightUsers.includes(
        username
      )
    ) {
      return;
    }

    tweetElement.dataset.xarUserHighlight =
      "true";

    tweetElement.style.boxShadow =
      "inset 4px 0 0 rgb(255, 193, 7)";
  }

  // =========================
  // ユーザーハイライト解除
  // =========================

  function clearUserHighlights() {
    const tweets =
      document.querySelectorAll(
        'article[data-testid="tweet"][data-xar-user-highlight="true"]'
      );

    for (
      const tweet of tweets
    ) {
      delete tweet.dataset.xarUserHighlight;

      tweet.style.boxShadow =
        "";
    }
  }

  // =========================
  // ユーザーID取得
  // =========================

  function getTweetUsername(
    tweetElement
  ) {
    const links =
      tweetElement.querySelectorAll(
        'a[href^="/"]'
      );

    for (
      const link of links
    ) {
      const href =
        link.getAttribute(
          "href"
        ) || "";

      const match =
        href.match(
          /^\/([A-Za-z0-9_]+)$/
        );

      if (match) {
        return match[1];
      }
    }

    return null;
  }

  // =========================
  // ツイート一覧取得
  // =========================

  function getTweetElements() {
    return document.querySelectorAll(
      'article[data-testid="tweet"]'
    );
  }

  // =========================
  // ツイートID取得
  // =========================

  function getTweetId(
    tweetElement
  ) {
    const links =
      tweetElement.querySelectorAll(
        'a[href*="/status/"]'
      );

    for (
      const link of links
    ) {
      const href =
        link.getAttribute(
          "href"
        ) || "";

      const match =
        href.match(
          /\/status\/(\d+)/
        );

      if (match) {
        return match[1];
      }
    }

    return null;
  }

  // =========================
  // ホームTL判定
  // =========================

  function isHomeTimeline() {
    const path =
      window.location.pathname;

    return (
      path === "/" ||
      path === "/home" ||
      path === "/i/home"
    );
  }

  // =========================
  // 新着ツイートボタン検索
  // =========================

  function findNewTweetsButton() {
    const elements =
      document.querySelectorAll(
        'a, button, [role="button"]'
      );

    for (
      const element of elements
    ) {
      const ariaLabel =
        element.getAttribute(
          "aria-label"
        ) || "";

      const text =
        (
          element.innerText ||
          element.textContent ||
          ""
        ).trim();

      const combined =
        (
          ariaLabel +
          " " +
          text
        ).toLowerCase();

      if (
        combined.includes(
          "新しいポスト"
        ) ||
        combined.includes(
          "新しいポストを表示"
        ) ||
        combined.includes(
          "show new posts"
        ) ||
        combined.includes(
          "see new posts"
        )
      ) {
        return element;
      }
    }

    return null;
  }
})();
