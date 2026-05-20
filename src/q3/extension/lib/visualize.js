/**
 * visualize.js v0.6 — SVG-based radial mind map renderer.
 *
 * Layout:
 *   Query node at the CANVAS CENTER. Clusters arranged in a ring
 *   around the query. Each cluster's papers placed in an outward arc
 *   (sector) — biggest by citations toward the centre of the arc,
 *   spreading wider in multiple radial layers when the cluster is
 *   large. Collision relaxation prevents node overlaps and pushes
 *   papers away from the query centre.
 *
 * Visual encoding:
 *   - Paper node radius: log-scaled by citation count vs global max.
 *   - Cluster node radius: sqrt(memberCount) × 4.
 *   - Cluster node colour: from a fixed palette.
 *   - Edges: query→cluster bezier (spine, dark), cluster→paper bezier
 *     in cluster colour (primary), paper→secondary-cluster dashed
 *     grey when affinity ≥ secAffThreshold.
 */

(function () {
  'use strict';

  const PALETTE = [
    '#2a4a6b', '#7a5a1a', '#2a8c4a', '#8c2a4a',
    '#5a2a8c', '#8c5a2a', '#2a8c8c', '#8c8c2a',
    '#4a6b8c', '#8c6b4a', '#6b8c4a', '#8c4a6b'
  ];

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const R_MIN = 4;
  const R_MAX = 14;

  // Default canvas (viewBox) — squarish so the centred ring looks right.
  const DEFAULT_W = 1000;
  const DEFAULT_H = 900;

  // ============ Pan / zoom state (preserved across re-renders) ============

  const panZoomState = {
    zoom: 1,
    centerX: null,   // null = "use canvas centre"
    centerY: null
  };

  function resetPanZoom() {
    panZoomState.zoom = 1;
    panZoomState.centerX = null;
    panZoomState.centerY = null;
  }

  // ============ Public entry point ============

  function renderMindMap(parsed, clusters, labels, affinities, mountEl, options) {
    options = options || {};
    const secAffThreshold = options.secAffThreshold != null ? options.secAffThreshold : 0.4;
    const canvasW = options.width  || DEFAULT_W;
    const canvasH = options.height || DEFAULT_H;
    const filterText = (options.filterText || '').toLowerCase();

    mountEl.innerHTML = '';
    if (!clusters || clusters.length === 0) {
      mountEl.textContent = '(no clusters)';
      return;
    }

    const layout = computeLayout(parsed, clusters, labels, affinities,
                                 secAffThreshold, canvasW, canvasH, filterText);
    const svg = createSVG(layout);
    mountEl.appendChild(svg);
    attachInteractions(svg, parsed, clusters, affinities);
    svg.panZoom = setupPanZoom(svg, layout);
  }

  function matchesFilter(paper, q) {
    if (!q) return true;
    const t = (paper.title || '').toLowerCase();
    if (t.indexOf(q) !== -1) return true;
    const authors = (paper.authors || []).join(' ').toLowerCase();
    return authors.indexOf(q) !== -1;
  }

  // ============ Layout ============

  function computeLayout(parsed, clusters, labels, affinities,
                         secAffThreshold, W, H, filterText) {
    const cx = W / 2;
    const cy = H / 2;
    const K = clusters.length;

    // Cluster ring radius scales with K to avoid crowding.
    const clusterRingRadius =
      K <= 3  ? 170 :
      K <= 5  ? 200 :
      K <= 7  ? 240 :
      K <= 10 ? 280 :
      K <= 14 ? 320 :
      K <= 17 ? 350 : 380;

    const globalMaxCite = Math.max(0, ...parsed.papers.map(p => p.citationCount || 0));
    const logMax = Math.log(1 + globalMaxCite) || 1;

    const queryNode = {
      type: 'root',
      x: cx, y: cy,
      label: parsed.query || 'Query',
      r: 34
    };

    const clusterNodes = clusters.map((c, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i / K);
      const r = 18 + Math.sqrt(c.members.length) * 4;
      return {
        type: 'cluster', idx: i, angle,
        x: cx + clusterRingRadius * Math.cos(angle),
        y: cy + clusterRingRadius * Math.sin(angle),
        label: (labels[i] && labels[i].labelString) || 'cluster ' + i,
        r,
        color: PALETTE[i % PALETTE.length],
        memberCount: c.members.length
      };
    });

    const paperNodes = parsed.papers.map((p, pi) => ({
      type: 'paper', idx: pi, paper: p,
      affinity: affinities[pi],
      cluster: affinities[pi][0].clusterIdx,
      filteredOut: !matchesFilter(p, filterText)
    }));

    // Group papers by primary cluster.
    const papersByCluster = {};
    for (const pn of paperNodes) {
      (papersByCluster[pn.cluster] = papersByCluster[pn.cluster] || []).push(pn);
    }

    // Each cluster's papers form a HALO around the cluster — an arc
    // that wraps the cluster on the outward side. Halo half-width
    // shrinks as K grows: with many clusters, each owns a narrower
    // angular slice on the ring, so its halo must also narrow to
    // avoid crashing into the neighbour's halo.
    //
    // Filling order: inner layer first, sized so its arc length gives
    // breathing room. Subsequent layers stack outward, each holding
    // more papers because the arc gets longer.
    const HALO_HALF =
      K <=  6 ? Math.PI * 0.75 :   // 270° total — current low-K behaviour
      K <= 10 ? Math.PI * 0.55 :   // 198°
      K <= 14 ? Math.PI * 0.40 :   // 144°
      K <= 17 ? Math.PI * 0.32 :   // 115°
                Math.PI * 0.26;    //  94° for K up to 20
    const PER_PAPER_PX = 30;       // average spacing along arc
    const LAYER_STEP = 26;         // radial gap between layers

    for (const cIdxKey in papersByCluster) {
      const cIdx = +cIdxKey;
      const cn = clusterNodes[cIdx];
      const papers = papersByCluster[cIdx];
      const n = papers.length;
      const radialOut = Math.atan2(cn.y - cy, cn.x - cx);

      // Sort by citations descending so high-impact papers land at the
      // outward-facing centre of the halo.
      papers.sort((a, b) => (b.paper.citationCount || 0) - (a.paper.citationCount || 0));

      if (n === 1) {
        const ringR = cn.r + 30;
        const pn = papers[0];
        pn.x = cn.x + ringR * Math.cos(radialOut);
        pn.y = cn.y + ringR * Math.sin(radialOut);
        finalisePaperNode(pn, cn, logMax);
        continue;
      }

      const baseR = cn.r + 28;
      // How many papers fit on the arc at layer L?
      const capacityAt = (lyr) => {
        const r = baseR + lyr * LAYER_STEP;
        const arcLen = 2 * HALO_HALF * r;
        return Math.max(4, Math.floor(arcLen / PER_PAPER_PX));
      };

      // Distribute papers across layers (fill inner first).
      const layerSizes = [];
      let remaining = n;
      let lyr = 0;
      while (remaining > 0) {
        const cap = capacityAt(lyr);
        const take = Math.min(cap, remaining);
        layerSizes.push(take);
        remaining -= take;
        lyr++;
      }

      // Place each layer: highest-citation paper in this layer at the
      // outward centre, then alternating left/right.
      let cursor = 0;
      layerSizes.forEach((count, layer) => {
        const r = baseR + layer * LAYER_STEP;
        const layerPapers = papers.slice(cursor, cursor + count);
        const arranged = arrangeForArc(layerPapers);
        const step = count <= 1 ? 0 : (2 * HALO_HALF) / (count - 1);
        arranged.forEach((pn, i) => {
          const angle = count <= 1 ? radialOut
                                   : (radialOut - HALO_HALF + step * i);
          pn.x = cn.x + r * Math.cos(angle);
          pn.y = cn.y + r * Math.sin(angle);
          finalisePaperNode(pn, cn, logMax);
        });
        cursor += count;
      });
    }

    // Collision relaxation, with extra repulsion from the query node so
    // nothing gets pushed into the centre.
    relaxPaperPositions(paperNodes, queryNode, 30);

    // Build edges.
    const edges = [];
    clusterNodes.forEach(cn => {
      edges.push({ from: queryNode, to: cn, type: 'spine', cluster: cn.idx });
    });
    paperNodes.forEach(pn => {
      edges.push({ from: clusterNodes[pn.cluster], to: pn, type: 'primary', cluster: pn.cluster });
    });
    paperNodes.forEach(pn => {
      const sec = pn.affinity[1];
      if (sec && sec.similarity >= secAffThreshold && sec.clusterIdx !== pn.cluster) {
        edges.push({
          from: pn, to: clusterNodes[sec.clusterIdx],
          type: 'secondary', similarity: sec.similarity
        });
      }
    });

    return {
      width: W, height: H,
      cx, cy,
      globalMaxCite, logMax,
      queryNode, clusterNodes, paperNodes, edges
    };
  }

  // Re-order a citation-sorted papers array so item 0 lands in the middle
  // and successive items fan out left/right: [c, R, L, R, L, ...].
  function arrangeForArc(papers) {
    const n = papers.length;
    const mid = Math.floor((n - 1) / 2);
    const out = new Array(n);
    out[mid] = papers[0];
    let r = mid + 1, l = mid - 1;
    for (let i = 1; i < n; i++) {
      if (i % 2 === 1) {
        if (r < n) { out[r] = papers[i]; r++; }
        else       { out[l] = papers[i]; l--; }
      } else {
        if (l >= 0) { out[l] = papers[i]; l--; }
        else        { out[r] = papers[i]; r++; }
      }
    }
    return out;
  }

  function finalisePaperNode(pn, cn, logMax) {
    const cite = pn.paper.citationCount || 0;
    pn.r = R_MIN + (R_MAX - R_MIN) * (Math.log(1 + cite) / logMax);
    pn.color = cn.color;
    pn.shortLabel = makeShortLabel(pn.paper.title, 22);
    pn.textAnchor = (pn.x - cn.x) >= 0 ? 'start' : 'end';
    pn.labelDx = (pn.x - cn.x) >= 0 ? (pn.r + 4) : -(pn.r + 4);
  }

  function makeShortLabel(title, maxChars) {
    if (!title) return '';
    const t = String(title).trim();
    if (t.length <= maxChars) return t;
    const slice = t.slice(0, maxChars);
    const sp = slice.lastIndexOf(' ');
    const cut = (sp > maxChars * 0.5) ? slice.slice(0, sp) : slice;
    return cut.replace(/[\s,;:.\-]+$/, '') + '…';
  }

  function relaxPaperPositions(paperNodes, queryNode, iterations) {
    const PAD = 1.5;
    const HOMING = 0.06;
    const QUERY_GAP = 22;
    const origins = paperNodes.map(pn => ({ x: pn.x, y: pn.y }));
    for (let t = 0; t < iterations; t++) {
      for (let i = 0; i < paperNodes.length; i++) {
        const a = paperNodes[i];
        for (let j = i + 1; j < paperNodes.length; j++) {
          const b = paperNodes[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.001;
          const minDist = a.r + b.r + PAD;
          if (dist < minDist) {
            const push = (minDist - dist) / 2;
            const nx = dx / dist, ny = dy / dist;
            a.x -= nx * push; a.y -= ny * push;
            b.x += nx * push; b.y += ny * push;
          }
        }
      }
      if (queryNode) {
        for (const pn of paperNodes) {
          const dx = pn.x - queryNode.x, dy = pn.y - queryNode.y;
          const dist = Math.hypot(dx, dy) || 0.001;
          const minDist = pn.r + queryNode.r + QUERY_GAP;
          if (dist < minDist) {
            const push = (minDist - dist);
            pn.x += (dx / dist) * push;
            pn.y += (dy / dist) * push;
          }
        }
      }
      for (let i = 0; i < paperNodes.length; i++) {
        paperNodes[i].x += (origins[i].x - paperNodes[i].x) * HOMING;
        paperNodes[i].y += (origins[i].y - paperNodes[i].y) * HOMING;
      }
    }
  }

  // ============ SVG building ============

  function createSVG(layout) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + layout.width + ' ' + layout.height);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('class', 'mindmap');
    svg.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

    // Edges
    const edgeG = document.createElementNS(SVG_NS, 'g');
    edgeG.setAttribute('class', 'edges');
    layout.edges.forEach(e => {
      if (e.type === 'secondary') {
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', e.from.x); line.setAttribute('y1', e.from.y);
        line.setAttribute('x2', e.to.x);   line.setAttribute('y2', e.to.y);
        line.setAttribute('stroke', '#888');
        line.setAttribute('stroke-width', '1');
        line.setAttribute('stroke-dasharray', '3,3');
        line.setAttribute('opacity', '0.45');
        line.setAttribute('class', 'edge-dashed');
        edgeG.appendChild(line);
      } else {
        // Quadratic bezier with a slight bulge away from the canvas centre.
        const cx = layout.cx, cy = layout.cy;
        const mx = (e.from.x + e.to.x) / 2;
        const my = (e.from.y + e.to.y) / 2;
        const dx = mx - cx, dy = my - cy;
        const len = Math.hypot(dx, dy) || 1;
        const bulge = (e.type === 'spine') ? 8 : 14;
        const ctrlX = mx + (dx / len) * bulge;
        const ctrlY = my + (dy / len) * bulge;
        const d = 'M ' + e.from.x + ' ' + e.from.y +
                  ' Q ' + ctrlX + ' ' + ctrlY +
                  ' ' + e.to.x + ' ' + e.to.y;
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        if (e.type === 'spine') {
          path.setAttribute('stroke', '#2a4a6b');
          path.setAttribute('stroke-width', '2.2');
          path.setAttribute('opacity', '0.55');
          path.setAttribute('class', 'edge-spine');
        } else {
          const color = (layout.clusterNodes[e.cluster] || {}).color || '#888';
          path.setAttribute('stroke', color);
          path.setAttribute('stroke-width', '1.2');
          path.setAttribute('opacity', '0.65');
          path.setAttribute('class', 'edge-primary');
        }
        if (e.cluster != null) path.setAttribute('data-cluster', e.cluster);
        edgeG.appendChild(path);
      }
    });
    svg.appendChild(edgeG);

    // Paper nodes
    const paperG = document.createElementNS(SVG_NS, 'g');
    paperG.setAttribute('class', 'papers');
    layout.paperNodes.forEach(pn => {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'paper-node' + (pn.filteredOut ? ' filtered-out' : ''));
      g.setAttribute('data-idx', pn.idx);
      g.setAttribute('data-cluster', pn.cluster);
      g.setAttribute('transform', 'translate(' + pn.x + ',' + pn.y + ')');
      g.style.cursor = 'pointer';

      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('r', pn.r);
      circle.setAttribute('fill', pn.color);
      circle.setAttribute('fill-opacity', '0.78');
      circle.setAttribute('stroke', '#222');
      circle.setAttribute('stroke-width', '0.6');
      g.appendChild(circle);

      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', pn.labelDx);
      label.setAttribute('y', 3);
      label.setAttribute('text-anchor', pn.textAnchor);
      label.setAttribute('font-size', '10');
      label.setAttribute('fill', '#333');
      label.setAttribute('paint-order', 'stroke');
      label.setAttribute('stroke', '#fff');
      label.setAttribute('stroke-width', '2.5');
      label.setAttribute('pointer-events', 'none');
      label.textContent = pn.shortLabel;
      g.appendChild(label);

      const t = document.createElementNS(SVG_NS, 'title');
      const p = pn.paper;
      const tierLabel = tierToLabel(p.relevanceTier);
      t.textContent =
        p.title +
        '\n' + (p.year || '?') + ' · ' + (p.citationCount || 0) + ' citations' +
        (tierLabel ? ' · ' + tierLabel : '');
      g.appendChild(t);

      paperG.appendChild(g);
    });
    svg.appendChild(paperG);

    // Cluster nodes
    const clusterG = document.createElementNS(SVG_NS, 'g');
    clusterG.setAttribute('class', 'clusters');
    layout.clusterNodes.forEach(cn => {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'cluster-node');
      g.setAttribute('data-idx', cn.idx);
      g.setAttribute('transform', 'translate(' + cn.x + ',' + cn.y + ')');
      g.style.cursor = 'pointer';

      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('r', cn.r);
      circle.setAttribute('fill', cn.color);
      circle.setAttribute('stroke', '#fff');
      circle.setAttribute('stroke-width', '3');
      g.appendChild(circle);

      const count = document.createElementNS(SVG_NS, 'text');
      count.setAttribute('y', 5);
      count.setAttribute('text-anchor', 'middle');
      count.setAttribute('font-size', '13');
      count.setAttribute('font-weight', 'bold');
      count.setAttribute('fill', '#fff');
      count.setAttribute('pointer-events', 'none');
      count.textContent = String(cn.memberCount);
      g.appendChild(count);

      // Cluster label placed radially outward from the centre.
      const ang = Math.atan2(cn.y - layout.cy, cn.x - layout.cx);
      const out = cn.r + 18;
      const lx = out * Math.cos(ang);
      const ly = out * Math.sin(ang) + 4;
      const anch = Math.cos(ang) > 0.3 ? 'start'
                  : Math.cos(ang) < -0.3 ? 'end'
                  : 'middle';

      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', lx);
      text.setAttribute('y', ly);
      text.setAttribute('text-anchor', anch);
      text.setAttribute('font-size', '12');
      text.setAttribute('font-weight', '700');
      text.setAttribute('fill', '#1a1a1a');
      text.setAttribute('paint-order', 'stroke');
      text.setAttribute('stroke', '#fff');
      text.setAttribute('stroke-width', '4');
      text.setAttribute('pointer-events', 'none');
      text.textContent = makeShortLabel(cn.label, 36);
      g.appendChild(text);

      clusterG.appendChild(g);
    });
    svg.appendChild(clusterG);

    // Query node (centred, above everything)
    const qg = document.createElementNS(SVG_NS, 'g');
    qg.setAttribute('class', 'query-node');
    qg.setAttribute('transform', 'translate(' + layout.queryNode.x + ',' + layout.queryNode.y + ')');
    const qCircle = document.createElementNS(SVG_NS, 'circle');
    qCircle.setAttribute('r', layout.queryNode.r);
    qCircle.setAttribute('fill', '#1a1a2a');
    qCircle.setAttribute('stroke', '#fff');
    qCircle.setAttribute('stroke-width', '3');
    qg.appendChild(qCircle);
    const qLabel = document.createElementNS(SVG_NS, 'text');
    qLabel.setAttribute('y', 5);
    qLabel.setAttribute('text-anchor', 'middle');
    qLabel.setAttribute('font-size', '13');
    qLabel.setAttribute('fill', '#fff');
    qLabel.setAttribute('font-weight', '700');
    qLabel.setAttribute('pointer-events', 'none');
    qLabel.textContent = 'Query';
    qg.appendChild(qLabel);
    // Show short query string just below the centre node.
    const qShort = makeShortLabel(layout.queryNode.label || '', 50);
    if (qShort) {
      const qTxt = document.createElementNS(SVG_NS, 'text');
      qTxt.setAttribute('y', layout.queryNode.r + 16);
      qTxt.setAttribute('text-anchor', 'middle');
      qTxt.setAttribute('font-size', '11');
      qTxt.setAttribute('fill', '#1a1a2a');
      qTxt.setAttribute('font-weight', '600');
      qTxt.setAttribute('paint-order', 'stroke');
      qTxt.setAttribute('stroke', '#fff');
      qTxt.setAttribute('stroke-width', '4');
      qTxt.setAttribute('pointer-events', 'none');
      qTxt.textContent = qShort;
      qg.appendChild(qTxt);
    }
    svg.appendChild(qg);

    appendLegend(svg, layout);
    return svg;
  }

  function appendLegend(svg, layout) {
    if (!layout.globalMaxCite || layout.globalMaxCite < 1) return;
    // Compact qualitative legend: circle size scales with citation
    // count. No numeric labels — the underlying log-scaled formula
    // (radius vs log(1+cite)/log(1+maxCite)) makes specific tick
    // values misleading.
    const x0 = layout.width - 160;
    const y0 = 12;
    const grp = document.createElementNS(SVG_NS, 'g');
    grp.setAttribute('class', 'legend');
    grp.setAttribute('transform', 'translate(' + x0 + ',' + y0 + ')');

    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('x', 0); bg.setAttribute('y', 0);
    bg.setAttribute('width', 150); bg.setAttribute('height', 50);
    bg.setAttribute('rx', 4);
    bg.setAttribute('fill', '#fff');
    bg.setAttribute('stroke', '#ddd');
    bg.setAttribute('stroke-width', '1');
    grp.appendChild(bg);

    const title = document.createElementNS(SVG_NS, 'text');
    title.setAttribute('x', 75); title.setAttribute('y', 14);
    title.setAttribute('text-anchor', 'middle');
    title.setAttribute('font-size', '10');
    title.setAttribute('font-weight', '700');
    title.setAttribute('fill', '#555');
    title.textContent = 'Node size ∝ citations';
    grp.appendChild(title);

    // Three circles, small → medium → large, no numeric ticks.
    const radii = [R_MIN + 1, (R_MIN + R_MAX) / 2, R_MAX];
    radii.forEach((r, i) => {
      const cx = 38 + i * 38;
      const cy = 34;
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', cx); c.setAttribute('cy', cy);
      c.setAttribute('r', r);
      c.setAttribute('fill', '#888');
      c.setAttribute('fill-opacity', '0.6');
      c.setAttribute('stroke', '#444');
      c.setAttribute('stroke-width', '0.5');
      grp.appendChild(c);
    });

    // Endpoint labels: "fewer" / "more".
    const less = document.createElementNS(SVG_NS, 'text');
    less.setAttribute('x', 10); less.setAttribute('y', 38);
    less.setAttribute('font-size', '9');
    less.setAttribute('fill', '#888');
    less.textContent = 'fewer';
    grp.appendChild(less);

    const more = document.createElementNS(SVG_NS, 'text');
    more.setAttribute('x', 140); more.setAttribute('y', 38);
    more.setAttribute('text-anchor', 'end');
    more.setAttribute('font-size', '9');
    more.setAttribute('fill', '#888');
    more.textContent = 'more';
    grp.appendChild(more);

    svg.appendChild(grp);
  }

  // ============ Pan / zoom ============

  function setupPanZoom(svg, layout) {
    const baseW = layout.width;
    const baseH = layout.height;
    const MIN_ZOOM = 0.4;
    const MAX_ZOOM = 8;

    if (panZoomState.centerX == null) panZoomState.centerX = baseW / 2;
    if (panZoomState.centerY == null) panZoomState.centerY = baseH / 2;

    function apply() {
      const w = baseW / panZoomState.zoom;
      const h = baseH / panZoomState.zoom;
      const x = panZoomState.centerX - w / 2;
      const y = panZoomState.centerY - h / 2;
      svg.setAttribute('viewBox', x + ' ' + y + ' ' + w + ' ' + h);
    }
    apply();

    function zoomAt(screenX, screenY, factor) {
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const relX = (screenX - rect.left) / rect.width;
      const relY = (screenY - rect.top)  / rect.height;
      const w = baseW / panZoomState.zoom;
      const h = baseH / panZoomState.zoom;
      const svgX = (panZoomState.centerX - w / 2) + w * relX;
      const svgY = (panZoomState.centerY - h / 2) + h * relY;

      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, panZoomState.zoom * factor));
      if (newZoom === panZoomState.zoom) return;
      const newW = baseW / newZoom;
      const newH = baseH / newZoom;
      panZoomState.zoom = newZoom;
      panZoomState.centerX = svgX - newW * (relX - 0.5);
      panZoomState.centerY = svgY - newH * (relY - 0.5);
      apply();
    }

    // ── Mouse wheel zoom (centred on cursor) ──
    svg.addEventListener('wheel', function (e) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : (1 / 1.15);
      zoomAt(e.clientX, e.clientY, factor);
    }, { passive: false });

    // ── Drag pan ──
    let dragging = false;
    let lastX = 0, lastY = 0;
    svg.addEventListener('mousedown', function (e) {
      // Don't start drag when the user is clicking on a node.
      if (e.target.closest && e.target.closest('.cluster-node, .paper-node')) return;
      if (e.button !== 0) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      svg.style.cursor = 'grabbing';
      e.preventDefault();
    });
    function onMove(e) {
      if (!dragging) return;
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const w = baseW / panZoomState.zoom;
      const h = baseH / panZoomState.zoom;
      const dx = (e.clientX - lastX) / rect.width  * w;
      const dy = (e.clientY - lastY) / rect.height * h;
      panZoomState.centerX -= dx;
      panZoomState.centerY -= dy;
      lastX = e.clientX;
      lastY = e.clientY;
      apply();
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      svg.style.cursor = '';
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    window.addEventListener('mouseleave', onUp);

    // Public controller used by popup buttons.
    return {
      zoomIn:  function () {
        const rect = svg.getBoundingClientRect();
        zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.3);
      },
      zoomOut: function () {
        const rect = svg.getBoundingClientRect();
        zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / 1.3);
      },
      reset: function () {
        panZoomState.zoom = 1;
        panZoomState.centerX = baseW / 2;
        panZoomState.centerY = baseH / 2;
        apply();
      }
    };
  }

  // ============ Interactions ============

  function attachInteractions(svg, parsed, clusters, affinities) {
    let activeCluster = null;

    svg.querySelectorAll('.paper-node').forEach(g => {
      g.addEventListener('click', e => {
        e.stopPropagation();
        const idx = +g.getAttribute('data-idx');
        showPaperDetail(parsed.papers[idx], affinities[idx]);
        clearHighlight(svg);
        activeCluster = null;
      });
    });

    svg.querySelectorAll('.cluster-node').forEach(g => {
      g.addEventListener('click', e => {
        e.stopPropagation();
        const cIdx = +g.getAttribute('data-idx');
        if (activeCluster === cIdx) {
          clearHighlight(svg);
          activeCluster = null;
          showOverallDetail(parsed, clusters);
        } else {
          highlightCluster(svg, cIdx);
          activeCluster = cIdx;
          showClusterDetail(parsed, clusters, cIdx);
        }
      });
    });

    svg.addEventListener('click', () => {
      clearHighlight(svg);
      activeCluster = null;
    });
  }

  function highlightCluster(svg, cIdx) {
    svg.querySelectorAll('.cluster-node').forEach(g => {
      g.style.opacity = +g.getAttribute('data-idx') === cIdx ? '1' : '0.25';
    });
    svg.querySelectorAll('.paper-node').forEach(g => {
      g.style.opacity = +g.getAttribute('data-cluster') === cIdx ? '1' : '0.2';
    });
    svg.querySelectorAll('.edge-primary').forEach(line => {
      const c = line.getAttribute('data-cluster');
      line.style.opacity = c === String(cIdx) ? '0.85' : '0.1';
    });
    svg.querySelectorAll('.edge-spine, .edge-dashed').forEach(line => {
      line.style.opacity = '0.15';
    });
  }

  function clearHighlight(svg) {
    svg.querySelectorAll('.cluster-node, .paper-node').forEach(g => {
      g.style.opacity = '';
    });
    svg.querySelectorAll('.edge-primary, .edge-spine, .edge-dashed').forEach(line => {
      line.style.opacity = '';
    });
  }

  // ─── Paper detail panel ───

  function showPaperDetail(p, affinity) {
    const detail = document.getElementById('detail');
    if (!detail) return;
    const parts = [];
    parts.push('<h3 class="detail-title">' + escapeHtml(p.title || '(no title)') + '</h3>');

    const metaBits = [];
    if (p.year)  metaBits.push(escapeHtml(String(p.year)));
    if (p.venue) metaBits.push(escapeHtml(p.venue));
    metaBits.push((p.citationCount || 0) + ' citations');
    const tierLabel = tierToLabel(p.relevanceTier);
    if (tierLabel) {
      metaBits.push('<span class="tier-tag tier-' + tierScore(p.relevanceTier) + '">' +
                   escapeHtml(tierLabel) + '</span>');
    }
    if (typeof p.relevanceScore === 'number') {
      metaBits.push('relevance ' + p.relevanceScore.toFixed(2));
    }
    parts.push('<div class="detail-meta">' + metaBits.join(' · ') + '</div>');

    if (p.authors && p.authors.length) {
      const authorList = p.authors.filter(Boolean).map(escapeHtml).join(', ');
      parts.push('<div class="detail-meta"><b>Authors:</b> ' + authorList + '</div>');
    }

    if (p.relevanceSummary) {
      parts.push('<div class="detail-block"><b>Why relevant (Asta):</b><br>' +
                 escapeHtml(p.relevanceSummary) + '</div>');
    }

    if (p.abstract) {
      const abs = p.abstract.length > 600
        ? p.abstract.slice(0, 600) + '…'
        : p.abstract;
      parts.push('<div class="detail-block"><b>Abstract:</b><br>' + escapeHtml(abs) + '</div>');
    }

    if (p.snippets && p.snippets.length) {
      parts.push('<div class="detail-block"><b>Snippets:</b></div>');
      p.snippets.slice(0, 4).forEach(s => {
        const sec = s.sectionTitle ? '<span class="snippet-section">' +
                                     escapeHtml(s.sectionTitle) + '</span>' : '';
        const text = s.text.length > 320 ? s.text.slice(0, 320) + '…' : s.text;
        parts.push('<div class="detail-snippet">' + sec + escapeHtml(text) + '</div>');
      });
    }

    if (affinity && affinity.length > 1) {
      let aff = '<div class="detail-block detail-aff"><b>Cluster affinity:</b><br>';
      affinity.slice(0, 4).forEach((a, i) => {
        const tag = i === 0 ? 'primary' : 'secondary';
        aff += '<span class="aff-row">' + tag + ' → cluster ' + a.clusterIdx +
               ' (' + a.similarity.toFixed(2) + ')</span>';
      });
      aff += '</div>';
      parts.push(aff);
    }

    const openLinks = buildOpenLinks(p);
    if (openLinks) parts.push(openLinks);

    detail.innerHTML = parts.join('');
  }

  function buildOpenLinks(p) {
    const links = [];
    if (p.url && /^https?:\/\//i.test(p.url)) {
      links.push('<a href="' + escapeAttr(p.url) +
                 '" target="_blank" rel="noopener" class="detail-link">' +
                 'Open paper ↗</a>');
    }
    const corpus = String(p.paperId || '').trim();
    if (corpus && /^\d+$/.test(corpus)) {
      const ssUrl = 'https://www.semanticscholar.org/paper/' + corpus;
      links.push('<a href="' + ssUrl +
                 '" target="_blank" rel="noopener" class="detail-link secondary">' +
                 'Semantic Scholar ↗</a>');
    }
    return links.join('');
  }

  // ─── Cluster detail panel ───

  const clusterState = { sortBy: 'asta', filter: '' };

  function showClusterDetail(parsed, clusters, cIdx) {
    const detail = document.getElementById('detail');
    if (!detail) return;
    const c = clusters[cIdx];

    const header =
      '<h3 class="detail-title">Cluster ' + cIdx + ' · ' + c.members.length + ' papers</h3>' +
      '<div class="cluster-controls">' +
        '<span>Sort:</span>' +
        '<select id="clusterSortSel">' +
          optionTag('asta',       'Asta ranking',     clusterState.sortBy) +
          optionTag('cites',      'Citations (desc)', clusterState.sortBy) +
          optionTag('year',       'Year (desc)',      clusterState.sortBy) +
          optionTag('title',      'Title (asc)',      clusterState.sortBy) +
          optionTag('relevance',  'Relevance tier',   clusterState.sortBy) +
        '</select>' +
        '<input type="search" id="clusterFilterIn" placeholder="title / author" value="' +
          escapeAttr(clusterState.filter) + '">' +
      '</div>' +
      '<div id="clusterRowsHost"></div>';
    detail.innerHTML = header;

    const sel = document.getElementById('clusterSortSel');
    const flt = document.getElementById('clusterFilterIn');
    sel.addEventListener('change', () => {
      clusterState.sortBy = sel.value;
      renderRows();
    });
    let tmo;
    flt.addEventListener('input', () => {
      clearTimeout(tmo);
      tmo = setTimeout(() => {
        clusterState.filter = flt.value.trim();
        renderRows();
      }, 100);
    });

    function renderRows() {
      const host = document.getElementById('clusterRowsHost');
      if (!host) return;
      const q = clusterState.filter.toLowerCase();
      let arr = c.members.slice();
      if (q) {
        arr = arr.filter(pi => {
          const p = parsed.papers[pi];
          return (p.title || '').toLowerCase().indexOf(q) !== -1 ||
                 (p.authors || []).join(' ').toLowerCase().indexOf(q) !== -1;
        });
      }
      arr.sort((a, b) => {
        const pa = parsed.papers[a], pb = parsed.papers[b];
        switch (clusterState.sortBy) {
          case 'asta':
            // Asta's own ranking — papers carry rank from parse.js
            // (either p.rank from the API or fallback index order).
            return (pa.rank || 0) - (pb.rank || 0);
          case 'year':
            return (pb.year || 0) - (pa.year || 0) ||
                   (pb.citationCount || 0) - (pa.citationCount || 0);
          case 'title':
            return (pa.title || '').localeCompare(pb.title || '');
          case 'relevance':
            return (tierScore(pb.relevanceTier) - tierScore(pa.relevanceTier)) ||
                   (pa.rank || 0) - (pb.rank || 0);
          case 'cites':
            return (pb.citationCount || 0) - (pa.citationCount || 0);
          default:
            return (pa.rank || 0) - (pb.rank || 0);
        }
      });

      const rows = arr.map(pi => {
        const p = parsed.papers[pi];
        const tlabel = tierToLabel(p.relevanceTier);
        const tag = tlabel
          ? '<span class="tier-tag tier-' + tierScore(p.relevanceTier) + '">' +
            escapeHtml(tlabel) + '</span> '
          : '';
        return '<div class="paper-row" data-idx="' + pi + '">' +
                 '<div class="paper-title-small">' + tag + escapeHtml(p.title) + '</div>' +
                 '<div class="paper-meta-small">' +
                   (p.year || '?') + ' · ' + (p.citationCount || 0) + ' cites' +
                   (p.authors && p.authors[0]
                     ? ' · ' + escapeHtml(p.authors[0]) +
                       (p.authors.length > 1 ? ' et al.' : '')
                     : '') +
                 '</div>' +
               '</div>';
      }).join('');
      host.innerHTML = arr.length
        ? '<div class="detail-block" style="padding:0">' + rows + '</div>'
        : '<div class="detail-placeholder">No papers match filter.</div>';

      host.querySelectorAll('.paper-row').forEach(row => {
        row.addEventListener('click', () => {
          const idx = +row.getAttribute('data-idx');
          showPaperDetail(parsed.papers[idx], null);
        });
      });
    }
    renderRows();
  }

  function optionTag(value, label, current) {
    return '<option value="' + value + '"' +
           (current === value ? ' selected' : '') + '>' + label + '</option>';
  }

  function showOverallDetail(parsed, clusters) {
    const detail = document.getElementById('detail');
    if (!detail) return;
    detail.innerHTML =
      '<h3 class="detail-title">Overview</h3>' +
      '<div class="detail-meta">Click a cluster or paper bubble to inspect.</div>';
  }

  // ─── Helpers ───

  function tierScore(t) {
    if (t == null) return 0;
    const s = String(t).toLowerCase();
    if (s.includes('perfectly')) return 3;
    if (s.includes('highly'))    return 2;
    if (s.includes('somewhat'))  return 1;
    return 0;
  }
  function tierToLabel(t) {
    if (t == null) return '';
    if (typeof t !== 'string') return '';
    return t.replace(/_/g, ' ');
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({
      '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  if (typeof window !== 'undefined') {
    window.AstaViz = { renderMindMap, computeLayout, resetPanZoom, PALETTE };
  }
})();
