/**
 * popup.js v0.5 — Orchestrator for the popup-window mind map.
 *
 * Adds (over v0.3):
 *   - Cluster count slider (3..12, default = AstaCluster.autoTargetCount(N)).
 *   - Filter input that hides paper nodes whose title/authors don't
 *     match a substring query. Cluster nodes that end up empty are
 *     dimmed.
 *   - Reload button now triggers a force_refresh round-trip to the
 *     page (background → content_script → inject.js → re-fetch the
 *     /result/widget endpoint), THEN re-renders with the latest store.
 */

(function () {
  'use strict';

  const TOP_K_LABELS = 3;
  const SEC_AFF_THRESHOLD = 0.40;
  const FILTER_DEBOUNCE_MS = 120;

  let lastPayload = null;
  let lastThreadId = null;
  let userClusterCount = null;   // null = auto
  let filterText = '';
  let filterTimer = null;

  function setStatus(text, cls) {
    const el = document.getElementById('status');
    el.className = 'status ' + (cls || '');
    el.innerHTML = text;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({
      '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function richnessLabel(score) {
    if (score >= 3) return 'rich (relevance summaries)';
    if (score >= 2) return 'medium (abstracts)';
    if (score >= 1) return 'basic (with citations)';
    if (score >= 0) return 'slim (titles only)';
    return 'unknown';
  }

  function render(payload) {
    const mount = document.getElementById('mindmap-container');
    const detail = document.getElementById('detail');
    mount.innerHTML = '';
    detail.innerHTML = '<div class="detail-placeholder">Click a cluster bubble or a paper bubble to inspect.</div>';

    if (!payload || !payload.papers || payload.papers.length === 0) {
      setStatus(
        'No Asta search results yet — run a query at <code>asta.allen.ai/chat</code>.',
        'idle'
      );
      return;
    }

    // Reset pan/zoom on thread change (new search). Re-renders inside
    // the same thread (slider, filter) keep the user's current view.
    const incomingThread = (payload && payload.threadId) || null;
    if (incomingThread && incomingThread !== lastThreadId) {
      if (AstaViz && typeof AstaViz.resetPanZoom === 'function') AstaViz.resetPanZoom();
      lastThreadId = incomingThread;
    }

    const t0 = performance.now();

    const parsed = AstaParse.parseAstaResponse(payload.papers, payload.query);
    if (!parsed.papers.length) {
      setStatus('Captured payload has no papers.', 'warn');
      return;
    }

    // Build concept bags with three signal-strengthening tricks:
    //   (a) Title concepts get 2x weight (titles are denser in topic
    //       signal than abstracts).
    //   (b) Concepts derived from the user's query string are removed
    //       — they show up in every paper and just dilute the
    //       clustering signal.
    //   (c) "Universal" concepts (present in >70% of papers in the
    //       result set) are also removed for the same reason. This
    //       automatically strips things like "sort" / "algorithm"
    //       when the query is "sorting algorithms".
    const queryConcepts = new Set(
      AstaThesaurus.normalizeAll(AstaNLP.extractConcepts(parsed.query || ''))
    );

    const rawBags = parsed.papers.map(p => {
      const titleC = AstaThesaurus.normalizeAll(AstaNLP.extractConcepts(p.title || ''));
      const bodyC  = AstaThesaurus.normalizeAll(AstaNLP.extractConcepts(p.clusterText || ''));
      // Title concepts twice: cheap way to up-weight them in TF-IDF.
      return titleC.concat(titleC).concat(bodyC);
    });

    const N = rawBags.length;
    const df = Object.create(null);
    for (const bag of rawBags) {
      const seen = new Set();
      for (const c of bag) {
        if (!seen.has(c)) { df[c] = (df[c] || 0) + 1; seen.add(c); }
      }
    }
    const dropUniversal = new Set();
    for (const c in df) {
      if (df[c] / N > 0.70) dropUniversal.add(c);
    }

    const conceptBags = rawBags.map(bag =>
      bag.filter(c => !queryConcepts.has(c) && !dropUniversal.has(c))
    );

    const vocab   = AstaCluster.buildVocabulary(conceptBags);
    const vectors = AstaCluster.computeTFIDF(conceptBags, vocab);

    const autoCount = AstaCluster.autoTargetCount(parsed.papers.length);
    let targetCount = userClusterCount != null ? userClusterCount : autoCount;
    targetCount = Math.max(2, Math.min(parsed.papers.length, targetCount));

    // Sync slider UI if it's been reset.
    const slider = document.getElementById('clusterSlider');
    const sliderLabel = document.getElementById('clusterCountLabel');
    if (slider && sliderLabel) {
      slider.value = String(targetCount);
      sliderLabel.textContent = String(targetCount);
    }

    const clusters    = AstaCluster.clusterToTarget(vectors, targetCount);
    const labels      = AstaLabel.computeClusterLabels(conceptBags, clusters, vocab, TOP_K_LABELS);
    const affinities  = AstaCluster.computeAffinities(vectors, clusters);

    const elapsed = (performance.now() - t0).toFixed(0);
    setStatus(
      '<b>' + parsed.papers.length + '</b> papers · ' +
      '<b>' + clusters.length + '</b> clusters (target ' + targetCount + (userClusterCount == null ? ', auto' : ', user') + ') · ' +
      '<b>' + Object.keys(vocab).length + '</b> concepts · ' + elapsed + ' ms · ' +
      '<small style="color:#666">data: ' + escapeHtml(richnessLabel(payload.richness)) + '</small>' +
      (parsed.query ? '<br><small class="query-echo">Query: ' + escapeHtml(parsed.query) + '</small>' : ''),
      'ok'
    );

    try {
      AstaViz.renderMindMap(parsed, clusters, labels, affinities, mount, {
        secAffThreshold: SEC_AFF_THRESHOLD,
        filterText: filterText
      });
    } catch (err) {
      console.error('[asta-cmm:popup] renderMindMap threw:', err);
      mount.innerHTML =
        '<div style="color:#c00;background:#fee;padding:12px;' +
              'border-radius:4px;font-family:ui-monospace,Menlo,monospace;' +
              'font-size:11px;white-space:pre-wrap;line-height:1.5">' +
          '<b>Render error:</b> ' + escapeHtml(err && err.message || String(err)) +
          '\n\n' + escapeHtml((err && err.stack) || '') +
        '</div>';
      setStatus('Render error — see panel below.', 'warn');
    }
  }

  function loadLatest() {
    chrome.runtime.sendMessage({ type: 'get_latest' }, payload => {
      if (chrome.runtime.lastError) {
        setStatus('Extension not yet initialized — reload the Asta tab and run a search.', 'warn');
        return;
      }
      lastPayload = payload;
      render(payload);
    });
  }

  function forceRefresh() {
    setStatus('Refreshing from Asta…', 'idle');
    chrome.runtime.sendMessage({ type: 'force_refresh' }, () => {
      // The page-side fetch is async — wait briefly, then reload latest.
      setTimeout(loadLatest, 600);
      setTimeout(loadLatest, 1800);
    });
  }

  function getPanZoom() {
    const svg = document.querySelector('#mindmap-container svg.mindmap');
    return svg && svg.panZoom ? svg.panZoom : null;
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadLatest();
    document.getElementById('reloadBtn').addEventListener('click', forceRefresh);

    const slider = document.getElementById('clusterSlider');
    const sliderLabel = document.getElementById('clusterCountLabel');
    slider.addEventListener('input', () => {
      userClusterCount = parseInt(slider.value, 10);
      sliderLabel.textContent = slider.value;
      if (lastPayload) render(lastPayload);
    });

    const filter = document.getElementById('filterInput');
    filter.addEventListener('input', () => {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(() => {
        filterText = filter.value.trim();
        if (lastPayload) render(lastPayload);
      }, FILTER_DEBOUNCE_MS);
    });

    // Zoom controls — operate on the latest SVG inside the container.
    document.getElementById('zoomInBtn').addEventListener('click', () => {
      const pz = getPanZoom(); if (pz) pz.zoomIn();
    });
    document.getElementById('zoomOutBtn').addEventListener('click', () => {
      const pz = getPanZoom(); if (pz) pz.zoomOut();
    });
    document.getElementById('zoomFitBtn').addEventListener('click', () => {
      const pz = getPanZoom(); if (pz) pz.reset();
    });

    // Keyboard shortcuts: + / - / 0
    document.addEventListener('keydown', (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const pz = getPanZoom(); if (!pz) return;
      if (e.key === '+' || e.key === '=') { pz.zoomIn();  e.preventDefault(); }
      else if (e.key === '-' || e.key === '_') { pz.zoomOut(); e.preventDefault(); }
      else if (e.key === '0') { pz.reset(); e.preventDefault(); }
    });
  });

  chrome.runtime.onMessage.addListener(msg => {
    if (msg && msg.type === 'new_papers' && msg.payload) {
      lastPayload = msg.payload;
      render(msg.payload);
    }
  });
})();
