/**
 * step3a_asta_collect.js
 * ──────────────────────────────────────────────────────────────────────────
 * Automated Asta Find Papers data collection script.
 * Run this in Chrome DevTools Console on asta.allen.ai/chat/{any-thread-id}
 *
 * What it does:
 *   1. Extracts the JWT Bearer token from Auth0 localStorage entry
 *   2. Runs all 50 FinTech queries against the Asta Paper Finder API
 *   3. Collects up to ~75 papers per query with full metadata
 *   4. Stores results in window._astaResults
 *   5. Auto-downloads asta_raw.json when complete
 *
 * How to use:
 *   1. Open asta.allen.ai and log in
 *   2. Click any existing chat thread (URL must be /chat/{thread-id})
 *   3. Open DevTools Console (F12)
 *   4. Paste entire contents of this file and press Enter
 *   5. Wait ~40 minutes for all 50 queries to complete
 *   6. File asta_raw.json will auto-download on completion
 *   7. Move asta_raw.json to: <repo_root>/data/q1/asta/
 *   8. Run step3b_save_asta_results.py to split into per-query JSONs
 *
 * Resume support:
 *   If interrupted, re-run — already collected queries are skipped.
 *   window._astaResults persists in the browser tab until page refresh.
 *
 * Notes:
 *   - JWT token expires in ~7 days; re-run if you get 401 errors
 *   - Do not navigate away from the page during collection
 *   - DELAY_BETWEEN controls speed (default 6s between queries)
 */

(async function collectAstaPapers() {

  // ── Auth: extract JWT from Auth0 localStorage ───────────────────────────
  const AUTH0_KEY = '@@auth0spajs@@::NooXSgcgofRJD5lX7uWMY8stR032mhE5' +
                    '::https://nora-api.allen.ai::openid profile email offline_access';
  const tokenBody = JSON.parse(localStorage.getItem(AUTH0_KEY));
  if (!tokenBody) {
    console.error('ASTA_ERROR: Auth0 token not found in localStorage. Are you logged in?');
    return;
  }
  const TOKEN = 'Bearer ' + tokenBody.body.access_token;
  console.log('ASTA_AUTH: JWT token extracted successfully.');

  // ── Config ──────────────────────────────────────────────────────────────
  const POLL_INTERVAL = 3000;   // ms between status polls
  const MAX_POLLS     = 40;     // max polls per phase (~120s timeout)
  const DELAY_BETWEEN = 6000;   // ms between queries
  const MABOOL        = 'https://mabool-demo.allen.ai';

  // ── State ───────────────────────────────────────────────────────────────
  window._astaResults = window._astaResults || [];
  window._astaErrors  = window._astaErrors  || [];
  window._astaRunning = true;

  // ── Query list (50 queries — 25 papers x 2 types) ───────────────────────
  const QUERIES = [
    // ── DeFi / Blockchain ─────────────────────────────────────────────────
    { query_id: 'P01A', query_type: 'specific',
      query: 'Flash Loan Attacks and DeFi Protocol Stability: A Game-Theoretic Analysis',
      ground_truth: { title: 'Flash Loan Attacks and DeFi Protocol Stability: A Game-Theoretic Analysis', year: 2024, domain: ['DeFi','game theory','blockchain','security'] } },
    { query_id: 'P01B', query_type: 'broad',
      query: 'DeFi game theory blockchain',
      ground_truth: { title: 'Flash Loan Attacks and DeFi Protocol Stability: A Game-Theoretic Analysis', year: 2024, domain: ['DeFi','game theory','blockchain','security'] } },
    { query_id: 'P02A', query_type: 'specific',
      query: 'Maximal Extractable Value in Ethereum: Quantification and Mitigation Strategies',
      ground_truth: { title: 'Maximal Extractable Value in Ethereum: Quantification and Mitigation Strategies', year: 2024, domain: ['MEV','Ethereum','blockchain economics','L2'] } },
    { query_id: 'P02B', query_type: 'broad',
      query: 'MEV Ethereum blockchain economics',
      ground_truth: { title: 'Maximal Extractable Value in Ethereum: Quantification and Mitigation Strategies', year: 2024, domain: ['MEV','Ethereum','blockchain economics','L2'] } },
    { query_id: 'P03A', query_type: 'specific',
      query: 'Smart Contract Vulnerability Detection Using Graph Neural Networks',
      ground_truth: { title: 'Smart Contract Vulnerability Detection Using Graph Neural Networks', year: 2023, domain: ['smart contracts','GNN','vulnerability detection'] } },
    { query_id: 'P03B', query_type: 'broad',
      query: 'smart contracts GNN vulnerability detection',
      ground_truth: { title: 'Smart Contract Vulnerability Detection Using Graph Neural Networks', year: 2023, domain: ['smart contracts','GNN','vulnerability detection'] } },
    { query_id: 'P04A', query_type: 'specific',
      query: 'Decentralized Oracle Networks and the Oracle Problem in Blockchain Finance',
      ground_truth: { title: 'Decentralized Oracle Networks and the Oracle Problem in Blockchain Finance', year: 2023, domain: ['oracle problem','DeFi','smart contracts','price feeds'] } },
    { query_id: 'P04B', query_type: 'broad',
      query: 'oracle problem DeFi smart contracts',
      ground_truth: { title: 'Decentralized Oracle Networks and the Oracle Problem in Blockchain Finance', year: 2023, domain: ['oracle problem','DeFi','smart contracts','price feeds'] } },
    { query_id: 'P05A', query_type: 'specific',
      query: 'Stablecoin Design Tradeoffs: Collateralization, Algorithmic Stability, and Systemic Risk',
      ground_truth: { title: 'Stablecoin Design Tradeoffs: Collateralization, Algorithmic Stability, and Systemic Risk', year: 2024, domain: ['stablecoins','systemic risk','DeFi','monetary economics'] } },
    { query_id: 'P05B', query_type: 'broad',
      query: 'stablecoins systemic risk DeFi',
      ground_truth: { title: 'Stablecoin Design Tradeoffs: Collateralization, Algorithmic Stability, and Systemic Risk', year: 2024, domain: ['stablecoins','systemic risk','DeFi','monetary economics'] } },
    // ── Credit Scoring / Lending ──────────────────────────────────────────
    { query_id: 'P06A', query_type: 'specific',
      query: 'Disparate Impact and Fairness Constraints in Machine Learning Credit Scoring',
      ground_truth: { title: 'Disparate Impact and Fairness Constraints in Machine Learning Credit Scoring', year: 2024, domain: ['credit scoring','fairness','machine learning','regulation'] } },
    { query_id: 'P06B', query_type: 'broad',
      query: 'credit scoring fairness machine learning',
      ground_truth: { title: 'Disparate Impact and Fairness Constraints in Machine Learning Credit Scoring', year: 2024, domain: ['credit scoring','fairness','machine learning','regulation'] } },
    { query_id: 'P07A', query_type: 'specific',
      query: 'Explainable AI for Consumer Credit Decisions: SHAP Values and Regulatory Compliance',
      ground_truth: { title: 'Explainable AI for Consumer Credit Decisions: SHAP Values and Regulatory Compliance', year: 2023, domain: ['XAI','credit scoring','SHAP','regulatory compliance'] } },
    { query_id: 'P07B', query_type: 'broad',
      query: 'XAI credit scoring SHAP',
      ground_truth: { title: 'Explainable AI for Consumer Credit Decisions: SHAP Values and Regulatory Compliance', year: 2023, domain: ['XAI','credit scoring','SHAP','regulatory compliance'] } },
    { query_id: 'P08A', query_type: 'specific',
      query: 'Alternative Data in Credit Underwriting: Rent Payment History and Telecom Data',
      ground_truth: { title: 'Alternative Data in Credit Underwriting: Rent Payment History and Telecom Data', year: 2023, domain: ['alternative data','credit underwriting','financial inclusion'] } },
    { query_id: 'P08B', query_type: 'broad',
      query: 'alternative data credit underwriting financial inclusion',
      ground_truth: { title: 'Alternative Data in Credit Underwriting: Rent Payment History and Telecom Data', year: 2023, domain: ['alternative data','credit underwriting','financial inclusion'] } },
    { query_id: 'P09A', query_type: 'specific',
      query: 'Buy Now Pay Later Regulatory Frameworks: Consumer Protection and Credit Risk',
      ground_truth: { title: 'Buy Now Pay Later Regulatory Frameworks: Consumer Protection and Credit Risk', year: 2024, domain: ['BNPL','regulation','consumer credit','financial risk'] } },
    { query_id: 'P09B', query_type: 'broad',
      query: 'BNPL regulation consumer credit',
      ground_truth: { title: 'Buy Now Pay Later Regulatory Frameworks: Consumer Protection and Credit Risk', year: 2024, domain: ['BNPL','regulation','consumer credit','financial risk'] } },
    // ── Fraud Detection ───────────────────────────────────────────────────
    { query_id: 'P10A', query_type: 'specific',
      query: 'Graph Neural Networks for Real-Time Transaction Fraud Detection',
      ground_truth: { title: 'Graph Neural Networks for Real-Time Transaction Fraud Detection', year: 2024, domain: ['fraud detection','GNN','real-time','payment systems'] } },
    { query_id: 'P10B', query_type: 'broad',
      query: 'fraud detection GNN real-time',
      ground_truth: { title: 'Graph Neural Networks for Real-Time Transaction Fraud Detection', year: 2024, domain: ['fraud detection','GNN','real-time','payment systems'] } },
    { query_id: 'P11A', query_type: 'specific',
      query: 'Federated Learning for Cross-Institutional Financial Fraud Detection with Differential Privacy',
      ground_truth: { title: 'Federated Learning for Cross-Institutional Financial Fraud Detection with Differential Privacy', year: 2024, domain: ['federated learning','fraud detection','differential privacy','finance'] } },
    { query_id: 'P11B', query_type: 'broad',
      query: 'federated learning fraud detection differential privacy',
      ground_truth: { title: 'Federated Learning for Cross-Institutional Financial Fraud Detection with Differential Privacy', year: 2024, domain: ['federated learning','fraud detection','differential privacy','finance'] } },
    { query_id: 'P12A', query_type: 'specific',
      query: 'Multichain DeFi Fraud Detection Using Machine Learning on On-Chain Data',
      ground_truth: { title: 'Multichain DeFi Fraud Detection Using Machine Learning on On-Chain Data', year: 2023, domain: ['DeFi','fraud detection','blockchain analytics','machine learning'] } },
    { query_id: 'P12B', query_type: 'broad',
      query: 'DeFi fraud detection blockchain analytics',
      ground_truth: { title: 'Multichain DeFi Fraud Detection Using Machine Learning on On-Chain Data', year: 2023, domain: ['DeFi','fraud detection','blockchain analytics','machine learning'] } },
    // ── Algorithmic Trading ───────────────────────────────────────────────
    { query_id: 'P13A', query_type: 'specific',
      query: 'Transformer Architectures for High-Frequency Stock Price Prediction Using Limit Order Book Data',
      ground_truth: { title: 'Transformer Architectures for High-Frequency Stock Price Prediction Using Limit Order Book Data', year: 2024, domain: ['algorithmic trading','Transformer','limit order book','price prediction'] } },
    { query_id: 'P13B', query_type: 'broad',
      query: 'algorithmic trading Transformer limit order book',
      ground_truth: { title: 'Transformer Architectures for High-Frequency Stock Price Prediction Using Limit Order Book Data', year: 2024, domain: ['algorithmic trading','Transformer','limit order book','price prediction'] } },
    { query_id: 'P14A', query_type: 'specific',
      query: 'Deep Reinforcement Learning for Portfolio Optimization Under Transaction Costs',
      ground_truth: { title: 'Deep Reinforcement Learning for Portfolio Optimization Under Transaction Costs', year: 2023, domain: ['reinforcement learning','portfolio optimization','algorithmic trading'] } },
    { query_id: 'P14B', query_type: 'broad',
      query: 'reinforcement learning portfolio optimization algorithmic trading',
      ground_truth: { title: 'Deep Reinforcement Learning for Portfolio Optimization Under Transaction Costs', year: 2023, domain: ['reinforcement learning','portfolio optimization','algorithmic trading'] } },
    { query_id: 'P15A', query_type: 'specific',
      query: 'Sentiment Analysis of Financial News for Stock Return Prediction Using Large Language Models',
      ground_truth: { title: 'Sentiment Analysis of Financial News for Stock Return Prediction Using Large Language Models', year: 2024, domain: ['NLP','sentiment analysis','stock prediction','LLM','finance'] } },
    { query_id: 'P15B', query_type: 'broad',
      query: 'NLP sentiment analysis stock prediction',
      ground_truth: { title: 'Sentiment Analysis of Financial News for Stock Return Prediction Using Large Language Models', year: 2024, domain: ['NLP','sentiment analysis','stock prediction','LLM','finance'] } },
    // ── CBDC / Monetary Policy ────────────────────────────────────────────
    { query_id: 'P16A', query_type: 'specific',
      query: 'Central Bank Digital Currency Design: Privacy, Financial Stability, and Monetary Policy Transmission',
      ground_truth: { title: 'Central Bank Digital Currency Design: Privacy, Financial Stability, and Monetary Policy Transmission', year: 2024, domain: ['CBDC','monetary policy','financial stability','privacy'] } },
    { query_id: 'P16B', query_type: 'broad',
      query: 'CBDC monetary policy financial stability',
      ground_truth: { title: 'Central Bank Digital Currency Design: Privacy, Financial Stability, and Monetary Policy Transmission', year: 2024, domain: ['CBDC','monetary policy','financial stability','privacy'] } },
    { query_id: 'P17A', query_type: 'specific',
      query: 'Cross-Border CBDC Interoperability: Technical Standards and Geopolitical Implications',
      ground_truth: { title: 'Cross-Border CBDC Interoperability: Technical Standards and Geopolitical Implications', year: 2023, domain: ['CBDC','cross-border payments','interoperability','geopolitics'] } },
    { query_id: 'P17B', query_type: 'broad',
      query: 'CBDC cross-border payments interoperability',
      ground_truth: { title: 'Cross-Border CBDC Interoperability: Technical Standards and Geopolitical Implications', year: 2023, domain: ['CBDC','cross-border payments','interoperability','geopolitics'] } },
    // ── RegTech / Compliance ──────────────────────────────────────────────
    { query_id: 'P18A', query_type: 'specific',
      query: 'Regulatory Sandbox Effects on FinTech Innovation: Evidence from Southeast Asia',
      ground_truth: { title: 'Regulatory Sandbox Effects on FinTech Innovation: Evidence from Southeast Asia', year: 2023, domain: ['regulatory sandbox','FinTech innovation','Southeast Asia','policy'] } },
    { query_id: 'P18B', query_type: 'broad',
      query: 'regulatory sandbox FinTech innovation Southeast Asia',
      ground_truth: { title: 'Regulatory Sandbox Effects on FinTech Innovation: Evidence from Southeast Asia', year: 2023, domain: ['regulatory sandbox','FinTech innovation','Southeast Asia','policy'] } },
    { query_id: 'P19A', query_type: 'specific',
      query: 'Anti-Money Laundering Compliance Using Network Analysis and NLP',
      ground_truth: { title: 'Anti-Money Laundering Compliance Using Network Analysis and NLP', year: 2024, domain: ['AML','network analysis','NLP','compliance','SWIFT'] } },
    { query_id: 'P19B', query_type: 'broad',
      query: 'AML network analysis NLP',
      ground_truth: { title: 'Anti-Money Laundering Compliance Using Network Analysis and NLP', year: 2024, domain: ['AML','network analysis','NLP','compliance','SWIFT'] } },
    { query_id: 'P20A', query_type: 'specific',
      query: 'Machine Learning for Systemic Risk Monitoring in Financial Networks',
      ground_truth: { title: 'Machine Learning for Systemic Risk Monitoring in Financial Networks', year: 2023, domain: ['systemic risk','financial networks','GCN','macroprudential'] } },
    { query_id: 'P20B', query_type: 'broad',
      query: 'systemic risk financial networks GCN',
      ground_truth: { title: 'Machine Learning for Systemic Risk Monitoring in Financial Networks', year: 2023, domain: ['systemic risk','financial networks','GCN','macroprudential'] } },
    // ── Insurtech / Risk ──────────────────────────────────────────────────
    { query_id: 'P21A', query_type: 'specific',
      query: 'Parametric Insurance Smart Contracts for Climate Risk Using Satellite Data',
      ground_truth: { title: 'Parametric Insurance Smart Contracts for Climate Risk Using Satellite Data', year: 2024, domain: ['insurtech','parametric insurance','smart contracts','climate risk'] } },
    { query_id: 'P21B', query_type: 'broad',
      query: 'insurtech parametric insurance smart contracts',
      ground_truth: { title: 'Parametric Insurance Smart Contracts for Climate Risk Using Satellite Data', year: 2024, domain: ['insurtech','parametric insurance','smart contracts','climate risk'] } },
    { query_id: 'P22A', query_type: 'specific',
      query: 'Cyber Risk Quantification for Financial Institutions Using Bayesian Networks',
      ground_truth: { title: 'Cyber Risk Quantification for Financial Institutions Using Bayesian Networks', year: 2023, domain: ['cyber risk','operational risk','Bayesian networks','banking'] } },
    { query_id: 'P22B', query_type: 'broad',
      query: 'cyber risk operational risk Bayesian networks',
      ground_truth: { title: 'Cyber Risk Quantification for Financial Institutions Using Bayesian Networks', year: 2023, domain: ['cyber risk','operational risk','Bayesian networks','banking'] } },
    // ── Open Banking / Payments ───────────────────────────────────────────
    { query_id: 'P23A', query_type: 'specific',
      query: 'Open Banking API Adoption and Consumer Financial Outcomes: Evidence from PSD2',
      ground_truth: { title: 'Open Banking API Adoption and Consumer Financial Outcomes: Evidence from PSD2', year: 2024, domain: ['open banking','PSD2','API','consumer finance','policy'] } },
    { query_id: 'P23B', query_type: 'broad',
      query: 'open banking PSD2 API',
      ground_truth: { title: 'Open Banking API Adoption and Consumer Financial Outcomes: Evidence from PSD2', year: 2024, domain: ['open banking','PSD2','API','consumer finance','policy'] } },
    { query_id: 'P24A', query_type: 'specific',
      query: 'Real-Time Gross Settlement Systems and Systemic Liquidity Risk',
      ground_truth: { title: 'Real-Time Gross Settlement Systems and Systemic Liquidity Risk', year: 2023, domain: ['RTGS','payment systems','systemic risk','liquidity'] } },
    { query_id: 'P24B', query_type: 'broad',
      query: 'RTGS payment systems systemic risk',
      ground_truth: { title: 'Real-Time Gross Settlement Systems and Systemic Liquidity Risk', year: 2023, domain: ['RTGS','payment systems','systemic risk','liquidity'] } },
    { query_id: 'P25A', query_type: 'specific',
      query: 'Large Language Models for Financial Document Understanding and Regulatory Reporting',
      ground_truth: { title: 'Large Language Models for Financial Document Understanding and Regulatory Reporting', year: 2024, domain: ['LLM','financial NLP','regulatory reporting','XBRL','hallucination'] } },
    { query_id: 'P25B', query_type: 'broad',
      query: 'LLM financial NLP regulatory reporting',
      ground_truth: { title: 'Large Language Models for Financial Document Understanding and Regulatory Reporting', year: 2024, domain: ['LLM','financial NLP','regulatory reporting','XBRL','hallucination'] } },
  ];

  // ── Helpers ─────────────────────────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Authenticated fetch — injects Bearer token on every request
  const apiFetch = (url, opts = {}) => fetch(url, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      'Authorization': TOKEN,
      ...(opts.headers || {}),
    },
  });

  async function runQuery(q, idx) {
    /**
     * Execute one full Asta query lifecycle:
     *   create thread -> send message -> poll round_id
     *   -> poll completion -> fetch papers -> return result
     */
    const start = Date.now();
    console.log(`ASTA_PROGRESS: [${idx + 1}/50] ${q.query_id} "${q.query.slice(0, 55)}..."`);

    try {
      // 1. Create a fresh paper-finder thread
      const tRes      = await apiFetch('/api/chat/thread?channel_prefix=paper-finder', { method: 'PUT' });
      const tData     = await tRes.json();
      const thread_id = tData.thread.key;

      // 2. Submit the query as a chat message
      await apiFetch('/api/chat/message', {
        method: 'POST',
        body: JSON.stringify({
          text:                q.query,
          thread_id,
          profile:             'paper-finder-only',
          channel_prefix:      'paper-finder',
          model_configuration: null,
        }),
      });

      // 3. Poll until the Asta agent creates a result widget (round_id)
      let round_id = null;
      for (let i = 0; i < MAX_POLLS; i++) {
        await sleep(POLL_INTERVAL);
        const msgs   = await fetch(`${MABOOL}/api/2/threads/${thread_id}/messages?from_offset=0`)
                             .then(r => r.json()).catch(() => []);
        const action = msgs.find(m => m.kind === 'action' && m.action?.kind === 'new-widget');
        if (action) { round_id = action.action.widgetId; break; }
      }
      if (!round_id) throw new Error('Timeout: round_id not received within ' + (MAX_POLLS * POLL_INTERVAL / 1000) + 's');

      // 4. Poll until the agent marks the round as completed
      for (let i = 0; i < MAX_POLLS; i++) {
        await sleep(POLL_INTERVAL);
        const msgs = await fetch(`${MABOOL}/api/2/threads/${thread_id}/messages?from_offset=0`)
                           .then(r => r.json()).catch(() => []);
        if (msgs.find(m => m.kind === 'action' && m.action?.kind === 'completed')) break;
      }

      // 5. Fetch the ranked paper list
      const papers  = await fetch(`${MABOOL}/api/2/rounds/${round_id}/result/widget`).then(r => r.json());
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const recent  = papers.filter(p => p.year >= 2023).length;
      console.log(`ASTA_PROGRESS:   -> ${papers.length} papers | ${recent} from 2023+ | ${elapsed}s`);

      // 6. Normalise and return result
      return {
        query_id:     q.query_id,
        query:        q.query,
        query_type:   q.query_type,
        engine:       'asta',
        fetched_at:   new Date().toISOString(),
        thread_id,
        round_id,
        result_count: papers.length,
        ground_truth: q.ground_truth,
        papers: papers.map((p, i) => ({
          rank:            i + 1,
          corpusId:        p.corpusId,
          title:           p.title           || '',
          abstract:        p.abstract        || '',
          year:            p.year            || null,
          venue:           p.venue           || '',
          citation_count:  p.citationCount   || null,
          relevance_score: p.relevanceScore  || null,
          relevance_tier:  p.relevanceJudgement || null,
          url:             p.url             || '',
          authors:         (p.authors || []).map(a => a.name),
          snippets:        p.snippets        || [],
        })),
      };

    } catch (err) {
      console.error(`ASTA_ERROR: [${idx + 1}] ${q.query_id} — ${err.message}`);
      window._astaErrors.push({ query_id: q.query_id, error: err.message, timestamp: new Date().toISOString() });
      return null;
    }
  }

  function downloadResults() {
    /** Trigger browser download of asta_raw.json */
    const data = JSON.stringify(window._astaResults, null, 2);
    const blob  = new Blob([data], { type: 'application/json' });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href      = url;
    a.download  = 'asta_raw.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log('ASTA_DOWNLOAD: asta_raw.json downloaded (' + data.length + ' chars)');
  }

  // ── Main collection loop ─────────────────────────────────────────────────
  const collectedIds = new Set(window._astaResults.map(r => r.query_id));
  const remaining    = QUERIES.filter(q => !collectedIds.has(q.query_id));
  console.log(`ASTA_START: ${collectedIds.size} already cached, ${remaining.length} remaining.`);

  for (let i = 0; i < remaining.length; i++) {
    if (!window._astaRunning) {
      console.log('ASTA_PAUSED: set window._astaRunning = true to resume.');
      break;
    }

    const result = await runQuery(remaining[i], i);
    if (result) window._astaResults.push(result);

    // Log progress summary every 10 queries
    if ((i + 1) % 10 === 0 || i === remaining.length - 1) {
      const total_papers = window._astaResults.reduce((s, r) => s + (r.papers?.length || 0), 0);
      console.log(`ASTA_CHECKPOINT: ${window._astaResults.length}/50 collected | ` +
                  `${window._astaErrors.length} errors | ${total_papers} total papers`);
    }

    if (i < remaining.length - 1) await sleep(DELAY_BETWEEN);
  }

  window._astaRunning = false;
  console.log(`ASTA_DONE: ${window._astaResults.length} collected, ${window._astaErrors.length} errors.`);

  // Auto-download on completion
  downloadResults();

})();
