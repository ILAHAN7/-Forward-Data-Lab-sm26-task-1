/**
 * thesaurus.js — Academic-domain synonym normalization.
 *
 * Maps surface variants (acronyms, plurals, related spellings) to a
 * canonical concept form. Covers CS + Econ + FinTech terms relevant
 * to the typical Asta query set.
 *
 * Format: canonical -> [variants]
 * Lookup: token -> canonical (or token itself if not in the map).
 */

(function () {
  'use strict';

  const SYNONYMS = {
    // ── Deep learning architectures ──
    'transformer':           ['transformers','transformer-based','transformer-architecture'],
    'attention':             ['self-attention','multi-head-attention','attentions'],
    'neural-network':        ['neural-net','neural-nets','neural-networks','net','nets'],
    'convolutional-neural-network': ['cnn','cnns','convnet','convnets','convolutional'],
    'recurrent-neural-network':     ['rnn','rnns','recurrent'],
    'lstm':                  ['long-short-term-memory'],
    'gru':                   ['gated-recurrent-unit'],
    'graph-neural-network':  ['gnn','gnns','graph-neural-networks','graph-convolutional','gcn'],
    'generative-adversarial-network': ['gan','gans'],
    // ── ML/AI general ──
    'machine-learning':      ['ml','machine-learn'],
    'deep-learning':         ['dl','deep-learn'],
    'natural-language-processing': ['nlp','natural-language'],
    'reinforcement-learning': ['rl','reinforce','rl-agent'],
    'large-language-model':  ['llm','llms','language-model','language-models'],
    'embedding':             ['embeddings','embed'],
    'fine-tuning':           ['finetune','finetuning','fine-tune'],
    'pre-training':          ['pretrain','pretraining','pretrained'],
    'transfer-learning':     ['transfer-learn'],
    'few-shot':              ['few-shot-learning','fewshot'],
    'zero-shot':             ['zero-shot-learning','zeroshot'],
    'self-supervised':       ['self-supervised-learning','ssl'],
    // ── Retrieval / IR ──
    'information-retrieval': ['ir','retrieval'],
    'dense-retrieval':       ['dense-retriever','dpr'],
    'sparse-retrieval':      ['bm25','sparse-retriever'],
    'reranking':             ['rerank','re-rank','re-ranking'],
    'retrieval-augmented-generation': ['rag','retrieval-augmented'],
    // ── DeFi / Crypto ──
    'decentralized-finance': ['defi','decentralised-finance'],
    'maximal-extractable-value': ['mev','miner-extractable-value'],
    'smart-contract':        ['smart-contracts','smartcontract'],
    'stablecoin':            ['stablecoins','stable-coin'],
    'cryptocurrency':        ['crypto','cryptocurrencies','crypto-asset','crypto-assets'],
    'flash-loan':            ['flash-loans','flashloan'],
    'oracle':                ['oracles','price-oracle','data-oracle'],
    'blockchain':            ['blockchains','distributed-ledger','distributed-ledgers'],
    'ethereum':              ['eth','ethereum-network'],
    'bitcoin':               ['btc'],
    'consensus':             ['consensus-mechanism','consensus-protocol'],
    'proof-of-stake':        ['pos'],
    'proof-of-work':         ['pow'],
    'liquidity-pool':        ['liquidity-pools','amm','automated-market-maker'],
    // ── FinTech / Finance ──
    'central-bank-digital-currency': ['cbdc','cbdcs','digital-currency'],
    'buy-now-pay-later':     ['bnpl'],
    'credit-scoring':        ['credit-score','credit-scores','creditworthiness'],
    'credit-risk':           ['default-risk','credit-default'],
    'fraud-detection':       ['fraud','fraudulent','fraud-prevention'],
    'anti-money-laundering': ['aml'],
    'know-your-customer':    ['kyc','customer-due-diligence'],
    'algorithmic-trading':   ['algo-trading','algorithmic-trader','high-frequency-trading','hft'],
    'systemic-risk':         ['systemic-risks','systemic'],
    'open-banking':          ['psd2','open-finance'],
    'regulatory-technology': ['regtech','regulation-technology'],
    'insurance-technology':  ['insurtech','insur-tech'],
    'real-time-gross-settlement': ['rtgs'],
    // ── Statistical / mathematical ──
    'bayesian':              ['bayesian-network','bayesian-networks','bayesian-inference'],
    'time-series':           ['timeseries','time-series-analysis'],
    'limit-order-book':      ['lob','order-book'],
    'portfolio-optimization': ['portfolio-management','portfolio'],
    // ── Privacy / Security ──
    'differential-privacy':  ['dp','privacy-preserving'],
    'federated-learning':    ['federated','fed-learn'],
    'cyber-risk':            ['cybersecurity','cyber-security','operational-risk'],
    // ── Methodology terms ──
    'explainable-ai':        ['xai','explainability','interpretability'],
    'shap':                  ['shapley','shap-values'],
    'fairness':              ['algorithmic-fairness','fairness-constraint'],
    'disparate-impact':      ['disparate-treatment','discrimination']
  };

  const VARIANT_TO_CANONICAL = {};
  for (const [canon, variants] of Object.entries(SYNONYMS)) {
    VARIANT_TO_CANONICAL[canon.toLowerCase()] = canon;
    for (const v of variants) {
      VARIANT_TO_CANONICAL[v.toLowerCase()] = canon;
    }
  }

  function normalize(token) {
    if (!token) return '';
    const lc = token.toLowerCase();
    return VARIANT_TO_CANONICAL[lc] || lc;
  }

  function normalizeAll(tokens) {
    return (tokens || []).map(normalize);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalize, normalizeAll, SYNONYMS, VARIANT_TO_CANONICAL };
  }
  if (typeof window !== 'undefined') {
    window.AstaThesaurus = { normalize, normalizeAll, SYNONYMS };
  }
})();
