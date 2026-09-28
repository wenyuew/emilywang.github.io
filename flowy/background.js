// Opens (or focuses) the Word Bank page.
async function openBank() {
  const url = chrome.runtime.getURL('vocab.html');
  let tab = null;
  try { [tab] = await chrome.tabs.query({ url }); } catch (_) {}
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}
chrome.action.onClicked.addListener(openBank);
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'openBank') openBank();
});
