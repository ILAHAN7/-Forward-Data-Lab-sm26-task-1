# Forward Data Lab — Asta Evaluation, Workflow Analysis, and Cluster Mind Map

Undergraduate research application for the UIUC Forward Data Lab. The project covers three deliverables built around **Asta Paper Finder** (Allen Institute for AI):

- **Q1** — an empirical comparison of Asta vs Google Scholar on a 50-query FinTech suite
- **Q2** — a component-level analysis of the Asta Paper Finder workflow
- **Q3** — a Chrome extension that adds a cluster-aware mind map to Asta's result view

---

## Final deliverables

| File | Description |
|---|---|
| `reports/report-KevinKim.docx` (.pdf) | Full report — Q1, Q2, and Q3 (13 pages) |
| `reports/report-KevinKim(Summary ver).docx` (.pdf) | Condensed summary version (3 pages) |
| `src/q3/extension/` | Q3 Chrome extension source (loadable unpacked) |

---

## Repository layout

```
LAB/
├── README.md
├── .gitignore
├── src/
│   ├── q1/                         Q1 evaluation pipeline (Python + one browser script)
│   │   ├── step1_generate_queries.py
│   │   ├── step2_collect_google_scholar.py
│   │   ├── step3a_asta_collect.js
│   │   ├── step3b_save_asta_results.py
│   │   └── step4_score.py
│   └── q3/
│       ├── extension/              Q3 Chrome MV3 extension
│       │   ├── manifest.json
│       │   ├── background.js       service worker (popup window + capture store)
│       │   ├── inject.js           MAIN-world fetch/XHR hook (captures Asta payload)
│       │   ├── content_script.js   page <-> background bridge
│       │   ├── popup.html/js/css   mind map popup window
│       │   └── lib/
│       │       ├── parse.js        Asta JSON -> uniform paper objects
│       │       ├── nlp.js          tokenize / POS filter / lemmatise / stopwords
│       │       ├── thesaurus.js    academic-domain synonym normalisation
│       │       ├── cluster.js      TF-IDF + k-means (k-means++ init)
│       │       ├── label.js        c-TF-IDF cluster labels (min-presence floor)
│       │       └── visualize.js    SVG radial mind map renderer
│       └── test/test.html          offline pipeline sanity-check page
├── data/
│   ├── q1/                         queries, results, scores (raw asta/ dump gitignored)
│   └── q2/                         black-box probing diagnostic queries
├── reports/                        final report deliverables (docx + pdf)
└── logs/                           run logs for the Q1 scripts
```

Two paths are intentionally excluded from version control (see `.gitignore`):
`data/q1/asta/` (~59 MB of raw Asta API responses, regenerable via the scripts) and
`docs/references/` (copyrighted reference PDFs; arXiv links are listed under References below).

---

## Q1 — Asta vs Google Scholar: empirical comparison

A controlled 50-query FinTech suite (25 curated papers x 2 query phrasings, each carrying
ground-truth metadata) compares the two engines on their Top-10 results per query. Asta is
measured along **seven directly inspectable metrics**: five comparable across both engines
and two Asta-only structural diagnostics.

| # | Metric | Definition |
|---|---|---|
| 1 | Overlap | Fraction of Top-10 papers both engines return (title fuzzy match >= 0.85) |
| 2 | Topical Hit Rate | Fraction of Top-10 titles in the query's intended FinTech sub-area |
| 3 | Topical Breadth | Number of distinct FinTech sub-areas covered in the Top-10 |
| 4 | Currency | Mean publication year + distribution across four year bands |
| 5 | Citation Influence | Mean log(citation_count + 1) across the Top-10 |
| 6 | Evidence Depth (Asta-only) | Section-source distribution of Asta's surfaced snippets |
| 7 | Calibration / Summary Coverage (Asta-only) | Two diagnostics on Asta's LLM-generated layer |

### Q1 scripts

| Script | Purpose | Inputs | Outputs |
|---|---|---|---|
| `step1_generate_queries.py` | Generate 50 queries from 25 curated FinTech papers with embedded ground truth | (built-in paper list) | `data/q1/queries.json` |
| `step2_collect_google_scholar.py` | Fetch Google Scholar Top-10 per query via SerpAPI | `queries.json` | `data/q1/google_scholar/` |
| `step3a_asta_collect.js` | Browser-console script: runs all 50 queries on asta.allen.ai, downloads raw results | (browser session) | `asta_raw.json` |
| `step3b_save_asta_results.py` | Split the raw Asta collection into per-query files | `asta_raw.json` | `data/q1/asta/` |
| `step4_score.py` | Compute the seven metrics and render figures | `queries.json`, `asta/`, `google_scholar/` | `data/q1/results/`, `data/q1/scores/` |

`step2` reads its SerpAPI key from the `SERPAPI_KEY` environment variable (no key is stored
in the repository). Set it before running:

```bash
export SERPAPI_KEY=your_key_here     # Linux / macOS
set SERPAPI_KEY=your_key_here        # Windows
```

---

## Q2 — Asta Paper Finder workflow analysis

A documentation- and code-based analysis of the Asta Paper Finder pipeline, mapping each
component to its closest academic reference and identifying the key architectural
difference. The pipeline flow is Query Analyser, Execution Planner, semantic sub-workflow
(retrieval, citation expansion, relevance judgment), and Final Ranker, with a separate
Generate Report mode. The component-level findings are corroborated against the Q1
50-query evidence. Q2 is a written analysis; the diagnostic query variants used for
black-box probing are under `data/q2/`.

---

## Q3 — Cluster-Aware Visualization of Asta Paper Finder Results

A Chrome MV3 extension that augments Asta's result-presentation stage. It captures the
paper payload Asta already produces and renders it as a topical cluster mind map in a
separate popup window, without modifying Asta's internal pipeline.

**Pipeline.** The extension hooks Asta's network responses, recovers the rich result
payload (`mabool-demo.allen.ai/api/2/rounds/{rid}/result/widget`), extracts noun and
adjective concepts via TF-IDF (with title up-weighting, query-term removal, and
universal-term filtering), clusters them with k-means using a deterministic k-means++
initialisation, and labels each cluster by c-TF-IDF with a minimum-presence floor.
Results render as a radial SVG mind map: query at the centre, clusters in a ring around
it, papers in citation-weighted halos, with zoom/pan, in-cluster sort and search, and a
per-paper detail panel.

### Installing the extension

1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select `src/q3/extension/`.
4. Open `https://asta.allen.ai/chat`, run a Find Papers query, then click the extension
   icon to open the cluster mind map.

`src/q3/test/test.html` runs the clustering pipeline offline against cached fixtures for
debugging without a live Asta session.

---

## Reproducing the Q1 evaluation

```bash
cd src/q1

# Step 1 — generate the 50-query suite
python step1_generate_queries.py

# Step 2 — collect Google Scholar results (requires SERPAPI_KEY)
python step2_collect_google_scholar.py

# Step 3a — collect Asta results (browser console)
#   Log in to asta.allen.ai, open DevTools console, paste step3a_asta_collect.js,
#   then move the downloaded asta_raw.json into data/q1/asta/

# Step 3b — split the raw Asta collection
python step3b_save_asta_results.py

# Step 4 — score the seven metrics and render figures
python step4_score.py
```

Each run writes a timestamped log to `logs/`.

---

## Dependencies

- Python 3.10+ (steps 1–3b use the standard library only)
- Step 4: `scikit-learn`, `sentence-transformers`, `matplotlib`, `numpy`, `pandas`
- The Q3 extension is plain JavaScript and needs no build step or external services.

```bash
pip install scikit-learn sentence-transformers matplotlib numpy pandas
```

---

## References

| # | Reference | arXiv / link |
|---|---|---|
| [1] | Cohan et al. (2020), SPECTER | https://arxiv.org/abs/2004.07180 |
| [2] | Bragg et al. (2026), AstaBench | https://arxiv.org/abs/2510.21652 |
| [3] | Lewis et al. (2020), Retrieval-Augmented Generation | https://arxiv.org/abs/2005.11401 |
| [4] | Cook et al. (2025), RAG for FinTech | https://arxiv.org/abs/2510.25518 |
| [5] | Gao et al. (2023), HyDE | https://arxiv.org/abs/2212.10496 |
| [6] | Zheng et al. (2023), LLM-as-a-Judge | https://arxiv.org/abs/2306.05685 |
| [7] | Sun et al. (2023), RankGPT | https://arxiv.org/abs/2304.09542 |
| [8] | Yang et al. (2025), Rank-K | https://arxiv.org/abs/2505.14432 |
| [9] | Gao et al. (2023), ALCE | https://arxiv.org/abs/2305.14627 |
| [10] | Asai et al. (2024), Self-RAG | https://arxiv.org/abs/2310.11511 |
