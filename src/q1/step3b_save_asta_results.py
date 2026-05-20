"""
step3b_save_asta_results.py
────────────────────────────────────────────────────────────────────────────
Reads asta_raw.json (downloaded from browser) and saves results into the
structured data/q1/asta folder with full logging and validation.

How to use:
  1. Run step3a_asta_collect.js in browser — asta_raw.json auto-downloads
  2. Move asta_raw.json to:
       <BASE_DIR>/data/q1/asta/asta_raw.json
  3. Run this script:
       python step3b_save_asta_results.py

Saved outputs:
  data/q1/asta/asta_P01A.json  ...  asta_P25B.json   (50 individual files)
  data/q1/asta/asta_all.json                         (combined)
  logs/step3_YYYYMMDD_HHMMSS.log                     (run log)
"""

import json
import logging
import os
import time

# ── Paths ─────────────────────────────────────────────────────────────────────
# BASE_DIR is auto-derived from this script's location so the same code works
# on Windows and on the Cowork Linux mount, no edits needed.
# Layout assumption: <BASE_DIR>/src/q1/step3b_save_asta_results.py
BASE_DIR   = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR   = os.path.join(BASE_DIR, "data", "q1")
LOG_DIR    = os.path.join(BASE_DIR, "logs")
OUTPUT_DIR = os.path.join(DATA_DIR, "asta")
RAW_PATH   = os.path.join(OUTPUT_DIR, "asta_raw.json")
OUTPUT_ALL = os.path.join(OUTPUT_DIR, "asta_all.json")

RUN_TS = time.strftime("%Y%m%d_%H%M%S")

# ── Logging setup ─────────────────────────────────────────────────────────────
os.makedirs(LOG_DIR, exist_ok=True)
log_path = os.path.join(LOG_DIR, f"step3_{RUN_TS}.log")

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


# ── Validation ────────────────────────────────────────────────────────────────
def validate_result(result):
    """Check a single result dict for required fields. Returns warning list."""
    warnings = []
    for field in ["query_id", "query", "query_type", "engine", "papers"]:
        if field not in result:
            warnings.append(f"Missing required field: '{field}'")
    if "papers" in result:
        if not isinstance(result["papers"], list):
            warnings.append("'papers' is not a list")
        elif len(result["papers"]) == 0:
            warnings.append("Empty paper list (0 results returned)")
    return warnings


def log_result_summary(result):
    """Log a one-line diagnostic summary for a single result."""
    papers = result.get("papers", [])
    years  = [p["year"] for p in papers if p.get("year")]
    recent = sum(1 for y in years if y >= 2023)
    yr_rng = f"{min(years)}-{max(years)}" if years else "?"
    log.info(
        f"  {result['query_id']} [{result.get('query_type','?'):8s}] "
        f"-> {len(papers)} papers | {recent} from 2023+ | years: {yr_rng}"
    )


def write_run_summary(results, saved, warnings, elapsed):
    """Write structured run statistics to the log at completion."""
    all_papers   = [p for r in results for p in r.get("papers", [])]
    years        = [p["year"] for p in all_papers if p.get("year")]
    recent_count = sum(1 for y in years if y >= 2023)
    yr_dist      = {}
    for y in years:
        yr_dist[y] = yr_dist.get(y, 0) + 1

    log.info("=" * 55)
    log.info("RUN SUMMARY — step3b_save_asta_results")
    log.info("=" * 55)
    log.info(f"  Results loaded   : {len(results)}")
    log.info(f"  Files saved      : {saved}")
    log.info(f"  Validation warns : {warnings}")
    log.info(f"  Total papers     : {len(all_papers)}")
    log.info(f"  Papers from 2023+: {recent_count} / {len(all_papers)}")
    if results:
        log.info(f"  Avg papers/query : {len(all_papers)/len(results):.1f}")
    log.info(f"  Year distribution:")
    for yr in sorted(yr_dist.keys(), reverse=True)[:6]:
        log.info(f"    {yr}: {yr_dist[yr]} papers")
    log.info(f"  Elapsed          : {elapsed:.1f}s")
    log.info(f"  Individual files : {OUTPUT_DIR}")
    log.info(f"  Combined file    : {OUTPUT_ALL}")
    log.info(f"  Log file         : {log_path}")
    log.info("=" * 55)


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    t_start = time.time()

    log.info("=" * 55)
    log.info("STEP 3b — Save Asta results from browser JSON to disk")
    log.info(f"Run ID  : {RUN_TS}")
    log.info(f"Source  : {RAW_PATH}")
    log.info("=" * 55)

    if not os.path.exists(RAW_PATH):
        log.error(f"asta_raw.json not found at: {RAW_PATH}")
        log.error("Run step3a_asta_collect.js in browser first, then move")
        log.error("the downloaded asta_raw.json to the path above.")
        return

    with open(RAW_PATH, encoding="utf-8") as f:
        raw_data = json.load(f)

    if isinstance(raw_data, list):
        results = raw_data
    elif isinstance(raw_data, dict) and "results" in raw_data:
        results = raw_data["results"]
    else:
        log.error("Unexpected JSON structure — expected list or {results: [...]}")
        return

    log.info(f"Loaded {len(results)} results from asta_raw.json")
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    saved_count   = 0
    warning_count = 0

    for result in results:
        qid = result.get("query_id", "UNKNOWN")

        warnings = validate_result(result)
        for w in warnings:
            log.warning(f"  {qid}: {w}")
        warning_count += len(warnings)

        result["saved_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        out_path = os.path.join(OUTPUT_DIR, f"asta_{qid}.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)

        log_result_summary(result)
        saved_count += 1

    combined = {
        "meta": {
            "generated_at":  time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "run_id":        RUN_TS,
            "script":        "step3b_save_asta_results.py",
            "engine":        "asta",
            "total_results": len(results),
            "saved":         saved_count,
            "warnings":      warning_count,
        },
        "results": results,
    }
    with open(OUTPUT_ALL, "w", encoding="utf-8") as f:
        json.dump(combined, f, indent=2, ensure_ascii=False)

    log.info(f"Combined file saved -> {OUTPUT_ALL}")
    write_run_summary(results, saved_count, warning_count,
                      elapsed=time.time() - t_start)


if __name__ == "__main__":
    main()
