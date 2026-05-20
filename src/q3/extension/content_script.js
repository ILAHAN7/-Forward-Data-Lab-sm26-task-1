/**
 * content_script.js — Runs in the extension's isolated content-script
 * world on asta.allen.ai pages.
 *
 * Two-way bridge:
 *   inject.js → background:
 *     window.postMessage (ASTA_PAPERS) → chrome.runtime.sendMessage
 *
 *   background → inject.js:
 *     chrome.runtime.onMessage (force_refresh) →
 *     window.postMessage (asta-cluster-mindmap-control / FORCE_REFRESH)
 */

(function () {
  // inject.js → background
  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const data = event.data;
    if (
      !data ||
      data.source !== 'asta-cluster-mindmap' ||
      data.type !== 'ASTA_PAPERS'
    ) return;

    chrome.runtime
      .sendMessage({
        type: 'asta_papers',
        papers: data.papers,
        query: data.query,
        url: data.url,
        path: data.path,
        threadId: data.threadId,
        roundId: data.roundId,
        richness: data.richness,
        capturedAt: data.capturedAt
      })
      .catch(() => { /* worker reloading */ });
  });

  // background → inject.js (force refresh)
  chrome.runtime.onMessage.addListener(msg => {
    if (msg && msg.type === 'force_refresh') {
      window.postMessage({
        source: 'asta-cluster-mindmap-control',
        type: 'FORCE_REFRESH'
      }, '*');
    }
  });
})();
