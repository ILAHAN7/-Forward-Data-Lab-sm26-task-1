"""
step1_generate_queries.py
────────────────────────────────────────────────────────────────────────────
Generate 50 FinTech search queries from a curated dataset of 25 papers.

Each paper produces two queries:
  - Type A (Specific) : exact method + domain terms  (8-15 words)
  - Type B (Broad)    : general topic phrasing        (4-8 words)

Saved outputs:
  data/q1/queries.json                  full query list with ground truth
  logs/step1_YYYYMMDD_HHMMSS.log        full run log (console + file)

Usage:
  cd <repo_root>/src/q1
  python step1_generate_queries.py
"""

import json
import logging
import os
import time

# ── Paths ─────────────────────────────────────────────────────────────────────
# BASE_DIR is auto-derived from this script's location so the same code works
# on Windows and Linux without edits.
# Layout assumption: <BASE_DIR>/src/q1/step1_generate_queries.py
BASE_DIR    = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR    = os.path.join(BASE_DIR, "data", "q1")
LOG_DIR     = os.path.join(BASE_DIR, "logs")
OUTPUT_PATH = os.path.join(DATA_DIR, "queries.json")

RUN_TS      = time.strftime("%Y%m%d_%H%M%S")   # used for log filename

# ── Logging setup ─────────────────────────────────────────────────────────────
os.makedirs(LOG_DIR, exist_ok=True)
log_path = os.path.join(LOG_DIR, f"step1_{RUN_TS}.log")

logging.basicConfig(
    level    = logging.INFO,
    format   = "%(asctime)s [%(levelname)s] %(message)s",
    datefmt  = "%Y-%m-%d %H:%M:%S",
    handlers = [
        logging.FileHandler(log_path, encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger(__name__)

# ── Curated FinTech paper dataset (25 papers) ─────────────────────────────────
# Covers: DeFi, credit scoring, fraud detection, CBDC, federated learning,
#         algorithmic trading, regulatory tech, NLP in finance, risk models.
PAPERS = [
    # ── DeFi / Blockchain ──────────────────────────────────────────────────
    {"title": "Flash Loan Attacks and DeFi Protocol Stability: A Game-Theoretic Analysis",
     "abstract": "We model flash loan interactions in DeFi protocols using game theory, showing that rational attackers exploit price oracle vulnerabilities to extract value, and propose mechanism design solutions to improve protocol stability.",
     "year": 2024, "domain": ["DeFi", "game theory", "blockchain", "security"]},

    {"title": "Maximal Extractable Value in Ethereum: Quantification and Mitigation Strategies",
     "abstract": "We quantify MEV extraction across Ethereum transactions, analyze its economic impact on retail users, and evaluate Layer 2 rollup solutions as MEV mitigation mechanisms.",
     "year": 2024, "domain": ["MEV", "Ethereum", "blockchain economics", "L2"]},

    {"title": "Smart Contract Vulnerability Detection Using Graph Neural Networks",
     "abstract": "We propose a GNN-based framework for detecting reentrancy and integer overflow vulnerabilities in Ethereum smart contracts, achieving state-of-the-art F1 scores on benchmark datasets.",
     "year": 2023, "domain": ["smart contracts", "GNN", "vulnerability detection"]},

    {"title": "Decentralized Oracle Networks and the Oracle Problem in Blockchain Finance",
     "abstract": "We analyze the oracle problem in decentralized finance, evaluate existing oracle solutions including Chainlink and UMA, and propose a cryptographic commitment scheme for tamper-resistant price feeds.",
     "year": 2023, "domain": ["oracle problem", "DeFi", "smart contracts", "price feeds"]},

    {"title": "Stablecoin Design Tradeoffs: Collateralization, Algorithmic Stability, and Systemic Risk",
     "abstract": "We evaluate the stability properties of collateral-backed, algorithmic, and hybrid stablecoins using a dynamic systems model, demonstrating conditions under which each design is susceptible to depegging spirals.",
     "year": 2024, "domain": ["stablecoins", "systemic risk", "DeFi", "monetary economics"]},

    # ── Credit Scoring / Lending ───────────────────────────────────────────
    {"title": "Disparate Impact and Fairness Constraints in Machine Learning Credit Scoring",
     "abstract": "We empirically evaluate fairness-aware credit scoring models under ECOA regulatory constraints, showing that standard fairness metrics (demographic parity, equalized odds) are often mutually incompatible.",
     "year": 2024, "domain": ["credit scoring", "fairness", "machine learning", "regulation"]},

    {"title": "Explainable AI for Consumer Credit Decisions: SHAP Values and Regulatory Compliance",
     "abstract": "We apply SHAP-based explanations to gradient boosting credit models and evaluate whether model-agnostic explanations satisfy adverse action notice requirements under the Fair Credit Reporting Act.",
     "year": 2023, "domain": ["XAI", "credit scoring", "SHAP", "regulatory compliance"]},

    {"title": "Alternative Data in Credit Underwriting: Rent Payment History and Telecom Data",
     "abstract": "Using a panel of 2 million US consumers, we estimate the incremental predictive value of rent payment and telecom data for credit scoring thin-file borrowers, with implications for financial inclusion.",
     "year": 2023, "domain": ["alternative data", "credit underwriting", "financial inclusion"]},

    {"title": "Buy Now Pay Later Regulatory Frameworks: Consumer Protection and Credit Risk",
     "abstract": "We compare BNPL regulatory approaches across the US, EU, and Australia, analyze default risk patterns using transaction-level data, and assess systemic risk from BNPL integration with traditional credit markets.",
     "year": 2024, "domain": ["BNPL", "regulation", "consumer credit", "financial risk"]},

    # ── Fraud Detection ────────────────────────────────────────────────────
    {"title": "Graph Neural Networks for Real-Time Transaction Fraud Detection",
     "abstract": "We model payment networks as dynamic heterogeneous graphs and apply temporal GNNs to detect fraudulent transactions with sub-millisecond latency, outperforming XGBoost baselines on industry datasets.",
     "year": 2024, "domain": ["fraud detection", "GNN", "real-time", "payment systems"]},

    {"title": "Federated Learning for Cross-Institutional Financial Fraud Detection with Differential Privacy",
     "abstract": "We develop a federated learning framework allowing banks to collaboratively train fraud detection models without sharing customer data, using DP-SGD to provide formal privacy guarantees.",
     "year": 2024, "domain": ["federated learning", "fraud detection", "differential privacy", "finance"]},

    {"title": "Multichain DeFi Fraud Detection Using Machine Learning on On-Chain Data",
     "abstract": "We extract behavioral features from Ethereum, BSC, and Polygon transactions across 23 DeFi protocols to train XGBoost and neural network classifiers for detecting rug pulls and wash trading.",
     "year": 2023, "domain": ["DeFi", "fraud detection", "blockchain analytics", "machine learning"]},

    # ── Algorithmic Trading ────────────────────────────────────────────────
    {"title": "Transformer Architectures for High-Frequency Stock Price Prediction Using Limit Order Book Data",
     "abstract": "We apply Transformer and Temporal Fusion Transformer models to predict mid-price movements from limit order book snapshots at millisecond resolution, achieving superior performance over LSTM baselines.",
     "year": 2024, "domain": ["algorithmic trading", "Transformer", "limit order book", "price prediction"]},

    {"title": "Deep Reinforcement Learning for Portfolio Optimization Under Transaction Costs",
     "abstract": "We formulate multi-asset portfolio optimization as a Markov Decision Process and train a proximal policy optimization agent that learns to trade while minimizing transaction costs and maximizing risk-adjusted returns.",
     "year": 2023, "domain": ["reinforcement learning", "portfolio optimization", "algorithmic trading"]},

    {"title": "Sentiment Analysis of Financial News for Stock Return Prediction Using Large Language Models",
     "abstract": "We fine-tune FinBERT and GPT-based models on financial news corpora to predict next-day stock returns, analyzing whether LLM-derived sentiment factors generate alpha beyond traditional momentum signals.",
     "year": 2024, "domain": ["NLP", "sentiment analysis", "stock prediction", "LLM", "finance"]},

    # ── CBDC / Monetary Policy ─────────────────────────────────────────────
    {"title": "Central Bank Digital Currency Design: Privacy, Financial Stability, and Monetary Policy Transmission",
     "abstract": "We model CBDC design choices along three dimensions - anonymity, programmability, and interest-bearing features - and analyze their implications for bank disintermediation and monetary policy effectiveness.",
     "year": 2024, "domain": ["CBDC", "monetary policy", "financial stability", "privacy"]},

    {"title": "Cross-Border CBDC Interoperability: Technical Standards and Geopolitical Implications",
     "abstract": "We survey cross-border CBDC initiatives (mBridge, Project Dunbar) and evaluate the role of technical interoperability standards (ISO 20022, atomic swaps) in shaping dollar hegemony under digital currency regimes.",
     "year": 2023, "domain": ["CBDC", "cross-border payments", "interoperability", "geopolitics"]},

    # ── RegTech / Compliance ───────────────────────────────────────────────
    {"title": "Regulatory Sandbox Effects on FinTech Innovation: Evidence from Southeast Asia",
     "abstract": "Using a difference-in-differences design, we estimate the causal effect of regulatory sandbox programs in Singapore, Malaysia, and Thailand on FinTech startup formation, funding, and product launches.",
     "year": 2023, "domain": ["regulatory sandbox", "FinTech innovation", "Southeast Asia", "policy"]},

    {"title": "Anti-Money Laundering Compliance Using Network Analysis and NLP",
     "abstract": "We combine transaction graph analysis with NLP processing of SWIFT message narratives to identify money laundering typologies, reducing false positive rates by 60% compared to rule-based systems.",
     "year": 2024, "domain": ["AML", "network analysis", "NLP", "compliance", "SWIFT"]},

    {"title": "Machine Learning for Systemic Risk Monitoring in Financial Networks",
     "abstract": "We apply graph convolutional networks to interbank exposure networks to predict systemic stress events, evaluating model performance against CoVaR and SRISK benchmarks using data from 48 countries.",
     "year": 2023, "domain": ["systemic risk", "financial networks", "GCN", "macroprudential"]},

    # ── Insurtech / Risk ───────────────────────────────────────────────────
    {"title": "Parametric Insurance Smart Contracts for Climate Risk Using Satellite Data",
     "abstract": "We design and simulate parametric crop insurance contracts on Ethereum that automatically trigger payouts when NDVI satellite indices fall below drought thresholds, eliminating claims adjustment costs.",
     "year": 2024, "domain": ["insurtech", "parametric insurance", "smart contracts", "climate risk"]},

    {"title": "Cyber Risk Quantification for Financial Institutions Using Bayesian Networks",
     "abstract": "We develop a Bayesian network model for quantifying operational cyber risk in banking, calibrated on FDIC loss data and publicly disclosed breach events, and estimate cyber VaR for stress testing.",
     "year": 2023, "domain": ["cyber risk", "operational risk", "Bayesian networks", "banking"]},

    # ── Open Banking / Payments ────────────────────────────────────────────
    {"title": "Open Banking API Adoption and Consumer Financial Outcomes: Evidence from PSD2",
     "abstract": "Using transaction-level data from the EU Payment Services Directive 2 rollout, we estimate the causal effect of open banking API adoption on consumer saving behavior, credit access, and financial literacy.",
     "year": 2024, "domain": ["open banking", "PSD2", "API", "consumer finance", "policy"]},

    {"title": "Real-Time Gross Settlement Systems and Systemic Liquidity Risk",
     "abstract": "We model intraday liquidity dynamics in RTGS payment systems using agent-based simulation, identifying conditions under which gridlock cascades propagate across settlement participants.",
     "year": 2023, "domain": ["RTGS", "payment systems", "systemic risk", "liquidity"]},

    {"title": "Large Language Models for Financial Document Understanding and Regulatory Reporting",
     "abstract": "We benchmark GPT-4, LLaMA, and FinLLM on XBRL regulatory filing extraction, SEC 10-K question answering, and Basel III capital ratio computation tasks, analyzing hallucination rates in financial contexts.",
     "year": 2024, "domain": ["LLM", "financial NLP", "regulatory reporting", "XBRL", "hallucination"]},
]


# ── Query builder ─────────────────────────────────────────────────────────────
def build_query_pair(paper: dict, index: int) -> tuple[dict, dict]:
    """
    Build a (Type A, Type B) query pair from a paper entry.

    Type A — specific: paper title used verbatim as the query.
              Rationale: title IS the most precise description of the paper,
              and enables exact ground-truth matching in evaluation.
    Type B — broad: first 2-3 domain tags joined as keywords.
              Rationale: simulates a non-expert who knows the topic area
              but not the specific paper.
    """
    pair_id = f"P{index:02d}"

    query_a = {
        "query_id":   pair_id + "A",
        "query":      paper["title"],                         # exact title
        "query_type": "specific",
        "rationale":  (
            "Type A uses the exact paper title as the query. "
            "This maximises precision of the ground-truth match "
            "while reflecting how a researcher who knows the topic "
            "would phrase a targeted search."
        ),
        "ground_truth": {
            "title":    paper["title"],
            "year":     paper["year"],
            "abstract": paper["abstract"],
            "domain":   paper["domain"],
        },
    }

    broad_keywords = " ".join(paper["domain"][:3])
    query_b = {
        "query_id":   pair_id + "B",
        "query":      broad_keywords,                         # keyword tags
        "query_type": "broad",
        "rationale":  (
            "Type B uses high-level domain keywords derived from the paper's "
            "topic tags. This simulates a non-expert searcher and tests "
            "recall breadth rather than precision."
        ),
        "ground_truth": {
            "title":    paper["title"],
            "year":     paper["year"],
            "abstract": paper["abstract"],
            "domain":   paper["domain"],
        },
    }

    return query_a, query_b


# ── Run summary helper ────────────────────────────────────────────────────────
def write_run_summary(queries: list, elapsed: float) -> None:
    """
    Append a structured run summary block to the log.
    Covers: counts, type distribution, domain coverage, year spread.
    """
    type_a = sum(1 for q in queries if q["query_type"] == "specific")
    type_b = sum(1 for q in queries if q["query_type"] == "broad")
    years  = [q["ground_truth"]["year"] for q in queries]
    domains: dict[str, int] = {}
    for q in queries:
        for d in q["ground_truth"]["domain"]:
            domains[d] = domains.get(d, 0) + 1
    top_domains = sorted(domains.items(), key=lambda x: -x[1])[:8]

    log.info("─" * 55)
    log.info("RUN SUMMARY")
    log.info("─" * 55)
    log.info(f"  Total queries    : {len(queries)}")
    log.info(f"  Type A (specific): {type_a}")
    log.info(f"  Type B (broad)   : {type_b}")
    log.info(f"  Year range       : {min(years)} – {max(years)}")
    log.info(f"  Papers from 2024 : {sum(1 for y in years if y == 2024)}")
    log.info(f"  Papers from 2023 : {sum(1 for y in years if y == 2023)}")
    log.info("  Top domains:")
    for d, c in top_domains:
        log.info(f"    {d}: {c} queries")
    log.info(f"  Elapsed          : {elapsed:.1f}s")
    log.info(f"  Output           : {OUTPUT_PATH}")
    log.info(f"  Log              : {log_path}")
    log.info("─" * 55)


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    t_start = time.time()

    log.info("=" * 55)
    log.info("STEP 1 — Generate 50 FinTech search queries")
    log.info(f"Run ID : {RUN_TS}")
    log.info(f"Papers : {len(PAPERS)}")
    log.info(f"Target : {len(PAPERS) * 2} queries ({len(PAPERS)} pairs)")
    log.info("=" * 55)

    flat_queries: list[dict] = []

    for i, paper in enumerate(PAPERS, start=1):
        log.info(f"[{i:02d}/{len(PAPERS)}] {paper['title'][:60]} ...")

        try:
            query_a, query_b = build_query_pair(paper, i)
            flat_queries.extend([query_a, query_b])
            log.info(f"         A: {query_a['query'][:70]}")
            log.info(f"         B: {query_b['query']}")

        except Exception as exc:
            log.error(f"         FAILED — {exc}")

    # Trim to exactly 50
    flat_queries = flat_queries[:50]

    # Build output document
    output = {
        "meta": {
            "generated_at":  time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "run_id":        RUN_TS,
            "script":        "step1_generate_queries.py",
            "total_queries": len(flat_queries),
            "total_papers":  len(PAPERS),
            "description": (
                "50 FinTech search queries (25 papers x 2 types) "
                "for Asta vs Google Scholar evaluation. "
                "Type A = exact paper title (specific), "
                "Type B = domain keyword tags (broad)."
            ),
        },
        "query_type_definitions": {
            "specific": "Exact paper title — targets precise retrieval, enables ground-truth matching",
            "broad":    "Domain keyword tags — tests general recall, simulates non-expert searcher",
        },
        "queries": flat_queries,
    }

    # Save output
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    log.info(f"queries.json saved — {len(flat_queries)} entries")

    # Write run summary to log
    write_run_summary(flat_queries, elapsed=time.time() - t_start)


if __name__ == "__main__":
    main()
