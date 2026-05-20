/**
 * background.js v0.5 — Service worker for Asta Cluster Mind Map.
 *
 * Storage policy (richness-aware):
 *   Each incoming capture carries a richness score (0..3) from inject.js.
 *   We only overwrite the stored result when:
 *     - thread changed (new search / new conversation), OR
 *     - richness score of new capture >= score of stored, OR
 *     - same richness but new has more papers.
 *
 *   This stops the slim ui_state telemetry (50 papers, no citations)
 *   from clobbering the rich /result/widget capture (73 papers, full
 *   abstract / snippets / citationCount / relevanceSummary).
 *
 * Action click opens a wide popup window (1000x740). Reload button in
 * the popup sends a force_refresh request that propagates to
 * content_script → inject.js, which re-fires the rich fetch.
 */

const LOG = (...a) => { try { console.log('[asta-cmm:bg]', ...a); } catch (_) {} };

const POPUP_W = 1000;
const POPUP_H = 740;
const STORAGE_KEY = 'asta_cmm_latest';

let latestResult = null;
let popupWindowId = null;

// ────────── Boot ──────────
chrome.runtime.onInstalled.addListener(() => LOG('installed v0.3.0 (bg v0.5)'));

chrome.storage.session.get([STORAGE_KEY]).then(obj => {
  if (obj && obj[STORAGE_KEY]) {
    latestResult = obj[STORAGE_KEY];
    LOG('restored', (latestResult.papers || []).length, 'papers from session storage',
        'richness=' + (latestResult.richness != null ? latestResult.richness : '?'));
  }
}).catch(() => {});

// ────────── Action click → popup window ──────────
chrome.action.onClicked.addListener(async () => {
  if (popupWindowId !== null) {
    try { await chrome.windows.update(popupWindowId, { focused: true }); return; }
    catch (_) { popupWindowId = null; }
  }
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: POPUP_W,
    height: POPUP_H
  });
  popupWindowId = win.id;
  LOG('popup window opened id=' + popupWindowId);
});

chrome.windows.onRemoved.addListener(winId => {
  if (winId === popupWindowId) {
    LOG('popup window closed');
    popupWindowId = null;
  }
});

// ────────── Storage decision ──────────
function shouldAccept(incoming, current) {
  if (!current || !current.papers || current.papers.length === 0) return true;
  // Thread changed → always accept (new search).
  if (incoming.threadId && current.threadId &&
      incoming.threadId !== current.threadId) return true;
  const newR = incoming.richness != null ? incoming.richness : -1;
  const curR = current.richness  != null ? current.richness  : -1;
  if (newR > curR) return true;
  if (newR < curR) return false;
  // Same richness → accept if larger paper count.
  return (incoming.papers || []).length > (current.papers || []).length;
}

// ────────── Message routing ──────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'asta_papers') {
    const incoming = {
      papers: msg.papers || [],
      query: msg.query || null,
      url: msg.url || '',
      path: msg.path || '',
      threadId: msg.threadId || '',
      roundId:  msg.roundId  || '',
      richness: typeof msg.richness === 'number' ? msg.richness : -1,
      capturedAt: msg.capturedAt || Date.now(),
      tabId: sender.tab && sender.tab.id
    };

    const accept = shouldAccept(incoming, latestResult);
    LOG('incoming', incoming.papers.length, 'papers',
        'rich=' + incoming.richness, 'thread=' + (incoming.threadId || '?').slice(0, 12),
        '→', accept ? 'ACCEPT' : 'reject (stored is richer)');

    if (!accept) return false;

    latestResult = incoming;
    chrome.storage.session.set({ [STORAGE_KEY]: latestResult }).catch(() => {});
    chrome.runtime.sendMessage({ type: 'new_papers', payload: latestResult })
      .catch(() => {});
    return false;
  }

  if (msg.type === 'get_latest') {
    sendResponse(latestResult);
    return true;
  }

  if (msg.type === 'clear_latest') {
    latestResult = null;
    chrome.storage.session.remove(STORAGE_KEY).catch(() => {});
    return false;
  }

  if (msg.type === 'force_refresh') {
    // Find the most recent Asta tab and ask its content_script to
    // trigger inject.js's force-refresh hook.
    chrome.tabs.query({ url: 'https://asta.allen.ai/*' }).then(tabs => {
      if (!tabs || tabs.length === 0) {
        LOG('force_refresh: no Asta tab open');
        return;
      }
      const tab = tabs[0];
      chrome.tabs.sendMessage(tab.id, { type: 'force_refresh' })
        .catch(e => LOG('force_refresh send failed:', e && e.message));
    });
    return false;
  }
});
