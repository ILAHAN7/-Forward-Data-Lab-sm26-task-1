/**
 * inject.js v0.5 — Runs in the page's MAIN world on asta.allen.ai
 * (manifest world: "MAIN", run_at: "document_start").
 *
 * Captures the Asta paper list via THREE independent paths:
 *
 *   (A) RESPONSE hook — recursive walker on every JSON response.
 *       Catches the rich /api/2/rounds/{rid}/result/widget body
 *       (~73 papers with abstract / snippets / citationCount /
 *        relevanceJudgement / relevanceSummary) when the page fires
 *       that fetch on its own.
 *
 *   (B) REQUEST hook — captures the POST body of /api/chat/event
 *       ui_state events, which always carry the visible paper list
 *       under data.widgetsInView[].papers (slim shape: corpusId /
 *       paperTitle / paperYear / isSelected / isVisible). This is
 *       reliable but slim (no abstract, no citations).
 *
 *   (C) FALLBACK FETCH — when path (B) tells us a new round ID
 *       (rnd:...), we proactively fetch
 *       https://mabool-demo.allen.ai/api/2/rounds/{rid}/result/widget
 *       ourselves from the page context (so the page's auth cookies
 *       are sent automatically). The response is fed back through
 *       handleResponseJson and the rich detector takes over.
 *       This is the safety net that guarantees rich data even if
 *       the page's own fetch happened before our hook installed.
 *
 * Each emit includes threadId + roundId so background.js can do
 * thread-change detection and richness-aware storage priority.
 *
 * Diagnostic logs are prefixed `[asta-cmm]`.
 */

(function () {
  if (window.__asta_cluster_hooked__) return;
  window.__asta_cluster_hooked__ = true;

  const LOG = (...a) => { try { console.log('[asta-cmm]', ...a); } catch (_) {} };
  LOG('inject.js v0.5 running on', location.href);

  // ────────── Shape predicates ──────────
  const ID_KEYS = [
    'title', 'paperTitle', 'paper_title',
    'corpusId', 'corpus_id',
    'paperId',  'paper_id'
  ];
  const REL_KEYS = [
    'relevanceJudgement', 'relevance_judgement',
    'relevanceScore',     'relevance_score',
    'relevanceSummary',   'relevance_summary',
    'relevance_tier',     'relevanceTier',
    'snippets',
    'abstract',
    'citationCount',      'citation_count'
  ];
  const PATH_HINTS = [/paper_finder/i, /paperFinder/i, /paper-finder/i,
                      /\/rounds\//i, /result\/widget/i];
  const isPathHint = (url) => !!url && PATH_HINTS.some(re => re.test(url));

  function hasIdField(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    return ID_KEYS.some(k => o[k] != null && o[k] !== '');
  }
  function hasRelField(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    return REL_KEYS.some(k => o[k] != null);
  }
  function isPaperObject(o, lenient) {
    if (!hasIdField(o)) return false;
    if (lenient) return true;
    return hasRelField(o);
  }
  function looksLikePaperArray(arr, lenient) {
    if (!Array.isArray(arr) || arr.length === 0) return false;
    let hits = 0;
    const sample = Math.min(arr.length, 5);
    for (let i = 0; i < sample; i++) if (isPaperObject(arr[i], lenient)) hits++;
    const ratio = hits / sample;
    return lenient ? (ratio >= 0.8 && arr.length >= 3) : (ratio >= 0.6);
  }

  // ────────── Recursive walker ──────────
  function findPaperArray(node, path, depth, visited, best, lenient) {
    if (node == null || depth > 9) return best;
    if (typeof node !== 'object') return best;
    if (visited.has(node)) return best;
    visited.add(node);

    if (Array.isArray(node)) {
      if (looksLikePaperArray(node, lenient)) {
        const filtered = node.filter(o => isPaperObject(o, lenient));
        if (!best || filtered.length > best.papers.length) {
          best = { papers: filtered, path };
        }
      }
      for (let i = 0; i < node.length && i < 200; i++) {
        best = findPaperArray(node[i], path + '[' + i + ']', depth + 1, visited, best, lenient);
      }
      return best;
    }

    const PREF = ['papers', 'documents', 'results', 'items', 'data', 'payload',
                  'content', 'widget', 'widgets', 'widgetsInView',
                  'value', 'response', 'paperFinder', 'paper_finder', 'finder',
                  'event', 'output', 'body', 'state'];
    for (const k of PREF) {
      if (k in node) {
        best = findPaperArray(node[k], path + '.' + k, depth + 1, visited, best, lenient);
      }
    }
    for (const k of Object.keys(node)) {
      if (PREF.indexOf(k) !== -1) continue;
      best = findPaperArray(node[k], path + '.' + k, depth + 1, visited, best, lenient);
    }
    return best;
  }

  // ────────── Query extraction ──────────
  function findQuery(node, depth, visited) {
    if (node == null || depth > 6) return null;
    if (typeof node !== 'object') return null;
    if (visited.has(node)) return null;
    visited.add(node);

    const Q_KEYS = ['query', 'queryText', 'query_text', 'userQuery',
                    'searchQuery', 'prompt', 'question'];
    for (const k of Q_KEYS) {
      const v = node[k];
      if (typeof v === 'string' && v.trim().length > 4 && v.length < 500) {
        return v.trim();
      }
    }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length && i < 30; i++) {
        const q = findQuery(node[i], depth + 1, visited);
        if (q) return q;
      }
    } else {
      for (const k of Object.keys(node)) {
        const q = findQuery(node[k], depth + 1, visited);
        if (q) return q;
      }
    }
    return null;
  }

  // ────────── threadId / roundId extraction ──────────
  function getThreadIdFromLocation() {
    const m = location.pathname.match(/\/chat\/([0-9a-f-]{8,})/i);
    return m ? m[1] : '';
  }
  function extractRoundIdsFromUiState(data) {
    const ids = [];
    if (!data || data.event_type !== 'ui_state') return ids;
    const widgets = data.data && data.data.widgetsInView;
    if (!Array.isArray(widgets)) return ids;
    for (const w of widgets) {
      if (w && typeof w.id === 'string' && w.id.startsWith('rnd:')) {
        ids.push(w.id);
      }
    }
    return ids;
  }
  function extractRoundIdFromUrl(url) {
    if (!url) return '';
    const m = url.match(/\/rounds\/(rnd[%:][^\/?#]+)/);
    if (!m) return '';
    try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; }
  }
  function extractThreadIdFromAny(url, data) {
    if (data && data.thread_id) return String(data.thread_id);
    if (data && data.threadId)  return String(data.threadId);
    if (data && data.data && data.data.threadId) return String(data.data.threadId);
    if (url) {
      const m = url.match(/\/(?:threads?|thread)\/([0-9a-f-]{8,})/i);
      if (m) return m[1];
    }
    return getThreadIdFromLocation();
  }

  // ────────── Emit ──────────
  // Track per-thread "best capture" so we never emit something less
  // rich than what we already sent for the same thread.
  const bestPerThread = Object.create(null);

  function richnessScore(papers) {
    if (!Array.isArray(papers) || papers.length === 0) return -1;
    const p = papers[0];
    // 3 = explicit summary or object-shaped judgement (rich /result/widget)
    if (typeof p.relevanceSummary === 'string' && p.relevanceSummary) return 3;
    if (typeof p.relevance_summary === 'string' && p.relevance_summary) return 3;
    if (p.relevanceJudgement && typeof p.relevanceJudgement === 'object') return 3;
    if (p.relevance_judgement && typeof p.relevance_judgement === 'object') return 3;
    if (p.abstract) return 2;
    if (Array.isArray(p.snippets) && p.snippets.length > 0) return 2;
    if (p.citationCount || p.citation_count) return 1;
    return 0;
  }

  function postPapers(papers, query, url, path, threadId, roundId) {
    if (!papers || papers.length === 0) return;
    const tKey = threadId || '__no_thread__';
    const cur = bestPerThread[tKey];
    const newScore = richnessScore(papers);
    if (cur) {
      if (newScore < cur.score) return;                              // less rich than what we already sent
      if (newScore === cur.score && papers.length <= cur.count) return;  // same richness, not larger
    }
    bestPerThread[tKey] = { score: newScore, count: papers.length };

    LOG('captured', papers.length, 'papers',
        'rich=' + newScore, 'thread=' + (threadId || '?').slice(0, 12),
        'round=' + (roundId || '?').slice(0, 16),
        'path=' + path,
        query ? ('query="' + query + '"') : '');
    try {
      window.postMessage({
        source: 'asta-cluster-mindmap',
        type: 'ASTA_PAPERS',
        papers, query,
        url, path,
        threadId: threadId || '',
        roundId:  roundId  || '',
        richness: newScore,
        capturedAt: Date.now()
      }, '*');
    } catch (e) { LOG('postMessage failed:', e); }
  }

  function debugShape(url, data) {
    try {
      if (Array.isArray(data)) {
        const first = data[0];
        const keys = first && typeof first === 'object' ? Object.keys(first).slice(0, 8) : [];
        LOG('json', url.slice(-80), 'array[' + data.length + '] firstKeys=', keys);
      } else if (data && typeof data === 'object') {
        const keys = Object.keys(data).slice(0, 12);
        LOG('json', url.slice(-80), 'object keys=', keys);
      }
    } catch (_) {}
  }

  function extractUiStatePapers(data) {
    if (!data || typeof data !== 'object') return null;
    if (data.event_type !== 'ui_state' && data.eventType !== 'ui_state') return null;
    const widgets = data.data && data.data.widgetsInView;
    if (!Array.isArray(widgets)) return null;
    for (const w of widgets) {
      if (w && (w.type === 'PAPER_FINDER' || w.type === 'paper_finder') &&
          Array.isArray(w.papers) && w.papers.length > 0) {
        return { papers: w.papers, path: '$.data.widgetsInView[].papers', roundId: w.id || '' };
      }
    }
    return null;
  }

  function handleResponseJson(url, data) {
    debugShape(url, data);
    const lenient = isPathHint(url);
    const hit = findPaperArray(data, '$', 0, new WeakSet(), null, lenient);
    if (hit && hit.papers && hit.papers.length > 0) {
      const query = findQuery(data, 0, new WeakSet());
      const threadId = extractThreadIdFromAny(url, data);
      const roundId  = extractRoundIdFromUrl(url);
      postPapers(hit.papers, query, url, hit.path + (lenient ? ' (lenient)' : ''),
                 threadId, roundId);
    }
  }

  function handleRequestJson(url, data) {
    if (!data) return;
    const direct = extractUiStatePapers(data);
    if (direct) {
      const threadId = extractThreadIdFromAny(url, data);
      postPapers(direct.papers,
                 findQuery(data, 0, new WeakSet()),
                 url, direct.path,
                 threadId, direct.roundId);
      // Path (C): proactively fetch the rich endpoint for any new round IDs.
      const ids = extractRoundIdsFromUiState(data);
      ids.forEach(maybeFetchRichRound);
      return;
    }
    const lenient = isPathHint(url);
    const hit = findPaperArray(data, '$', 0, new WeakSet(), null, lenient);
    if (hit && hit.papers && hit.papers.length >= 3) {
      const threadId = extractThreadIdFromAny(url, data);
      const roundId  = extractRoundIdFromUrl(url);
      postPapers(hit.papers, findQuery(data, 0, new WeakSet()),
                 url, hit.path + ' (request' + (lenient ? ',lenient' : '') + ')',
                 threadId, roundId);
    }
  }

  function tryParseJsonBody(body) {
    if (body == null) return null;
    if (typeof body === 'string') {
      try { return JSON.parse(body); } catch (_) { return null; }
    }
    return null;
  }

  // ────────── (C) Fallback fetch for rich rounds ──────────
  const fetchedRoundIds = new Set();
  const MABOOL_BASE = 'https://mabool-demo.allen.ai/api/2/rounds/';

  // Use the ORIGINAL fetch (pre-hook) so we don't recurse into our own
  // hook's response-side processing twice (we feed the response into
  // handleResponseJson manually below).
  let origFetchRef = null;

  function maybeFetchRichRound(roundId) {
    if (!roundId || fetchedRoundIds.has(roundId)) return;
    fetchedRoundIds.add(roundId);
    const url = MABOOL_BASE + encodeURIComponent(roundId) + '/result/widget';
    LOG('fallback fetch rich round:', roundId);
    const fetchFn = origFetchRef || window.fetch;
    fetchFn(url, { credentials: 'include' })
      .then(resp => (resp && resp.ok) ? resp.json() : null)
      .then(data => { if (data) handleResponseJson(url, data); })
      .catch(e => LOG('fallback fetch failed:', e && e.message));
  }

  // Public hook for content_script to ask for a re-emit (Reload button).
  window.__asta_force_refresh__ = function () {
    LOG('force refresh requested');
    // Refetch every round we know about.
    const ids = Array.from(fetchedRoundIds);
    fetchedRoundIds.clear();
    ids.forEach(maybeFetchRichRound);
    // Also reset per-thread richness so a re-arriving capture is allowed
    // to re-emit.
    for (const k of Object.keys(bestPerThread)) delete bestPerThread[k];
  };

  // ────────── fetch hook ──────────
  const origFetch = window.fetch.bind(window);
  origFetchRef = origFetch;
  window.fetch = function (...args) {
    const url = typeof args[0] === 'string'
      ? args[0]
      : (args[0] && args[0].url) ? args[0].url : '';

    try {
      const init = args[1];
      if (init && init.body) {
        const parsed = tryParseJsonBody(init.body);
        if (parsed) handleRequestJson(url, parsed);
      }
    } catch (_) {}

    const promise = origFetch(...args);
    promise.then(resp => {
      if (!resp || !resp.ok) return;
      const ct = resp.headers && resp.headers.get('content-type');
      if (ct && !ct.includes('json')) return;
      resp.clone().json().then(d => handleResponseJson(url, d)).catch(() => {});
    }).catch(() => {});
    return promise;
  };

  // ────────── XHR hook ──────────
  const OrigXHR = window.XMLHttpRequest;
  function HookedXHR() {
    const xhr = new OrigXHR();
    let url = '';
    const origOpen = xhr.open;
    const origSend = xhr.send;
    xhr.open = function (method, u) {
      url = u;
      return origOpen.apply(this, arguments);
    };
    xhr.send = function (body) {
      try {
        const parsed = tryParseJsonBody(body);
        if (parsed) handleRequestJson(url, parsed);
      } catch (_) {}
      return origSend.apply(this, arguments);
    };
    xhr.addEventListener('load', function () {
      try {
        const ct = xhr.getResponseHeader && xhr.getResponseHeader('content-type');
        if (ct && !ct.includes('json')) return;
        const d = JSON.parse(xhr.responseText);
        handleResponseJson(url, d);
      } catch (_) {}
    });
    return xhr;
  }
  HookedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = HookedXHR;

  LOG('fetch + XHR hooks installed (v0.5: outbound + lenient + fallback /result/widget)');

  // Listen for refresh requests from the isolated-world content_script.
  window.addEventListener('message', e => {
    if (e.source !== window) return;
    const d = e.data;
    if (d && d.source === 'asta-cluster-mindmap-control' && d.type === 'FORCE_REFRESH') {
      window.__asta_force_refresh__();
    }
  });
})();
