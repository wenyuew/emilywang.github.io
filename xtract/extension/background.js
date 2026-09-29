// Xtract — background service worker.
// Opens the side panel from the toolbar icon, or when you mark a post on the page.

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'openPanel' && sender.tab?.id != null) {
    // Allowed because it follows your click on a Start / End marker.
    chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
  }
  if (msg?.type === 'openOptions') chrome.runtime.openOptionsPage();
  return false;
});
