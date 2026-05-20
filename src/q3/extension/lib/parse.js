/**
 * parse.js — Asta paper payload → uniform Paper objects.
 *
 * Handles known shapes:
 *   - Array of paper objects (response capture from inject.js).
 *   - {query, papers:[...]} wrapper (offline fixtures).
 *   - Slim outbound telemetry shape (corpusId / paperTitle / paperYear
 *     / isSelected / isVisible — no abstract/relevance/citations).
 *
 * For the rich mabool-demo `/result/widget` shape, `relevanceJudgement`
 * is an OBJECT (not a string):
 *   relevanceJudgement: {
 *     relevance: 0..1,
 *     relevanceCriteriaJudgements: [
 *       { criterion, met, summary }, ...
 *     ]
 *   }
 * We derive:
 *   - relevanceTier (string): tier label from the numeric `.relevance`
 *   - relevanceScore (number): the raw `.relevance` value
 *   - relevanceSummary (string): concatenated criterion summaries
 *   - relevanceCriteria (array): pass-through of judgements
 *
 * Output schema (uniform):
 *   {
 *     query: string,
 *     papers: [{
 *       rank, paperId, title, abstract, year, venue,
 *       citationCount, relevanceScore, relevanceTier,
 *       url, authors[], relevanceSummary,
 *       relevanceCriteria,
 *       snippets: [{text, sectionTitle}],
 *       clusterText
 *     }]
 *   }
 *
 * clusterText fallback order:
 *   1. relevanceSummary  (derived from criteria)
 *   2. abstract
 *   3. first 3 snippet texts concatenated
 *   4. title
 */

(function () {
  'use strict';

  function pickTitle(p) {
    return p.title || p.paperTitle || p.paper_title || '';
  }
  function pickYear(p) {
    return p.year || p.paperYear || p.paper_year || null;
  }
  function pickPaperId(p) {
    const id = p.corpusId || p.corpus_id || p.paperId || p.paper_id;
    if (id == null) return '';
    return String(id);
  }

  // ── Relevance: tier + score + summary from various shapes ──
  function deriveTierFromScore(score) {
    if (typeof score !== 'number' || isNaN(score)) return null;
    if (score >= 0.75) return 'perfectly_relevant';
    if (score >= 0.5)  return 'highly_relevant';
    if (score >= 0.25) return 'somewhat_relevant';
    return 'not_relevant';
  }

  function extractRelevance(p) {
    const out = { tier: null, score: null, summary: '', criteria: null };

    // Case 1: legacy string-tier shape (step3a fixtures, slim).
    const tierStr =
      (typeof p.relevance_tier      === 'string' && p.relevance_tier) ||
      (typeof p.relevanceTier       === 'string' && p.relevanceTier)  ||
      (typeof p.relevance_judgement === 'string' && p.relevance_judgement) ||
      (typeof p.relevanceJudgement  === 'string' && p.relevanceJudgement);
    if (tierStr) out.tier = tierStr.toLowerCase();

    // Case 2: numeric score (top-level).
    if (typeof p.relevanceScore === 'number')  out.score = p.relevanceScore;
    else if (typeof p.relevance_score === 'number') out.score = p.relevance_score;

    // Case 3: rich Asta object — relevanceJudgement: {relevance, relevanceCriteriaJudgements}
    const j = p.relevanceJudgement || p.relevance_judgement;
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      if (typeof j.relevance === 'number') {
        out.score = j.relevance;
      }
      const criteria =
        j.relevanceCriteriaJudgements ||
        j.relevance_criteria_judgements ||
        j.criteria;
      if (Array.isArray(criteria)) {
        out.criteria = criteria;
        const parts = criteria.map(c => {
          if (!c) return '';
          return c.summary || c.reason || c.explanation || '';
        }).filter(Boolean);
        if (parts.length > 0) out.summary = parts.join(' ');
      }
      if (!out.tier && typeof j.tier === 'string') out.tier = j.tier.toLowerCase();
    }

    // Top-level relevanceSummary (older shape).
    if (!out.summary) {
      if (typeof p.relevanceSummary === 'string')  out.summary = p.relevanceSummary;
      else if (typeof p.relevance_summary === 'string') out.summary = p.relevance_summary;
    }

    // Derive tier from score if we have a number but no tier string.
    if (!out.tier && typeof out.score === 'number') {
      out.tier = deriveTierFromScore(out.score);
    }
    return out;
  }

  function parseAstaResponse(input, externalQuery) {
    let papers;
    let query = externalQuery || '';

    if (Array.isArray(input)) {
      papers = input;
    } else if (input && typeof input === 'object') {
      papers = input.papers || [];
      query = query || input.query || input.query_id || '';
    } else {
      throw new Error('parse.js: Unknown Asta response format');
    }

    return {
      query,
      papers: papers.map((p, i) => {
        const title = pickTitle(p);
        const year = pickYear(p);
        const paperId = pickPaperId(p);
        const rel = extractRelevance(p);

        const snippets = (Array.isArray(p.snippets) ? p.snippets : []).map(s => {
          const safeS = s || {};
          return {
            text: typeof safeS.text === 'string' ? safeS.text.trim() : '',
            sectionTitle: safeS.sectionTitle || safeS.section_title || ''
          };
        });
        const clusterText = pickClusterText(rel.summary, p.abstract, snippets, title);

        return {
          rank: p.rank || (i + 1),
          paperId,
          title,
          abstract: typeof p.abstract === 'string' ? p.abstract : '',
          year,
          venue: typeof p.venue === 'string' ? p.venue : '',
          citationCount: p.citationCount || p.citation_count || 0,
          relevanceScore: rel.score,
          relevanceTier:  rel.tier,                 // ALWAYS string-or-null
          relevanceSummary: rel.summary || '',
          relevanceCriteria: rel.criteria || null,
          url: typeof p.url === 'string' ? p.url : buildSemanticScholarUrl(paperId),
          authors: (Array.isArray(p.authors) ? p.authors : []).map(a =>
            typeof a === 'string' ? a : (a && typeof a.name === 'string') ? a.name : ''
          ).filter(Boolean),
          snippets,
          clusterText
        };
      })
    };
  }

  function pickClusterText(relSummary, abstract, snippets, title) {
    if (relSummary && relSummary.length > 30) return relSummary;
    if (abstract && abstract.length > 30) return abstract;
    if (snippets && snippets.length > 0) {
      const joined = snippets.slice(0, 3).map(s => s.text).filter(Boolean).join(' ');
      if (joined.length > 30) return joined;
    }
    return title || '';
  }

  function buildSemanticScholarUrl(id) {
    if (id && /^\d+$/.test(String(id))) {
      return 'https://www.semanticscholar.org/paper/' + id;
    }
    return '';
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseAstaResponse, deriveTierFromScore };
  }
  if (typeof window !== 'undefined') {
    window.AstaParse = { parseAstaResponse, deriveTierFromScore };
  }
})();
