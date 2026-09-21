// Service worker: opens the app tab on install and on toolbar-icon click, and
// focuses the existing one instead of opening a second.
//
// The app tab is tracked without the `tabs` permission: app.html opens a
// runtime port when it loads, which tells us its tab id (port.sender.tab is
// available for the extension's own pages), and the port closing tells us the
// tab is gone. The id lives in chrome.storage.session because this worker is
// unloaded when idle and would forget it. tabs.create/update and
// windows.update need no permission.

const APP_URL = chrome.runtime.getURL('app.html');

async function openApp() {
  const { appTabId } = await chrome.storage.session.get('appTabId');
  if (appTabId != null) {
    try {
      const tab = await chrome.tabs.update(appTabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return tab;
    } catch {
      // The tab is gone (closed while the worker was asleep); fall through.
    }
  }
  const tab = await chrome.tabs.create({ url: APP_URL, active: true });
  await chrome.storage.session.set({ appTabId: tab.id });
  return tab;
}

// First install: seed onboarding as not yet seen and open the app.
// Reloading an unpacked extension does not fire this with reason "install".
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') return;
  try {
    await chrome.storage.local.set({ onboarding: { seen: false, installedAt: new Date().toISOString() } });
    await openApp();
  } catch (error) {
    console.error('Error during first-run setup:', error);
  }
});

chrome.action.onClicked.addListener(() => {
  openApp().catch(error => console.error('Error opening Resume Studio:', error));
});

// app.html connects on load and stays connected while open.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'app' || !port.sender?.tab) return;
  const tabId = port.sender.tab.id;
  chrome.storage.session.set({ appTabId: tabId });
  port.onDisconnect.addListener(async () => {
    const { appTabId } = await chrome.storage.session.get('appTabId');
    if (appTabId === tabId) await chrome.storage.session.remove('appTabId');
  });
});
