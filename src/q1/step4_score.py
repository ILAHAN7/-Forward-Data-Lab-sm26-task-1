"""
step4_score.py — Q1 evaluation (v2)
==========================================================================
Comparison of Asta Find Papers vs Google Scholar on a 50-query FinTech suite.

Seven metrics on existing collected data (no LLM calls, no extra collection):
  1. Overlap                       — fraction of Top-K papers in common
                                     (title fuzzy match >= 0.85)
  2. Topical Hit Rate              — fraction of Top-K in intended cluster
  3. Topical Breadth               — unique FinTech clusters in Top-K
  4. Currency                      — mean publication year + 4-band dist
  5. Citation Influence            — mean log(citation_count + 1)
  6. Evidence Depth (Asta-only)    — snippet sectionTitle distribution
  7a. Self-Confidence Calibration  — Asta-only: rel=3 papers on-topic rate
  7b. Summary Concept Coverage     — Asta-only: relevanceSummary nouns in abstract

GS = 1.0 baseline; Asta normalized where ratio applies.
"""

import csv, json, logging, math, os, re, time
from collections import Counter
from difflib import SequenceMatcher

# Paths auto-derived from script location
BASE_DIR     = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR     = os.path.join(BASE_DIR, "data", "q1")
LOG_DIR      = os.path.join(BASE_DIR, "logs")
SCORES_DIR   = os.path.join(DATA_DIR, "scores")
RESULTS_DIR  = os.path.join(DATA_DIR, "results")
FIGURES_DIR  = os.path.join(RESULTS_DIR, "figures")
QUERIES_PATH = os.path.join(DATA_DIR, "queries.json")
ASTA_DIR     = os.path.join(DATA_DIR, "asta")
GS_DIR       = os.path.join(DATA_DIR, "google_scholar")

TOP_K              = 10
OVERLAP_THRESHOLD  = 0.85
CURRENCY_CUTOFF    = 2023
ENGINES            = ["asta", "google_scholar"]
GS_LABEL           = "Google Scholar"
ASTA_LABEL         = "Asta"
RUN_TS = time.strftime("%Y%m%d_%H%M%S")

os.makedirs(LOG_DIR, exist_ok=True)
log_path = os.path.join(LOG_DIR, f"step4_{RUN_TS}.log")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[logging.FileHandler(log_path, encoding="utf-8"), logging.StreamHandler()],
)
log = logging.getLogger(__name__)

# FinTech cluster keyword dictionary (8 clusters, 30-45 lowercase substrings each)
CLUSTERS = {
    "DeFi_Blockchain": [
        "defi","decentralized finance","blockchain","distributed ledger",
        "smart contract","smart contracts","cryptocurrency","crypto",
        "tokenization","tokenomics","erc-20","erc20","erc-721","nft",
        "non-fungible token","stablecoin","stablecoins","algorithmic stablecoin",
        "ethereum","bitcoin","solana","polygon","avalanche","arbitrum",
        "liquidity pool","automated market maker","amm","flash loan","flash loans",
        "yield farming","staking","governance token","dao","decentralized autonomous",
        "layer 2","layer-2","rollup","rollups","zk-rollup","optimistic rollup",
        "zk-proof","zero-knowledge","mev","maximal extractable value",
        "oracle problem","decentralized oracle","blockchain oracle",
        "reentrancy","rug pull","smart contract audit","sandwich attack",
        "front-running","proof of stake","proof of work","on-chain","off-chain",
        "cross-chain","cross chain","gas optimization",
    ],
    "Credit_Lending": [
        "credit scoring","credit score","credit risk","credit decision",
        "credit underwriting","lending","loan origination","underwriting model",
        "consumer credit","consumer lending","mortgage lending","mortgage",
        "bnpl","buy now pay later","buy-now-pay-later","auto loan","student loan",
        "personal loan","default prediction","default risk","probability of default",
        "loss given default","expected credit loss","credit risk model",
        "risk segmentation","scorecard","fair lending","fairness in lending",
        "fairness constraint","algorithmic fairness","disparate impact",
        "disparate treatment","discrimination in lending","bias mitigation",
        "equity in loans","protected class","demographic parity","equalized odds",
        "explainable ai","explainable credit","interpretable credit","shap",
        "adverse action notice","alternative data","thin file","thin-file",
        "credit bureau","fico score","rent payment history","telecom data",
        "cash flow underwriting","behavioral scoring","ecoa","fcra",
    ],
    "Fraud_Detection": [
        "fraud detection","transaction fraud","financial fraud",
        "fraudulent transactions","fraudulent behaviour","anti-fraud",
        "anti-money laundering","anti money laundering","aml compliance",
        "money laundering","know your customer","customer due diligence",
        "sanctions screening","sanctions compliance","anomaly detection",
        "outlier detection","novelty detection","graph neural network",
        "graph-based detection","isolation forest","fraud autoencoder",
        "payment fraud","card fraud","credit card fraud","debit card fraud",
        "identity theft","account takeover","synthetic identity","wire fraud",
        "check fraud","invoice fraud","phishing detection","first-party fraud",
        "third-party fraud","politically exposed person","suspicious activity report",
        "counter-terrorist financing","fatf","transaction monitoring",
        "real-time fraud","real-time detection","wash trading","pump and dump",
        "federated fraud","privacy-preserving fraud",
    ],
    "Algo_Trading": [
        "algorithmic trading","algo trading","quantitative trading",
        "systematic trading","high-frequency trading","high frequency trading",
        "electronic trading","limit order book","market making",
        "market microstructure","order flow","order routing","execution algorithm",
        "optimal execution","twap","vwap","reinforcement learning trading",
        "deep learning trading","lstm trading","transformer trading",
        "temporal fusion transformer","neural network trading","portfolio optimization",
        "portfolio management","asset allocation","risk parity","mean variance",
        "markowitz","black-litterman","momentum trading","mean reversion",
        "pairs trading","arbitrage","statistical arbitrage","stat arb",
        "volatility forecasting","garch","stochastic volatility","sentiment analysis",
        "news analytics","financial news","finbert","financial nlp",
        "stock prediction","price prediction","return prediction",
        "mid-price prediction","asset return prediction",
    ],
    "CBDC_Monetary": [
        "cbdc","central bank digital currency","digital currency","digital euro",
        "digital yuan","digital dollar","digital pound","digital rupee",
        "retail cbdc","wholesale cbdc","mbridge","project dunbar","sand dollar",
        "jam-dex","e-cny","e-krona","central bank","monetary policy",
        "monetary transmission","policy transmission","interest rate policy",
        "inflation targeting","quantitative easing","financial stability",
        "bank disintermediation","narrow banking","deposit substitution",
        "tokenized money","tokenized deposit","atomic swap","cross-border payment",
        "cross-border cbdc","cbdc interoperability","iso 20022",
        "bank for international settlements","federal reserve","european central bank",
        "bank of england","programmable money","cbdc privacy","cbdc anonymity",
        "interest-bearing cbdc",
    ],
    "RegTech": [
        "regtech","regulatory technology","compliance technology",
        "regulatory compliance","financial regulation","regulatory sandbox",
        "innovation hub","fintech sandbox","basel iii","basel iv","basel accord",
        "mifid","mifid ii","mifir","emir","gdpr","ccpa","sox","sarbanes-oxley",
        "dodd-frank","volcker rule","psd3","fatca","regulatory reporting",
        "sec filing","xbrl","edgar","form 10-k","form 10-q","call report",
        "transaction reporting","capital requirement","capital adequacy",
        "tier 1 capital","stress testing","ccar","dfast","liquidity coverage ratio",
        "lcr","nsfr","macroprudential","fca compliance","esma",
        "financial stability board","consumer financial protection",
        "compliance monitoring","consumer protection","investor protection",
        "fintech innovation policy",
    ],
    "Insurtech_Risk": [
        "insurance","insurtech","insurance technology","parametric insurance",
        "index insurance","usage-based insurance","telematics","on-demand insurance",
        "peer-to-peer insurance","p2p insurance","microinsurance","operational risk",
        "cyber risk","cyber insurance","climate risk","flood risk","wildfire risk",
        "hurricane risk","earthquake risk","catastrophe risk","catastrophe model",
        "cat bond","reinsurance","retrocession","bayesian network","actuarial model",
        "loss model","loss distribution","frequency severity","tail risk",
        "extreme value theory","value at risk","expected shortfall",
        "health insurance","life insurance","mortality model","mortality risk",
        "medical underwriting","smart contract insurance","blockchain insurance",
        "satellite-based insurance","ndvi","claims processing","claims fraud",
        "claims management","premium pricing","risk pooling","risk transfer",
        "solvency ii",
    ],
    "Open_Banking": [
        "open banking","open finance","banking-as-a-service","baas",
        "open banking api","psd2","psd 2","open banking standard","cma9",
        "cfpb 1033","section 1033","consumer data right","banking api","rest api",
        "oauth","oauth 2.0","aisp","pisp","third party provider","rtgs",
        "real-time gross settlement","real-time payment","instant payment","sepa",
        "tips","fednow","chips","fedwire","target2","payment system",
        "payment network","payment rail","settlement risk","gross settlement",
        "net settlement","delivery versus payment","data portability",
        "financial data sharing","consent management","account aggregation",
        "plaid","yodlee","tink","embedded finance","embedded banking",
        "embedded payment","remittance","correspondent banking","swift mt",
        "iso 20022 payment",
    ],
}

STOPWORDS = {
    "the","and","this","that","with","from","have","has","been","were",
    "their","they","them","these","those","such","which","where","when",
    "what","about","after","before","between","into","over","under","than",
    "then","also","more","most","some","many","much","using","used","uses",
    "paper","study","studies","work","works","show","shows","shown","showed",
    "analyze","analyzes","analysis","discuss","discusses","discussed","propose",
    "proposes","proposed","method","methods","approach","approaches","result",
    "results","present","presents","investigate","investigates","examine",
    "examines","based","novel","across","while","thus","however","furthermore",
    "additionally","include","includes","including","framework","model","models",
}

# ── Helpers ──
def safe_str(x): return "" if x is None else str(x)

def load_queries():
    with open(QUERIES_PATH, encoding="utf-8") as f:
        doc = json.load(f)
    return {q["query_id"]: q for q in doc["queries"]}

def load_engine_results(engine):
    if engine == "asta":
        folder, prefix = ASTA_DIR, "asta_"
    elif engine == "google_scholar":
        folder, prefix = GS_DIR, "gs_"
    else:
        raise ValueError(f"Unknown engine: {engine}")
    out = {}
    for fname in sorted(os.listdir(folder)):
        if not (fname.startswith(prefix) and fname.endswith(".json")): continue
        if "_all" in fname or "_raw" in fname: continue
        with open(os.path.join(folder, fname), encoding="utf-8") as f:
            res = json.load(f)
        out[res["query_id"]] = res
    return out

def top_k_papers(result, k=TOP_K):
    return (result.get("papers") or [])[:k]

def classify_paper_title(title, clusters=CLUSTERS):
    t = safe_str(title).lower()
    if not t: return "other"
    scores = {c: sum(1 for kw in kws if kw in t) for c, kws in clusters.items()}
    best = max(scores.values())
    if best == 0: return "other"
    candidates = [c for c, s in scores.items() if s == best]
    return sorted(candidates)[0]

def intent_cluster_of_query(query, clusters=CLUSTERS):
    domain = (query.get("ground_truth") or {}).get("domain") or []
    if not domain: return "other"
    cluster_hits = Counter()
    for d in domain:
        d_low = safe_str(d).lower()
        if not d_low: continue
        for c, kws in clusters.items():
            for kw in kws:
                if d_low in kw or kw in d_low:
                    cluster_hits[c] += 1
                    break
    if not cluster_hits: return "other"
    return cluster_hits.most_common(1)[0][0]

def title_similarity(a, b):
    return SequenceMatcher(None, safe_str(a).lower(), safe_str(b).lower()).ratio()

# ── Metrics ──
def compute_overlap(queries, asta_results, gs_results):
    log.info("Metric 1/7 — Overlap")
    out = {}
    vals = []
    for qid in queries:
        a = asta_results.get(qid); g = gs_results.get(qid)
        if not a or not g: continue
        a_titles = [p.get("title","") for p in top_k_papers(a)]
        g_titles = [p.get("title","") for p in top_k_papers(g)]
        denom = max(len(a_titles), len(g_titles)) or 1
        matched = sum(1 for at in a_titles if any(title_similarity(at,gt)>=OVERLAP_THRESHOLD for gt in g_titles))
        frac = matched / denom
        out[qid] = {"matched": matched, "asta_k": len(a_titles), "gs_k": len(g_titles), "overlap_fraction": round(frac,4)}
        vals.append(frac)
    mean = sum(vals)/len(vals) if vals else 0.0
    log.info(f"    Mean overlap: {mean:.4f}, zero-overlap queries: {sum(1 for v in vals if v==0)}")
    return {"per_query": out, "mean": round(mean,4), "values": vals}

def compute_topical(queries, results, engine):
    log.info(f"  Topical for {engine} ...")
    out = {}
    hits = []; brs = []
    for qid, q in queries.items():
        r = results.get(qid)
        if not r: continue
        intent = intent_cluster_of_query(q)
        papers = top_k_papers(r)
        if not papers:
            out[qid] = {"intent": intent, "hit_rate": 0.0, "breadth": 0, "k": 0, "cluster_assignments": []}
            hits.append(0.0); brs.append(0); continue
        assigns = [classify_paper_title(p.get("title","")) for p in papers]
        h = sum(1 for c in assigns if c == intent) / len(assigns)
        b = len({c for c in assigns if c != "other"})
        out[qid] = {"intent": intent, "hit_rate": round(h,4), "breadth": b, "k": len(papers), "cluster_assignments": assigns}
        hits.append(h); brs.append(b)
    return {"per_query": out, "mean_hit_rate": round(sum(hits)/len(hits),4) if hits else 0.0, "mean_breadth": round(sum(brs)/len(brs),4) if brs else 0.0}

def compute_currency(queries, results, engine):
    log.info(f"  Currency for {engine} ...")
    out = {}
    means = []
    bands = {"2025+":0,"2023-2024":0,"2020-2022":0,"pre-2020":0}
    total_w = 0; total_m = 0
    for qid in queries:
        r = results.get(qid)
        if not r: continue
        ys = []; miss = 0
        for p in top_k_papers(r):
            y = p.get("year")
            try:
                yi = int(y)
                if 1900 <= yi <= 2100: ys.append(yi)
                else: miss += 1
            except (TypeError, ValueError): miss += 1
        if ys:
            means.append(sum(ys)/len(ys))
            for y in ys:
                if y >= 2025: bands["2025+"] += 1
                elif y >= 2023: bands["2023-2024"] += 1
                elif y >= 2020: bands["2020-2022"] += 1
                else: bands["pre-2020"] += 1
            total_w += len(ys)
        total_m += miss
        out[qid] = {"mean_year": round(sum(ys)/len(ys),2) if ys else None, "with_year": len(ys), "missing_year": miss}
    return {"per_query": out,
            "overall_mean_year": round(sum(means)/len(means),2) if means else None,
            "bands": {b: round(c/total_w,4) if total_w else 0.0 for b,c in bands.items()},
            "bands_counts": bands, "total_with_year": total_w, "total_missing": total_m}

def compute_citation(queries, results, engine):
    log.info(f"  Citation for {engine} ...")
    out = {}
    means = []; n_with = 0; n_miss = 0
    for qid in queries:
        r = results.get(qid)
        if not r: continue
        logs = []; miss = 0
        for p in top_k_papers(r):
            c = p.get("citation_count")
            try:
                ci = int(c)
                if ci >= 0: logs.append(math.log(ci + 1))
                else: miss += 1
            except (TypeError, ValueError): miss += 1
        m = sum(logs)/len(logs) if logs else None
        out[qid] = {"mean_log_citation": round(m,4) if m is not None else None, "with_citation": len(logs), "missing": miss}
        if m is not None: means.append(m)
        n_with += len(logs); n_miss += miss
    return {"per_query": out,
            "overall_mean_log": round(sum(means)/len(means),4) if means else None,
            "total_with_citation": n_with, "total_missing": n_miss}

def normalize_section(name):
    if not name: return "(none)"
    s = str(name).strip().lower()
    if not s: return "(none)"
    if "abstract" in s: return "Abstract"
    if "introduction" in s: return "Introduction"
    if "conclu" in s: return "Conclusion"
    if "related work" in s: return "Related Work"
    if "literature" in s: return "Literature Review"
    if "discussion" in s: return "Discussion"
    if "result" in s: return "Results"
    if "method" in s or "approach" in s: return "Methods"
    if "background" in s: return "Background"
    return "Other Sections"

def compute_evidence_depth(asta_results):
    log.info("Metric 6/7 — Evidence Depth (Asta-only)")
    counter = Counter()
    for qid, r in asta_results.items():
        for p in top_k_papers(r):
            for s in (p.get("snippets") or []):
                if not isinstance(s, dict): continue
                counter[normalize_section(s.get("sectionTitle"))] += 1
    total = sum(counter.values())
    dist = {sec: round(c/total,4) for sec, c in counter.items()} if total else {}
    top3 = sorted(dist.items(), key=lambda x:-x[1])[:3]
    log.info(f"    {total} snippets, top: " + ", ".join(f"{s} {p:.1%}" for s,p in top3))
    return {"counts": dict(counter), "distribution": dist, "total_snippets": total}

def compute_calibration(queries, asta_results):
    log.info("Metric 7a/7 — Self-Confidence Calibration (Asta-only)")
    total = 0; on_topic = 0; skipped = 0
    per_q = {}
    for qid, q in queries.items():
        intent = intent_cluster_of_query(q)
        r = asta_results.get(qid)
        if not r: continue
        if intent == "other":
            skipped += 1; continue
        n3 = 0; n3_on = 0
        for p in top_k_papers(r):
            tier = p.get("relevance_tier")
            if not isinstance(tier, dict): continue
            if tier.get("relevance") != 3: continue
            n3 += 1
            cp = classify_paper_title(p.get("title",""))
            if cp == intent: n3_on += 1
        total += n3; on_topic += n3_on
        per_q[qid] = {"intent": intent, "n_perfectly_relevant": n3, "n_on_topic": n3_on}
    rate = on_topic/total if total else 0.0
    log.info(f"    'Perfectly Relevant' claims: {total}, on-topic: {on_topic} ({rate:.1%}), skipped: {skipped}")
    return {"calibration_rate": round(rate,4),
            "n_claims_perfectly_relevant": total,
            "n_claims_on_topic": on_topic,
            "skipped_queries_with_other_intent": skipped,
            "per_query": per_q}

def extract_concept_nouns(text, min_len=4, stopwords=STOPWORDS):
    if not text: return set()
    tokens = re.findall(r"[a-z][a-z\-]+", text.lower())
    return {t for t in tokens if len(t) >= min_len and t not in stopwords}

def compute_summary_coverage(asta_results):
    log.info("Metric 7b/7 — Summary Concept Coverage (Asta-only)")
    covs = []; skipped = 0
    for qid, r in asta_results.items():
        for p in top_k_papers(r):
            tier = p.get("relevance_tier")
            summary = tier.get("relevanceSummary") if isinstance(tier, dict) else None
            abstract = p.get("abstract")
            if not summary or not abstract: skipped += 1; continue
            s_nouns = extract_concept_nouns(summary)
            a_nouns = extract_concept_nouns(abstract)
            if not s_nouns: skipped += 1; continue
            covs.append(len(s_nouns & a_nouns) / len(s_nouns))
    mean_cov = sum(covs)/len(covs) if covs else 0.0
    log.info(f"    Papers scored: {len(covs)}, mean coverage: {mean_cov:.4f}")
    return {"mean_coverage": round(mean_cov,4), "n_scored": len(covs), "n_skipped": skipped, "values": covs}

# ── Aggregation ──
def build_summary(overlap, topical, currency, citation, evidence, calibration, summary_cov):
    a_hit = topical["asta"]["mean_hit_rate"]; g_hit = topical["google_scholar"]["mean_hit_rate"]
    a_br  = topical["asta"]["mean_breadth"];  g_br  = topical["google_scholar"]["mean_breadth"]
    a_c   = citation["asta"]["overall_mean_log"]; g_c = citation["google_scholar"]["overall_mean_log"]
    a_y   = currency["asta"]["overall_mean_year"]; g_y = currency["google_scholar"]["overall_mean_year"]
    def r(n, d):
        if n is None or d is None or d == 0: return None
        return round(n/d, 4)
    return {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "run_id": RUN_TS,
        "config": {"top_k": TOP_K, "overlap_threshold": OVERLAP_THRESHOLD, "currency_cutoff": CURRENCY_CUTOFF},
        "metric_1_overlap": {"mean_overlap_fraction": overlap["mean"],
                             "zero_overlap_queries": sum(1 for v in overlap["values"] if v==0),
                             "total_queries": len(overlap["values"])},
        "metric_2_topical_hit_rate": {"asta_raw": a_hit, "gs_raw": g_hit, "asta_normalized_GS1": r(a_hit, g_hit)},
        "metric_3_topical_breadth":  {"asta_raw": a_br, "gs_raw": g_br, "asta_normalized_GS1": r(a_br, g_br)},
        "metric_4_currency": {
            "asta_mean_year": a_y, "gs_mean_year": g_y,
            "lift_years_asta_minus_gs": round(a_y-g_y,2) if (a_y is not None and g_y is not None) else None,
            "asta_bands": currency["asta"]["bands"], "gs_bands": currency["google_scholar"]["bands"],
        },
        "metric_5_citation_influence": {"asta_mean_log": a_c, "gs_mean_log": g_c, "asta_normalized_GS1": r(a_c, g_c)},
        "metric_6_evidence_depth_asta_only": {"section_distribution": evidence["distribution"], "total_snippets": evidence["total_snippets"]},
        "metric_7a_calibration_asta_only": {
            "calibration_rate": calibration["calibration_rate"],
            "n_perfectly_relevant_claims": calibration["n_claims_perfectly_relevant"],
            "n_on_topic": calibration["n_claims_on_topic"],
            "skipped_queries": calibration["skipped_queries_with_other_intent"]},
        "metric_7b_summary_coverage_asta_only": {
            "mean_coverage": summary_cov["mean_coverage"],
            "n_scored": summary_cov["n_scored"], "n_skipped": summary_cov["n_skipped"]},
        "limitations": ("Strict hallucination check on Report mode (claim sampling vs cited papers) "
                        "and synthesis 1-10 rubric require Report-mode data not collected in this run; "
                        "deferred as future work."),
    }

def write_csv_long(overlap, topical, currency, citation, calibration, queries, path):
    rows = []
    for qid in queries:
        if qid in overlap["per_query"]:
            rows.append({"query_id": qid, "engine": "shared", "metric": "overlap_fraction",
                         "value": overlap["per_query"][qid]["overlap_fraction"]})
        for engine in ENGINES:
            t = topical[engine]["per_query"].get(qid)
            if t:
                rows.append({"query_id": qid, "engine": engine, "metric": "topical_hit_rate", "value": t["hit_rate"]})
                rows.append({"query_id": qid, "engine": engine, "metric": "topical_breadth",  "value": t["breadth"]})
            c = currency[engine]["per_query"].get(qid)
            if c and c.get("mean_year") is not None:
                rows.append({"query_id": qid, "engine": engine, "metric": "currency_mean_year", "value": c["mean_year"]})
            ci = citation[engine]["per_query"].get(qid)
            if ci and ci.get("mean_log_citation") is not None:
                rows.append({"query_id": qid, "engine": engine, "metric": "citation_mean_log", "value": ci["mean_log_citation"]})
        cal = calibration["per_query"].get(qid)
        if cal and cal["n_perfectly_relevant"] > 0:
            r = cal["n_on_topic"] / cal["n_perfectly_relevant"]
            rows.append({"query_id": qid, "engine": "asta", "metric": "calibration_rate", "value": round(r,4)})
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["query_id","engine","metric","value"])
        w.writeheader(); w.writerows(rows)
    return len(rows)

# ── Plots ──
def _color(e): return {"asta":"#1f77b4","google_scholar":"#ff7f0e"}.get(e,"#888")

def plot_overall_lift(summary, out_path):
    import matplotlib.pyplot as plt
    import numpy as np
    labels = ["Topical\nHit Rate","Topical\nBreadth","Citation\nInfluence"]
    vals = [summary["metric_2_topical_hit_rate"]["asta_normalized_GS1"] or 0,
            summary["metric_3_topical_breadth"]["asta_normalized_GS1"] or 0,
            summary["metric_5_citation_influence"]["asta_normalized_GS1"] or 0]
    fig, ax = plt.subplots(figsize=(7.5, 4.5))
    x = np.arange(len(labels))
    bars = ax.bar(x, vals, color="#1f77b4", edgecolor="black", linewidth=0.5)
    ax.axhline(1.0, color="#ff7f0e", linewidth=2, linestyle="--", label=f"{GS_LABEL} baseline (1.0)")
    ax.set_xticks(x); ax.set_xticklabels(labels)
    ax.set_ylabel("Asta value / GS value")
    ax.set_title("Asta normalized lift over Google Scholar (3 ratio metrics)")
    ymax = max(1.3, max(vals)*1.15 if vals else 1.3)
    ax.set_ylim(0, ymax)
    for bar, v in zip(bars, vals):
        ax.text(bar.get_x()+bar.get_width()/2, v+0.02, f"{v:.2f}", ha="center", fontsize=10)
    ax.legend(loc="upper right")
    plt.tight_layout(); plt.savefig(out_path, dpi=150); plt.close(fig)

def plot_currency_bands(summary, out_path):
    import matplotlib.pyplot as plt
    import numpy as np
    bands_order = ["2025+","2023-2024","2020-2022","pre-2020"]
    a = [summary["metric_4_currency"]["asta_bands"][b] for b in bands_order]
    g = [summary["metric_4_currency"]["gs_bands"][b]   for b in bands_order]
    x = np.arange(len(bands_order)); w = 0.4
    fig, ax = plt.subplots(figsize=(8, 4.5))
    ax.bar(x-w/2, a, w, label=ASTA_LABEL, color=_color("asta"))
    ax.bar(x+w/2, g, w, label=GS_LABEL, color=_color("google_scholar"))
    ax.set_xticks(x); ax.set_xticklabels(bands_order)
    ax.set_ylabel("Fraction of Top-10 papers"); ax.set_title("Publication-year distribution by engine")
    ax.legend(); plt.tight_layout(); plt.savefig(out_path, dpi=150); plt.close(fig)

def plot_overlap_distribution(overlap, out_path):
    import matplotlib.pyplot as plt
    import numpy as np
    fig, ax = plt.subplots(figsize=(7, 4.5))
    ax.hist(overlap["values"], bins=np.linspace(0,1,11), color="#5d6d7e", edgecolor="black", linewidth=0.5)
    ax.set_xlabel("Per-query overlap fraction (Asta Top-10 vs GS Top-10)")
    ax.set_ylabel("Number of queries"); ax.set_title("Distribution of Asta-GS Top-10 overlap across 50 queries")
    ax.axvline(overlap["mean"], color="#c0392b", linewidth=2, linestyle="--", label=f"Mean {overlap['mean']:.2f}")
    ax.legend(); plt.tight_layout(); plt.savefig(out_path, dpi=150); plt.close(fig)

def plot_topical_scatter(topical, out_path):
    import matplotlib.pyplot as plt
    pairs = []
    for qid, a in topical["asta"]["per_query"].items():
        g = topical["google_scholar"]["per_query"].get(qid)
        if g is None: continue
        pairs.append((g["hit_rate"], a["hit_rate"]))
    xs = [p[0] for p in pairs]; ys = [p[1] for p in pairs]
    fig, ax = plt.subplots(figsize=(6, 6))
    ax.scatter(xs, ys, alpha=0.65, s=55, color="#2c3e50")
    ax.plot([0,1],[0,1], color="#c0392b", linestyle="--", linewidth=1.5, label="Equal performance")
    ax.set_xlabel(f"{GS_LABEL} Topical Hit Rate"); ax.set_ylabel(f"{ASTA_LABEL} Topical Hit Rate")
    ax.set_xlim(-0.05,1.05); ax.set_ylim(-0.05,1.05); ax.set_aspect("equal")
    ax.set_title("Per-query Topical Hit Rate (above diagonal: Asta wins)")
    ax.legend(); plt.tight_layout(); plt.savefig(out_path, dpi=150); plt.close(fig)

def plot_evidence_sections(evidence, out_path):
    import matplotlib.pyplot as plt
    items = sorted(evidence["distribution"].items(), key=lambda x: x[1], reverse=True)
    labels = [k for k,_ in items]; vals = [v for _,v in items]
    fig, ax = plt.subplots(figsize=(8, 4.5))
    bars = ax.barh(labels[::-1], vals[::-1], color="#117a65", edgecolor="black", linewidth=0.4)
    for bar, v in zip(bars, vals[::-1]):
        ax.text(v+0.005, bar.get_y()+bar.get_height()/2, f"{v:.1%}", va="center", fontsize=9)
    ax.set_xlabel("Fraction of all Asta snippets (Top-10)")
    ax.set_title("Where Asta surfaces evidence — snippet section sources")
    ax.set_xlim(0, max(vals)*1.15 if vals else 1)
    plt.tight_layout(); plt.savefig(out_path, dpi=150); plt.close(fig)

def plot_calibration(summary, out_path):
    import matplotlib.pyplot as plt
    cal = summary["metric_7a_calibration_asta_only"]["calibration_rate"]
    cov = summary["metric_7b_summary_coverage_asta_only"]["mean_coverage"]
    fig, ax = plt.subplots(figsize=(6, 4.5))
    bars = ax.bar(["Self-Confidence\nCalibration (7a)","Summary Concept\nCoverage (7b)"],
                  [cal, cov], color=["#8e44ad","#16a085"], edgecolor="black", linewidth=0.5)
    for bar, v in zip(bars, [cal, cov]):
        ax.text(bar.get_x()+bar.get_width()/2, v+0.02, f"{v:.2f}", ha="center", fontsize=11)
    ax.set_ylim(0, 1.05); ax.set_ylabel("Fraction (0-1)"); ax.set_title("Asta-only quality diagnostics")
    ax.axhline(1.0, color="grey", linestyle=":", linewidth=1)
    plt.tight_layout(); plt.savefig(out_path, dpi=150); plt.close(fig)

# ── Run summary + main ──
def write_run_summary(s, elapsed):
    log.info("="*62); log.info("RUN SUMMARY — step4_score (v2)"); log.info("="*62)
    log.info(f"  Run ID            : {RUN_TS}")
    log.info(f"  Top-K             : {TOP_K}")
    log.info(f"  Overlap threshold : {OVERLAP_THRESHOLD}")
    m1 = s["metric_1_overlap"]
    log.info(f"  [1] Mean Overlap        : {m1['mean_overlap_fraction']}  (zero-overlap: {m1['zero_overlap_queries']}/{m1['total_queries']})")
    m2 = s["metric_2_topical_hit_rate"]
    log.info(f"  [2] Topical Hit Rate    : Asta {m2['asta_raw']:.4f}  GS {m2['gs_raw']:.4f}  -> Asta/GS = {m2['asta_normalized_GS1']}")
    m3 = s["metric_3_topical_breadth"]
    log.info(f"  [3] Topical Breadth     : Asta {m3['asta_raw']:.2f}/8  GS {m3['gs_raw']:.2f}/8  -> Asta/GS = {m3['asta_normalized_GS1']}")
    m4 = s["metric_4_currency"]
    log.info(f"  [4] Currency mean year  : Asta {m4['asta_mean_year']}  GS {m4['gs_mean_year']}  -> lift = {m4['lift_years_asta_minus_gs']} years")
    m5 = s["metric_5_citation_influence"]
    log.info(f"  [5] Citation mean log   : Asta {m5['asta_mean_log']}  GS {m5['gs_mean_log']}  -> Asta/GS = {m5['asta_normalized_GS1']}")
    m6 = s["metric_6_evidence_depth_asta_only"]
    top3 = sorted(m6['section_distribution'].items(), key=lambda x:-x[1])[:3]
    log.info(f"  [6] Evidence            : {m6['total_snippets']} snippets, top: " + ", ".join(f"{k} {v:.0%}" for k,v in top3))
    m7a = s["metric_7a_calibration_asta_only"]
    log.info(f"  [7a] Calibration        : {m7a['calibration_rate']:.4f}  ({m7a['n_on_topic']}/{m7a['n_perfectly_relevant_claims']})")
    m7b = s["metric_7b_summary_coverage_asta_only"]
    log.info(f"  [7b] Summary Coverage   : {m7b['mean_coverage']:.4f}  (n={m7b['n_scored']})")
    log.info(f"  Elapsed                 : {elapsed:.1f}s")
    log.info(f"  Outputs (scores)        : {SCORES_DIR}")
    log.info(f"  Outputs (results)       : {RESULTS_DIR}")
    log.info(f"  Log                     : {log_path}")
    log.info("="*62)

def main():
    t0 = time.time()
    log.info("="*62); log.info("STEP 4 — Q1 evaluation (v2)"); log.info(f"Run ID: {RUN_TS}"); log.info("="*62)
    for d in (SCORES_DIR, RESULTS_DIR, FIGURES_DIR): os.makedirs(d, exist_ok=True)
    queries = load_queries()
    asta_results = load_engine_results("asta")
    gs_results   = load_engine_results("google_scholar")
    log.info(f"queries={len(queries)}, asta={len(asta_results)}, gs={len(gs_results)}")

    overlap = compute_overlap(queries, asta_results, gs_results)
    with open(os.path.join(SCORES_DIR, "overlap.json"), "w", encoding="utf-8") as f: json.dump(overlap, f, indent=2, ensure_ascii=False)

    log.info("Metric 2&3/7 — Topical Hit Rate + Breadth")
    topical = {e: compute_topical(queries, (asta_results if e=="asta" else gs_results), e) for e in ENGINES}
    with open(os.path.join(SCORES_DIR, "topical.json"), "w", encoding="utf-8") as f: json.dump(topical, f, indent=2, ensure_ascii=False)

    log.info("Metric 4/7 — Currency")
    currency = {e: compute_currency(queries, (asta_results if e=="asta" else gs_results), e) for e in ENGINES}
    with open(os.path.join(SCORES_DIR, "currency.json"), "w", encoding="utf-8") as f: json.dump(currency, f, indent=2, ensure_ascii=False)

    log.info("Metric 5/7 — Citation Influence")
    citation = {e: compute_citation(queries, (asta_results if e=="asta" else gs_results), e) for e in ENGINES}
    with open(os.path.join(SCORES_DIR, "citation.json"), "w", encoding="utf-8") as f: json.dump(citation, f, indent=2, ensure_ascii=False)

    evidence = compute_evidence_depth(asta_results)
    with open(os.path.join(SCORES_DIR, "evidence_depth.json"), "w", encoding="utf-8") as f: json.dump(evidence, f, indent=2, ensure_ascii=False)

    calibration = compute_calibration(queries, asta_results)
    with open(os.path.join(SCORES_DIR, "calibration.json"), "w", encoding="utf-8") as f: json.dump(calibration, f, indent=2, ensure_ascii=False)

    summary_cov = compute_summary_coverage(asta_results)
    with open(os.path.join(SCORES_DIR, "summary_coverage.json"), "w", encoding="utf-8") as f: json.dump(summary_cov, f, indent=2, ensure_ascii=False)

    summary = build_summary(overlap, topical, currency, citation, evidence, calibration, summary_cov)
    with open(os.path.join(RESULTS_DIR, "summary.json"), "w", encoding="utf-8") as f: json.dump(summary, f, indent=2, ensure_ascii=False)

    n_rows = write_csv_long(overlap, topical, currency, citation, calibration, queries,
                            os.path.join(RESULTS_DIR, "final_scores.csv"))
    log.info(f"final_scores.csv: {n_rows} rows")

    log.info("Generating figures ...")
    plot_overall_lift(summary,         os.path.join(FIGURES_DIR, "overall_lift_bar.png"))
    plot_currency_bands(summary,       os.path.join(FIGURES_DIR, "currency_bands.png"))
    plot_overlap_distribution(overlap, os.path.join(FIGURES_DIR, "overlap_distribution.png"))
    plot_topical_scatter(topical,      os.path.join(FIGURES_DIR, "topical_scatter.png"))
    plot_evidence_sections(evidence,   os.path.join(FIGURES_DIR, "evidence_sections.png"))
    plot_calibration(summary,          os.path.join(FIGURES_DIR, "calibration_results.png"))
    log.info("6 figures saved")

    write_run_summary(summary, elapsed=time.time()-t0)

if __name__ == "__main__":
    main()
