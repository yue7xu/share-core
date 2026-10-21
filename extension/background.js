import { DEFAULT_SERVER } from './config.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'openPanel' && sender.tab?.id != null) {
    // Must be called right away, while the click still counts as a user gesture.
    chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
    chrome.storage.session.set({ entry: { type: msg.entry, vid: msg.vid, tabId: sender.tab.id, at: Date.now() } });
    reply({ ok: true });
    return;
  }
  if (msg.type === 'log') {
    logEvent(msg.event, msg.data).finally(() => reply({ ok: true }));
    return true;
  }
});

async function logEvent(type, data) {
  const { code, server } = await chrome.storage.local.get(['code', 'server']);
  if (!code) return;
  try {
    await fetch(`${server || DEFAULT_SERVER}/api/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, type, data }),
    });
  } catch {
    // Logging must never break the extension.
  }
}
