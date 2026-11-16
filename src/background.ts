// Clicking the toolbar icon opens the app in a new tab.
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
});
