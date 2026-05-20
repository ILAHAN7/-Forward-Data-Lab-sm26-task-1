/**
 * nlp.js — Tokenize / POS-filter / lemmatize / stopword removal.
 *
 * Uses compromise.js (window.nlp) when available, otherwise falls back
 * to a regex tokenizer + simple suffix lemmatizer.
 *
 * Pipeline:
 *   text → tokenize → lowercase → POS-tag (noun + adjective only)
 *        → lemmatize → length>=3 → alpha filter → stopword removal
 *
 * Returns: array of concept tokens (one paper's "concept bag").
 */

(function () {
  'use strict';

  // General English + Academic boilerplate stopwords (~150 entries).
  const STOPWORDS = new Set([
    'a','an','the','and','or','but','if','of','at','by','for','with','about',
    'against','between','into','through','during','before','after','above','below',
    'to','from','up','down','in','out','on','off','over','under','again','further',
    'then','once','here','there','when','where','why','how','all','any','both',
    'each','few','more','most','other','some','such','no','nor','not','only','own',
    'same','so','than','too','very','s','t','can','will','just','don','should',
    'now','also','however','therefore','furthermore','thus','moreover','either',
    'neither','this','that','these','those','it','its','they','them','their',
    'we','our','us','my','me','you','your','he','him','his','she','her','hers',
    'be','am','are','is','was','were','been','being','have','has','had','having',
    'do','does','did','doing','would','could','should','may','might','must','shall',
    'get','got','make','made','find','found','give','given','gave','provide',
    'consider','include','perform','obtain','observe','suggest','indicate','report',
    'use','using','propose','present','demonstrate','show','shown','described',
    'paper','study','research','work','approach','method','model','result','show',
    'novel','first','figure','table','section','equation','overall','particular',
    'general','specific','various','several','many','much','number','set','case',
    'example','data','dataset','task','problem','system','process','technique',
    'algorithm','experiment','evaluation','analysis','framework','discussion',
    'introduction','conclusion','abstract','reference','review','better','best',
    'well','able','possible','important','main','related','different','effective',
    'efficient','also','still','already','yet','always','often','sometimes','usually',
    'one','two','three','four','five','six','seven','eight','nine','ten',
    'percent','percentage','ratio','rate','time','year','years','day','days',
    'papers','models','methods','studies','results','works','approaches','processes','tasks'
  ]);

  function simpleLemma(word) {
    if (!word) return '';
    word = word.toLowerCase();
    if (word.length <= 3) return word;
    if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y';
    if (word.endsWith('ses') && word.length > 4) return word.slice(0, -2);
    if (word.endsWith('xes') && word.length > 4) return word.slice(0, -2);
    if (word.endsWith('ying') && word.length > 5) return word.slice(0, -4) + 'y';
    if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
    if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
    if (word.endsWith('s') && word.length > 3 && !word.endsWith('ss') && !word.endsWith('us'))
      return word.slice(0, -1);
    return word;
  }

  function tokenize(text) {
    if (!text) return [];
    return text
      .toLowerCase()
      .split(/[^a-z0-9\-]+/)
      .filter(t => t.length >= 3 && /^[a-z]/.test(t));
  }

  function extractConcepts(text) {
    if (!text || typeof text !== 'string') return [];
    let tokens;

    if (typeof window !== 'undefined' && typeof window.nlp === 'function') {
      try {
        const doc = window.nlp(text);
        const nouns = doc.nouns().toSingular().out('array');
        const adjs = doc.adjectives().out('array');
        tokens = [...nouns, ...adjs];
        tokens = tokens.flatMap(t =>
          t.toLowerCase().split(/[^a-z0-9\-]+/).filter(Boolean)
        );
      } catch (_) {
        tokens = tokenize(text).map(simpleLemma);
      }
    } else {
      tokens = tokenize(text).map(simpleLemma);
    }

    return tokens
      .map(t => t.toLowerCase().trim())
      .filter(t => t.length >= 3)
      .filter(t => /^[a-z][a-z0-9\-]*$/.test(t))
      .filter(t => !STOPWORDS.has(t));
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { extractConcepts, tokenize, simpleLemma, STOPWORDS };
  }
  if (typeof window !== 'undefined') {
    window.AstaNLP = { extractConcepts, tokenize, simpleLemma, STOPWORDS };
  }
})();
