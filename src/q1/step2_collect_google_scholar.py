"""
step2_collect_google_scholar.py
────────────────────────────────────────────────────────────────────────────
Collect Google Scholar top-10 results for all 50 queries via SerpAPI.

For each query:
  - Calls SerpAPI Google Scholar endpoint
  - Extracts: title, link, snippet, authors, year, citation count
  - Retries once on transient errors (429, 5xx)
  - Skips queries already collected (resume support)

Saved outputs:
  data/q1/google_scholar/gs_{query_id}.json      one file per query (50 total)
  data/q1/google_scholar/google_scholar_all.json combined results
  logs/step2_YYYYMMDD_HHMMSS.log                 full run log

Usage:
  cd <repo_root>/src/q1
  python step2_collect_google_scholar.py
"""

import json
import logging
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

# ── Paths ─────────────────────────────────────────────────────────────────────
# BASE_DIR is auto-derived from this script's location so the same code works
# on Windows and Linux without edits.
# Layout assumption: <BASE_DIR>/src/q1/step2_collect_google_scholar.py
BASE_DIR       = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR       = os.path.join(BASE_DIR, "data", "q1")
LOG_DIR        = os.path.join(BASE_DIR, "logs")
QUERIES_PATH   = os.path.join(DATA_DIR, "queries.json")
OUTPUT_DIR     = os.path.join(DATA_DIR, "google_scholar")
OUTPUT_ALL     = os.path.join(OUTPUT_DIR, "google_scholar_all.json")

# ── SerpAPI config ────────────────────────────────────────────────────────────
# The SerpAPI key is read from the SERPAPI_KEY environment variable so no
# secret is committed to version control. Set it before running, e.g.:
#   Windows : set SERPAPI_KEY=your_key_here
#   Linux   : export SERPAPI_KEY=your_key_here
SERPAPI_KEY       = os.environ.get("SERPAPI_KEY", "")
SERPAPI_ENDPOINT  = "https://serpapi.com/search"
RESULTS_PER_QUERY = 10
REQUEST_DELAY     = 2.0    # seconds between successful requests
RETRY_DELAY       = 5.0    # seconds before retrying after error
MAX_RETRIES       = 1      # number of retries per query

RUN_TS = time.strftime("%Y%m%d_%H%M%S")

# ── Logging setup ─────────────────────────────────────────────────────────────
os.makedirs(LOG_DIR, exist_ok=True)
log_path = os.path.join(LOG_DIR, f"step2_{RUN_TS}.log")

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


# ── Helpers ───────────────────────────────────────────────────────────────────
def extract_year(pub_summary: str) -> int | None:
    """
    Parse a 4-digit publication year from a Google Scholar summary string.
    Example: 'J Smith - Journal of Finance, 2023'  ->  2023
    """
    if not pub_summary:
        return None
    match = re.search(r"\b(199\d|200\d|201\d|202\d)\b", pub_summary)
    return int(match.group(1)) if match else None


def fetch_scholar(query: str, num: int = 10) -> dict:
    """
    Call SerpAPI Google Scholar endpoint.
    Returns the raw parsed JSON dict.
    Raises urllib.error.HTTPError on non-200 responses.
    """
    params = {
        "engine":  "google_scholar",
        "q":       query,
        "num":     num,
        "api_key": SERPAPI_KEY,
    }
    url = SERPAPI_ENDPOINT + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_with_retry(query: str, query_id: str, num: int = 10) -> dict | None:
    """
    Wrap fetch_scholar with one retry on transient errors.
    Returns the raw JSON dict, or None if all attempts fail.
    """
    for attempt in range(1, MAX_RETRIES + 2):   # +2 → original + retries
        try:
            return fetch_scholar(query, num)
        except urllib.error.HTTPError as e:
            log.warning(
                f"  {query_id} attempt {attempt} — HTTP {e.code}: {e.reason}"
            )
            if attempt <= MAX_RETRIES and e.code in (429, 500, 502, 503):
                log.info(f"  Retrying in {RETRY_DELAY}s ...")
                time.sleep(RETRY_DELAY)
            else:
                log.error(f"  {query_id} — giving up after {attempt} attempt(s).")
                return None
        except Exception as e:
            log.error(f"  {query_id} attempt {attempt} — unexpected error: {e}")
            return None
    return None


def normalise(raw: dict, query_id: str, query: str,
              query_type: str, ground_truth: dict) -> dict:
    """
    Extract top-10 organic results from a SerpAPI response into a clean,
    consistent schema. Adds parsed 'year' field and preserves ground truth
    metadata for downstream Precision scoring.
    """
    organic = raw.get("organic_results", [])[:RESULTS_PER_QUERY]

    papers = []
    for rank, item in enumerate(organic, start=1):
        pub_info = item.get("publication_info", {}).get("summary", "")
        year     = extract_year(pub_info)

        # Citation count: organic_results[n].inline_links.cited_by.total
        cited_by = (
            item.get("inline_links", {})
                .get("cited_by", {})
                .get("total", None)
        )

        papers.append({
            "rank":             rank,
            "title":            item.get("title", ""),
            "link":             item.get("link", ""),
            "snippet":          item.get("snippet", ""),
            "publication_info": pub_info,
            "year":             year,
            "citation_count":   cited_by,
        })

    return {
        "query_id":     query_id,
        "query":        query,
        "query_type":   query_type,
        "engine":       "google_scholar",
        "fetched_at":   time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "result_count": len(papers),
        "ground_truth": ground_truth,   # preserved for Precision scoring in Step 4
        "papers":       papers,
    }


def log_result_summary(result: dict) -> None:
    """Log a one-line diagnostic summary for each collected query result."""
    papers  = result["papers"]
    years   = [p["year"] for p in papers if p["year"]]
    recent  = sum(1 for y in years if y >= 2023)
    yr_min  = min(years) if years else "?"
    yr_max  = max(years) if years else "?"
    log.info(
        f"  -> {result['result_count']} results | "
        f"{recent}/10 from 2023+ | "
        f"year range: {yr_min}-{yr_max}"
    )


def write_run_summary(all_results: list, success: int, errors: int,
                      skipped: int, elapsed: float) -> None:
    """Write structured run statistics to the log at completion."""
    all_papers   = [p for r in all_results for p in r["papers"]]
    years        = [p["year"] for p in all_papers if p["year"]]
    recent_count = sum(1 for y in years if y >= 2023)
    credits_used = success   # SerpAPI charges 1 credit per successful search

    log.info("=" * 55)
    log.info("RUN SUMMARY — step2_collect_google_scholar")
    log.info("=" * 55)
    log.info(f"  Queries total    : {success + errors + skipped}")
    log.info(f"  Success          : {success}")
    log.info(f"  Skipped (cached) : {skipped}")
    log.info(f"  Errors           : {errors}")
    log.info(f"  Papers collected : {len(all_papers)}")
    log.info(f"  Papers from 2023+: {recent_count} / {len(all_papers)}")
    log.info(f"  SerpAPI credits  : ~{credits_used} used")
    log.info(f"  Elapsed          : {elapsed:.1f}s")
    log.info(f"  Individual files : {OUTPUT_DIR}")
    log.info(f"  Combined file    : {OUTPUT_ALL}")
    log.info(f"  Log file         : {log_path}")
    log.info("=" * 55)


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    t_start = time.time()

    if not SERPAPI_KEY:
        log.error("SERPAPI_KEY environment variable is not set. "
                  "Set it before running (see the SerpAPI config block).")
        return

    log.info("=" * 55)
    log.info("STEP 2 — Collect Google Scholar results via SerpAPI")
    log.info(f"Run ID            : {RUN_TS}")
    log.info(f"SerpAPI endpoint  : {SERPAPI_ENDPOINT}")
    log.info(f"Results per query : {RESULTS_PER_QUERY}")
    log.info(f"Request delay     : {REQUEST_DELAY}s")
    log.info(f"Output directory  : {OUTPUT_DIR}")
    log.info("=" * 55)

    # Load queries from Step 1
    if not os.path.exists(QUERIES_PATH):
        log.error(f"queries.json not found at: {QUERIES_PATH}")
        log.error("Run step1_generate_queries.py first.")
        return

    with open(QUERIES_PATH, encoding="utf-8") as f:
        query_data = json.load(f)

    queries = query_data["queries"]
    log.info(f"Queries loaded: {len(queries)} from {QUERIES_PATH}")
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    all_results   = []
    success_count = 0
    error_count   = 0
    skip_count    = 0

    for i, q in enumerate(queries, start=1):
        qid        = q["query_id"]
        query_text = q["query"]
        qtype      = q["query_type"]
        gt         = q.get("ground_truth", {})
        out_path   = os.path.join(OUTPUT_DIR, f"gs_{qid}.json")

        log.info(f"[{i:02d}/50] {qid} [{qtype:8s}] {query_text[:55]} ...")

        # Resume support: reload cached result if already collected
        if os.path.exists(out_path):
            log.info(f"  -> already collected, loading from cache.")
            with open(out_path, encoding="utf-8") as f:
                result = json.load(f)
            all_results.append(result)
            skip_count += 1
            continue

        # Fetch from SerpAPI
        raw = fetch_with_retry(query_text, qid, num=RESULTS_PER_QUERY)

        if raw is None:
            error_count += 1
            continue

        # Normalise and save
        result = normalise(raw, qid, query_text, qtype, gt)

        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)

        log_result_summary(result)
        all_results.append(result)
        success_count += 1

        time.sleep(REQUEST_DELAY)

    # Save combined file
    combined = {
        "meta": {
            "generated_at":  time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "run_id":        RUN_TS,
            "script":        "step2_collect_google_scholar.py",
            "engine":        "google_scholar",
            "total_queries": len(all_results),
            "success":       success_count,
            "skipped":       skip_count,
            "errors":        error_count,
        },
        "results": all_results,
    }

    with open(OUTPUT_ALL, "w", encoding="utf-8") as f:
        json.dump(combined, f, indent=2, ensure_ascii=False)

    log.info(f"Combined file saved -> {OUTPUT_ALL}")

    # Final run summary
    write_run_summary(
        all_results, success_count, error_count,
        skip_count, elapsed=time.time() - t_start
    )


if __name__ == "__main__":
    main()
