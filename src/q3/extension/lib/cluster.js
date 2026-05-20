/**
 * cluster.js — TF-IDF vectorization + clustering.
 *
 * Two algorithms available:
 *   - kmeansClusters (default)      : balanced sub-topic discovery.
 *   - agglomerativeCluster (legacy) : outlier-preserving merging.
 *
 * `clusterToTarget(vectors, K)` is the entry point used by the popup
 * orchestrator; it now delegates to k-means with deterministic
 * k-means++ initialisation:
 *
 *   1. First centroid: vector farthest from the overall mean
 *      (most "extreme" paper).
 *   2. Subsequent centroids: vector with maximum minimum distance to
 *      already-chosen centroids.
 *   3. Iterate assign + update until convergence (or 30 iterations).
 *   4. If a centroid becomes empty (no closest members), reseed it
 *      with the member currently farthest from its assigned centroid.
 *
 * Why k-means over agglomerative+average linkage for our case:
 *   Asta search results are typically dominated by one main topic
 *   (the query). Average linkage merges everything into a single
 *   giant cluster and peels off outliers as singletons. K-means
 *   makes every paper compete for the closest centroid, so the
 *   main topic naturally subdivides into coherent sub-topics
 *   (e.g., "probabilistic ML", "probabilistic hardware", ...).
 *
 * For N≈74 papers and K=6 with vocab ~1.6k: ~80 ms total in browser.
 */

(function () {
  'use strict';

  // ───────────────────────── Vectorization ─────────────────────────

  function buildVocabulary(conceptBags) {
    const vocab = Object.create(null);
    let idx = 0;
    for (const bag of conceptBags) {
      for (const concept of bag) {
        if (!(concept in vocab)) vocab[concept] = idx++;
      }
    }
    return vocab;
  }

  function computeTFIDF(conceptBags, vocab) {
    const N = conceptBags.length;
    const V = Object.keys(vocab).length;
    if (V === 0) return conceptBags.map(() => new Float32Array(0));

    const df = new Float32Array(V);
    for (const bag of conceptBags) {
      const seen = new Set();
      for (const c of bag) {
        if (c in vocab && !seen.has(c)) {
          df[vocab[c]] += 1;
          seen.add(c);
        }
      }
    }

    const vectors = [];
    for (const bag of conceptBags) {
      const vec = new Float32Array(V);
      const tf = Object.create(null);
      for (const c of bag) {
        if (c in vocab) tf[vocab[c]] = (tf[vocab[c]] || 0) + 1;
      }
      let norm = 0;
      for (const k in tf) {
        const i = +k;
        const idf = Math.log((N + 1) / (df[i] + 1)) + 1;
        const tfidf = tf[i] * idf;
        vec[i] = tfidf;
        norm += tfidf * tfidf;
      }
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < V; i++) vec[i] /= norm;
      vectors.push(vec);
    }
    return vectors;
  }

  function cosineSimilarity(a, b) {
    let s = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) s += a[i] * b[i];
    return s;
  }

  // ───────────────────────── Helpers ─────────────────────────

  function range(n) {
    const arr = new Array(n);
    for (let i = 0; i < n; i++) arr[i] = i;
    return arr;
  }

  function meanCentroidVec(vectors, indices) {
    if (!indices.length) return new Float32Array(0);
    const V = vectors[indices[0]].length;
    const sum = new Float32Array(V);
    for (const idx of indices) {
      const v = vectors[idx];
      for (let i = 0; i < V; i++) sum[i] += v[i];
    }
    let norm = 0;
    for (let i = 0; i < V; i++) {
      sum[i] /= indices.length;
      norm += sum[i] * sum[i];
    }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < V; i++) sum[i] /= norm;
    return sum;
  }

  // ───────────────────────── K-means ─────────────────────────

  /**
   * Deterministic k-means with k-means++ initialisation.
   * Uses cosine distance (1 - cos sim) on L2-normalised vectors.
   *
   * @returns {{members:number[], centroid:Float32Array}[]} non-empty clusters
   */
  function kmeansClusters(vectors, K, opts) {
    opts = opts || {};
    const maxIters = opts.maxIters || 30;
    const N = vectors.length;
    if (N === 0) return [];
    K = Math.max(1, Math.min(K, N));
    if (K === 1) {
      return [{ members: range(N), centroid: meanCentroidVec(vectors, range(N)) }];
    }

    // ── k-means++ init (deterministic farthest-first) ──
    const centroids = [];
    const overall = meanCentroidVec(vectors, range(N));
    let first = 0, maxD = -Infinity;
    for (let i = 0; i < N; i++) {
      const d = 1 - cosineSimilarity(vectors[i], overall);
      if (d > maxD) { maxD = d; first = i; }
    }
    centroids.push(new Float32Array(vectors[first]));

    for (let c = 1; c < K; c++) {
      let pick = 0, maxMinD = -Infinity;
      for (let i = 0; i < N; i++) {
        let minD = Infinity;
        for (const cen of centroids) {
          const d = 1 - cosineSimilarity(vectors[i], cen);
          if (d < minD) minD = d;
        }
        if (minD > maxMinD) { maxMinD = minD; pick = i; }
      }
      centroids.push(new Float32Array(vectors[pick]));
    }

    // ── Iterate assign + update ──
    const V = vectors[0].length;
    let assignments = new Int32Array(N);
    for (let iter = 0; iter < maxIters; iter++) {
      // Assign each vector to nearest centroid.
      let changed = 0;
      for (let i = 0; i < N; i++) {
        let best = 0, bestSim = -Infinity;
        for (let c = 0; c < K; c++) {
          const sim = cosineSimilarity(vectors[i], centroids[c]);
          if (sim > bestSim) { bestSim = sim; best = c; }
        }
        if (assignments[i] !== best) { assignments[i] = best; changed++; }
      }
      if (iter > 0 && changed === 0) break;

      // Update centroids.
      const counts = new Int32Array(K);
      const newCens = [];
      for (let c = 0; c < K; c++) newCens.push(new Float32Array(V));
      for (let i = 0; i < N; i++) {
        const c = assignments[i];
        counts[c]++;
        const v = vectors[i];
        const nc = newCens[c];
        for (let j = 0; j < V; j++) nc[j] += v[j];
      }
      for (let c = 0; c < K; c++) {
        if (counts[c] === 0) {
          // Empty cluster — reseed with member farthest from its centroid.
          let pick = 0, maxFarD = -Infinity;
          for (let i = 0; i < N; i++) {
            const d = 1 - cosineSimilarity(vectors[i], centroids[assignments[i]]);
            if (d > maxFarD) { maxFarD = d; pick = i; }
          }
          newCens[c] = new Float32Array(vectors[pick]);
        } else {
          const nc = newCens[c];
          for (let j = 0; j < V; j++) nc[j] /= counts[c];
          let n2 = 0;
          for (let j = 0; j < V; j++) n2 += nc[j] * nc[j];
          n2 = Math.sqrt(n2) || 1;
          for (let j = 0; j < V; j++) nc[j] /= n2;
        }
      }

      // Convergence check on centroid shift.
      let totalShift = 0;
      for (let c = 0; c < K; c++) {
        totalShift += 1 - cosineSimilarity(centroids[c], newCens[c]);
      }
      for (let c = 0; c < K; c++) centroids[c] = newCens[c];
      if (totalShift < 0.001) break;
    }

    // Build cluster objects.
    const clusters = [];
    for (let c = 0; c < K; c++) {
      const members = [];
      for (let i = 0; i < N; i++) if (assignments[i] === c) members.push(i);
      clusters.push({ members, centroid: centroids[c] });
    }
    return clusters.filter(c => c.members.length > 0);
  }

  // ───────────────────────── Agglomerative (legacy) ─────────────────────────

  function findClosestPair(clusters) {
    let bestI = -1, bestJ = -1, bestDist = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const sim = cosineSimilarity(clusters[i].centroid, clusters[j].centroid);
        const dist = 1 - sim;
        if (dist < bestDist) {
          bestDist = dist;
          bestI = i;
          bestJ = j;
        }
      }
    }
    return { i: bestI, j: bestJ, distance: bestDist };
  }

  function mergeClusters(clusters, pair) {
    const c1 = clusters[pair.i];
    const c2 = clusters[pair.j];
    const newMembers = c1.members.concat(c2.members);
    const V = c1.centroid.length;
    const w1 = c1.members.length;
    const w2 = c2.members.length;
    const totalW = w1 + w2;
    const newCentroid = new Float32Array(V);
    for (let k = 0; k < V; k++) {
      newCentroid[k] = (c1.centroid[k] * w1 + c2.centroid[k] * w2) / totalW;
    }
    let norm = 0;
    for (let k = 0; k < V; k++) norm += newCentroid[k] * newCentroid[k];
    norm = Math.sqrt(norm) || 1;
    for (let k = 0; k < V; k++) newCentroid[k] /= norm;

    if (pair.i > pair.j) {
      clusters.splice(pair.i, 1);
      clusters.splice(pair.j, 1);
    } else {
      clusters.splice(pair.j, 1);
      clusters.splice(pair.i, 1);
    }
    clusters.push({ members: newMembers, centroid: newCentroid });
  }

  function agglomerativeCluster(vectors, distanceThreshold, maxClusters) {
    if (distanceThreshold === undefined) distanceThreshold = 0.85;
    if (maxClusters === undefined) maxClusters = Infinity;
    const N = vectors.length;
    if (N === 0) return [];
    if (N === 1) return [{ members: [0], centroid: vectors[0] }];

    let clusters = vectors.map((v, i) => ({
      members: [i],
      centroid: new Float32Array(v)
    }));

    while (clusters.length > 1 && clusters.length > maxClusters) {
      mergeClusters(clusters, findClosestPair(clusters));
    }
    while (clusters.length > 1) {
      const pair = findClosestPair(clusters);
      if (pair.distance > distanceThreshold) break;
      mergeClusters(clusters, pair);
    }
    return clusters;
  }

  // ───────────────────────── Public API ─────────────────────────

  /**
   * Cluster vectors into exactly `targetCount` clusters using k-means.
   * Returns up to `targetCount` non-empty clusters.
   */
  function clusterToTarget(vectors, targetCount) {
    return kmeansClusters(vectors, targetCount);
  }

  function computeAffinities(vectors, clusters) {
    return vectors.map(v => {
      const scores = clusters.map((c, cIdx) => ({
        clusterIdx: cIdx,
        similarity: cosineSimilarity(v, c.centroid)
      }));
      scores.sort((a, b) => b.similarity - a.similarity);
      return scores;
    });
  }

  /**
   * Auto-target cluster count: round(sqrt(N) * 0.7), clamped [3, 8].
   */
  function autoTargetCount(N) {
    if (N <= 2) return 1;
    if (N < 6)  return 2;
    return Math.max(3, Math.min(8, Math.round(Math.sqrt(N) * 0.7)));
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      buildVocabulary, computeTFIDF, cosineSimilarity,
      kmeansClusters, agglomerativeCluster,
      clusterToTarget, autoTargetCount, computeAffinities
    };
  }
  if (typeof window !== 'undefined') {
    window.AstaCluster = {
      buildVocabulary, computeTFIDF, cosineSimilarity,
      kmeansClusters, agglomerativeCluster,
      clusterToTarget, autoTargetCount, computeAffinities
    };
  }
})();
