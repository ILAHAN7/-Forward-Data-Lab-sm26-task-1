/**
 * label.js — c-TF-IDF cluster labels with minimum-presence floor.
 *
 * For each cluster, compute distinctive top-K concepts:
 *   c-TF-IDF(concept, cluster) =
 *     freq_in_cluster × (log(K / clusters_containing_concept) + 1)
 *
 * A concept is only eligible as a label if it appears in at least
 * MIN_PRESENCE_RATIO fraction of the cluster's members (min 2 papers
 * for clusters with >1 members). This prevents a single outlier
 * paper's unusual vocabulary from being chosen as a cluster label
 * just because the term doesn't appear in other clusters.
 *
 * Example before the floor: a 24-paper cluster contains one paper
 * mentioning "copilot"; "copilot" then has high c-TF-IDF score (rare
 * across clusters) and ends up in the top-3 label even though it
 * describes only 1/24 of the cluster. With MIN_PRESENCE_RATIO=0.25,
 * "copilot" must appear in ≥6 of the 24 papers to be eligible.
 *
 * Returns: [{clusterIdx, topConcepts:[{concept,score,tfInCluster,presence}], labelString}]
 */

(function () {
  'use strict';

  const MIN_PRESENCE_RATIO = 0.25;  // concept must appear in ≥25% of cluster
  const MIN_PRESENCE_FLOOR = 2;     // absolute minimum (for tiny clusters)

  function computeClusterLabels(conceptBags, clusters, vocab, topK) {
    if (topK === undefined) topK = 3;
    const K = clusters.length;
    if (K === 0) return [];
    const vocabArr = Object.keys(vocab);
    const V = vocabArr.length;

    // Per-cluster term frequency (normalized by cluster total).
    const clusterTF = clusters.map(c => {
      const tf = new Float32Array(V);
      let total = 0;
      for (const paperIdx of c.members) {
        for (const concept of conceptBags[paperIdx] || []) {
          if (concept in vocab) {
            tf[vocab[concept]] += 1;
            total += 1;
          }
        }
      }
      if (total > 0) for (let i = 0; i < V; i++) tf[i] /= total;
      return tf;
    });

    // Per-cluster presence (how many members of this cluster contain
    // each concept at least once). Used for the min-presence floor.
    const clusterPresence = clusters.map(c => {
      const pres = new Int32Array(V);
      for (const paperIdx of c.members) {
        const seen = new Set();
        for (const concept of conceptBags[paperIdx] || []) {
          if (concept in vocab && !seen.has(concept)) {
            pres[vocab[concept]] += 1;
            seen.add(concept);
          }
        }
      }
      return pres;
    });

    // Cluster-frequency (across clusters, for IDF).
    const cf = new Int32Array(V);
    for (const tf of clusterTF) {
      for (let i = 0; i < V; i++) if (tf[i] > 0) cf[i] += 1;
    }

    return clusters.map((c, cIdx) => {
      const memberCount = c.members.length;
      const minPresence = memberCount === 1
        ? 1
        : Math.max(MIN_PRESENCE_FLOOR, Math.ceil(memberCount * MIN_PRESENCE_RATIO));

      const tf  = clusterTF[cIdx];
      const pres = clusterPresence[cIdx];
      const scored = [];
      for (let i = 0; i < V; i++) {
        if (tf[i] > 0 && pres[i] >= minPresence) {
          const idf = Math.log(K / cf[i]) + 1;
          scored.push({
            concept: vocabArr[i],
            score: tf[i] * idf,
            tfInCluster: tf[i],
            presence: pres[i]
          });
        }
      }
      scored.sort((a, b) => b.score - a.score);

      // If the strict floor leaves us with no eligible concepts (e.g.,
      // a tiny noisy cluster), fall back to the unfiltered top-by-tf
      // so we always have *some* label rather than blank.
      let top = scored.slice(0, topK);
      if (top.length === 0) {
        const fallback = [];
        for (let i = 0; i < V; i++) {
          if (tf[i] > 0) {
            fallback.push({
              concept: vocabArr[i],
              score: tf[i],
              tfInCluster: tf[i],
              presence: pres[i]
            });
          }
        }
        fallback.sort((a, b) => b.score - a.score);
        top = fallback.slice(0, topK);
      }

      return {
        clusterIdx: cIdx,
        topConcepts: top,
        labelString: top.map(s => prettify(s.concept)).join(' · ')
      };
    });
  }

  function prettify(concept) {
    if (!concept) return '';
    return concept.replace(/-/g, ' ');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { computeClusterLabels, prettify, MIN_PRESENCE_RATIO };
  }
  if (typeof window !== 'undefined') {
    window.AstaLabel = { computeClusterLabels, prettify, MIN_PRESENCE_RATIO };
  }
})();
