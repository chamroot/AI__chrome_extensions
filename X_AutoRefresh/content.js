(() => {
  "use strict";

  let enabled = true;
  let intervalSeconds = 30;
  let timer = null;
  let isUpdating = false;

  // =========================
  // 初期設定
  // =========================

  chrome.storage.local.get(
    {
      enabled: true,
      intervalSeconds: 30
    },
    (settings) => {
      enabled = settings.enabled;
      intervalSeconds = settings.intervalSeconds;

      console.log("[X Auto Refresh] 起動", {
        enabled,
        intervalSeconds
      });

      startTimer();
    }
  );

  // =========================
  // 設定変更監視
  // =========================

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) {
      enabled = changes.enabled.newValue;
    }

    if (changes.intervalSeconds) {
      intervalSeconds = changes.intervalSeconds.newValue;
    }

    startTimer();

    console.log("[X Auto Refresh] 設定変更", {
      enabled,
      intervalSeconds
    });
  });

  // =========================
  // タイマー
  // =========================

  function startTimer() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }

    if (!enabled) {
      console.log("[X Auto Refresh] OFF");
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
  // TL更新
  // =========================

  function refreshTimeline() {
    if (!enabled || isUpdating) {
      return;
    }

    if (!isHomeTimeline()) {
      return;
    }

    const homeButton = findHomeButton();

    if (!homeButton) {
      console.log(
        "[X Auto Refresh] ホームボタンが見つかりません"
      );
      return;
    }

    isUpdating = true;

    console.log(
      "[X Auto Refresh] ページをリロードせずTLを更新します"
    );

    const currentScrollY = window.scrollY;
    const activeElement = document.activeElement;

    homeButton.click();

    console.log(
      "[X Auto Refresh] ホームTLを再選択しました"
    );

    setTimeout(() => {
      window.scrollTo({
        top: currentScrollY,
        behavior: "instant"
      });

      if (
        activeElement &&
        typeof activeElement.focus === "function" &&
        document.contains(activeElement)
      ) {
        try {
          activeElement.focus({
            preventScroll: true
          });
        } catch {
          activeElement.focus();
        }
      }

      isUpdating = false;

    }, 1000);
  }

  // =========================
  // ホームTL判定
  // =========================

  function isHomeTimeline() {
    const path = window.location.pathname;

    return (
      path === "/" ||
      path === "/home" ||
      path === "/i/home"
    );
  }

  // =========================
  // ホームボタン検索
  // =========================

  function findHomeButton() {
    const elements = document.querySelectorAll(
      'a, button, [role="button"]'
    );

    for (const element of elements) {
      const href =
        element.getAttribute("href") || "";

      const ariaLabel =
        element.getAttribute("aria-label") || "";

      const text = (
        element.innerText ||
        element.textContent ||
        ""
      ).trim();

      if (
        href === "/home" ||
        href === "/"
      ) {
        return element;
      }

      const combined = (
        ariaLabel +
        " " +
        text
      ).toLowerCase();

      if (
        combined === "ホーム" ||
        combined === "home"
      ) {
        return element;
      }
    }

    return null;
  }

})();
