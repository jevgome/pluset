import { registerExplainService } from './explain/service';

// Clicking the toolbar icon opens the app in a new tab.
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
});

// Questions and explanations for the popup on zyBooks pages (src/content/explain.ts).
registerExplainService();
