// =========================
// DOM取得
// =========================
const enabledElement = document.getElementById("enabled");
const intervalElement = document.getElementById("interval");
const scheduleEnabledElement = document.getElementById("scheduleEnabled");
const scheduleSettingsElement = document.getElementById("scheduleSettings");
const scheduleStartElement = document.getElementById("scheduleStart");
const scheduleEndElement = document.getElementById("scheduleEnd");
const scheduleDayElements = document.querySelectorAll('input[name="scheduleDay"]');
const consoleLogEnabledElement = document.getElementById("consoleLogEnabled");
const keywordInput = document.getElementById("keywordInput");
const addKeywordButton = document.getElementById("addKeyword");
const keywordList = document.getElementById("keywordList");
const userInput = document.getElementById("userInput");
const addUserButton = document.getElementById("addUser");
const userList = document.getElementById("userList");
const settingsTab = document.getElementById("settingsTab");
const debugTab = document.getElementById("debugTab");
const settingsTabContent = document.getElementById("settingsTabContent");
const debugTabContent = document.getElementById("debugTabContent");
const debugModeEnabledElement = document.getElementById("debugModeEnabled");
const debugLabelElement = document.getElementById("debugLabel");
const nextUpdateElement = document.getElementById("nextUpdate");

// =========================
// 拡張機能情報・アイコン設定
// =========================
const manifest = chrome.runtime.getManifest();
const extensionNameElement = document.getElementById("extensionName");
const extensionVersionElement = document.getElementById("extensionVersion");
const extensionIconElement = document.getElementById("extensionIcon");

if (extensionNameElement) extensionNameElement.textContent = manifest.name;

if (extensionVersionElement) extensionVersionElement.textContent = "v" + manifest.version;

if (manifest.icons && manifest.icons["48"] && extensionIconElement) {
  extensionIconElement.src = chrome.runtime.getURL(manifest.icons["48"]);
}

// =========================
// 初期設定読み込み
// =========================
const defaultSettings = {
  enabled: true,
  intervalSeconds: 30,
  highlightKeywords: [],
  highlightUsers: [],
  scheduleEnabled: false,
  scheduleDays: [],
  scheduleStartTime: "00:00",
  scheduleEndTime: "23:59",
  consoleLogEnabled: true,
  debugModeEnabled: false
};

chrome.storage.local.get(defaultSettings, (settings) => {
  enabledElement.checked = settings.enabled;
  intervalElement.value = String(settings.intervalSeconds);
  scheduleEnabledElement.checked = settings.scheduleEnabled;
  scheduleStartElement.value = settings.scheduleStartTime;
  scheduleEndElement.value = settings.scheduleEndTime;
  consoleLogEnabledElement.checked = settings.consoleLogEnabled;
  debugModeEnabledElement.checked = settings.debugModeEnabled;
  updateDebugMode();

  for (const dayElement of scheduleDayElements) {
    const day = Number(dayElement.value);
    dayElement.checked = settings.scheduleDays.includes(day);
  }

  renderKeywords(settings.highlightKeywords);
  renderUsers(settings.highlightUsers);
  updateScheduleDisabledState();
});

// =========================
// ストレージ変更の監視 (描画の自動更新)
// =========================
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  if (changes.highlightKeywords) {
    renderKeywords(changes.highlightKeywords.newValue || []);
  }

  if (changes.highlightUsers) {
    renderUsers(changes.highlightUsers.newValue || []);
  }

  if (changes.consoleLogEnabled) {
    consoleLogEnabledElement.checked = changes.consoleLogEnabled.newValue;
  }

  if (changes.debugModeEnabled) {
    debugModeEnabledElement.checked = changes.debugModeEnabled.newValue;
    updateDebugMode();
  }

  if (changes.nextUpdateAt) {
    updateNextUpdate();
  }
});

// =========================
// イベントリスナー設定
// =========================
enabledElement.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: enabledElement.checked });
});

intervalElement.addEventListener("change", () => {
  chrome.storage.local.set({ intervalSeconds: Number(intervalElement.value) });
});

scheduleEnabledElement.addEventListener("change", () => {
  chrome.storage.local.set({ scheduleEnabled: scheduleEnabledElement.checked });
  updateScheduleDisabledState();
});

consoleLogEnabledElement.addEventListener("change", () => {
  chrome.storage.local.set({ consoleLogEnabled: consoleLogEnabledElement.checked });
});

debugModeEnabledElement.addEventListener("change", () => {
  chrome.storage.local.set({ debugModeEnabled: debugModeEnabledElement.checked });
  updateDebugMode();
});

settingsTab.addEventListener("click", () => {
  settingsTab.classList.add("active");
  debugTab.classList.remove("active");
  settingsTabContent.classList.add("active");
  debugTabContent.classList.remove("active");
});

debugTab.addEventListener("click", () => {
  debugTab.classList.add("active");
  settingsTab.classList.remove("active");
  debugTabContent.classList.add("active");
  settingsTabContent.classList.remove("active");
});

for (const dayElement of scheduleDayElements) {
  dayElement.addEventListener("change", saveSchedule);
}

// スケジュール時刻入力の制御
[scheduleStartElement, scheduleEndElement].forEach(element => {
  element.addEventListener("input", () => {
    element.value = sanitizeTimeInput(element.value);
  });

  element.addEventListener("change", () => {
    const normalized = normalizeTime(element.value);

    if (normalized) {
      element.value = normalized;
      saveSchedule();
    }
  });
});

// キーワード・ユーザー追加イベント
addKeywordButton.addEventListener("click", addKeyword);
keywordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addKeyword();
});

addUserButton.addEventListener("click", addUser);
userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addUser();
});

setInterval(
  updateNextUpdate,
  1000
);

// =========================
// 各種機能関数
// =========================
function updateDebugMode() {
  const enabled = debugModeEnabledElement.checked;

  debugLabelElement.hidden = !enabled;
  nextUpdateElement.hidden = !enabled;

  if (enabled) {
    updateNextUpdate();
  }
}
function updateNextUpdate() {
  chrome.storage.local.get(
    { nextUpdateAt: null },
    (settings) => {
      if (!debugModeEnabledElement.checked) {
        return;
      }

      if (!settings.nextUpdateAt) {
        nextUpdateElement.textContent =
          "次回更新: --";
        return;
      }

      const remaining =
        Math.max(
          0,
          settings.nextUpdateAt - Date.now()
        );

      const seconds =
        Math.ceil(
          remaining / 1000
        );

      if (seconds >= 60) {
        const minutes =
          Math.floor(seconds / 60);

        const remainingSeconds =
          seconds % 60;

        nextUpdateElement.textContent =
          `次回更新まで: ${minutes}分${remainingSeconds}秒`;
      } else {
        nextUpdateElement.textContent =
          `次回更新まで: ${seconds}秒`;
      }
    }
  );
}
function updateScheduleDisabledState() {
  const disabled = !scheduleEnabledElement.checked;
  scheduleSettingsElement.classList.toggle("disabled", disabled);

  for (const dayElement of scheduleDayElements) {
    dayElement.disabled = disabled;
  }

  scheduleStartElement.disabled = disabled;
  scheduleEndElement.disabled = disabled;
}

function saveSchedule() {
  const days = Array.from(scheduleDayElements)
    .filter(el => el.checked)
    .map(el => Number(el.value));

  chrome.storage.local.set({
    scheduleDays: days,
    scheduleStartTime: scheduleStartElement.value,
    scheduleEndTime: scheduleEndElement.value
  });
}

function sanitizeTimeInput(value) {
  let digits = value.replace(/[^0-9]/g, "");
  digits = digits.slice(0, 4);

  if (digits.length > 2) {
    return digits.slice(0, 2) + ":" + digits.slice(2);
  }

  return digits;
}

function normalizeTime(value) {
  const time = value.trim();

  if (!time) return null;

  const sanitized = sanitizeTimeInput(time);
  const match = sanitized.match(/^(\d{1,2}):(\d{2})$/);

  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
}

// 登録・削除ロジック
function addKeyword() {
  const keyword = keywordInput.value.trim();

  if (!keyword) return;

  chrome.storage.local.get({ highlightKeywords: [] }, (settings) => {
    const keywords = settings.highlightKeywords;

    if (!keywords.includes(keyword)) {
      keywords.push(keyword);

      chrome.storage.local.set({ highlightKeywords: keywords }, () => {
        keywordInput.value = "";
      });
    } else {
      keywordInput.value = "";
    }
  });
}

function removeKeyword(keyword) {
  chrome.storage.local.get({ highlightKeywords: [] }, (settings) => {
    const keywords = settings.highlightKeywords.filter(item => item !== keyword);
    chrome.storage.local.set({ highlightKeywords: keywords });
  });
}

function addUser() {
  let username = userInput.value.trim().replace(/^@/, "");

  if (!username) return;

  chrome.storage.local.get({ highlightUsers: [] }, (settings) => {
    const users = settings.highlightUsers;

    if (!users.includes(username)) {
      users.push(username);

      chrome.storage.local.set({ highlightUsers: users }, () => {
        userInput.value = "";
      });
    } else {
      userInput.value = "";
    }
  });
}

function removeUser(username) {
  chrome.storage.local.get({ highlightUsers: [] }, (settings) => {
    const users = settings.highlightUsers.filter(item => item !== username);
    chrome.storage.local.set({ highlightUsers: users });
  });
}

// =========================
// UIレンダリング関数
// =========================
function renderKeywords(keywords) {
  keywordList.innerHTML = "";

  if (keywords.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "登録されたキーワードはありません。";
    keywordList.appendChild(empty);
    return;
  }

  for (const keyword of keywords) {
    const item = document.createElement("div");
    item.className = "item";

    const text = document.createElement("span");
    text.textContent = keyword;

    const removeButton = createRemoveButton(() => {
      removeKeyword(keyword);
    });

    item.appendChild(text);
    item.appendChild(removeButton);
    keywordList.appendChild(item);
  }
}

function renderUsers(users) {
  userList.innerHTML = "";

  if (users.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "登録されたユーザーはいません。";
    userList.appendChild(empty);
    return;
  }

  for (const username of users) {
    const item = document.createElement("div");
    item.className = "item";

    const text = document.createElement("span");
    text.textContent = "@" + username;

    const removeButton = createRemoveButton(() => {
      removeUser(username);
    });

    item.appendChild(text);
    item.appendChild(removeButton);
    userList.appendChild(item);
  }
}

// 共通ボタン生成関数（関数名を統一）
function createRemoveButton(callback) {
  const button = document.createElement("button");
  button.className = "remove-button";
  button.textContent = "×";
  button.title = "削除";
  button.addEventListener("click", callback);
  return button;
}
