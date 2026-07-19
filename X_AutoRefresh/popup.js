const enabledElement = document.getElementById("enabled");
const intervalElement = document.getElementById("interval");

// 保存済み設定を読み込む
chrome.storage.local.get(
  {
    enabled: true,
    intervalSeconds: 30
  },
  (settings) => {
    enabledElement.checked = settings.enabled;
    intervalElement.value = String(settings.intervalSeconds);
  }
);

// ON/OFF変更時に保存
enabledElement.addEventListener("change", () => {
  chrome.storage.local.set({
    enabled: enabledElement.checked
  });
});

// 更新間隔変更時に保存
intervalElement.addEventListener("change", () => {
  chrome.storage.local.set({
    intervalSeconds: Number(intervalElement.value)
  });
});
