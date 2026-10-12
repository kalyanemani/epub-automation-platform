"""
Submit both issue EPUBs for autofix, then run RAGAS evaluation.
Usage: python run_eval.py
"""
import json, time, sys, pathlib, requests

BASE_NODE = "http://localhost:9000"
BASE_PY   = "http://localhost:8001"

VAL_J1 = "345f4257f0f6276de63ebdc85880cafe"   # pg20203
VAL_J2 = "86e7da6dfd7b53f829fb118829dfc671"   # pg76178

EPUB1 = r"C:\Users\krishkal\Downloads\pg20203-images-3-issues.epub"
EPUB2 = r"C:\Users\krishkal\Downloads\pg76178-images-3-issues.epub"

# ── Step 1: Pull validation results ──────────────────────────────────────────
def get_val(job_id):
    r = requests.get(f"{BASE_NODE}/validate-status/{job_id}", timeout=15)
    r.raise_for_status()
    return r.json()

print("Fetching validation results…")
v1 = get_val(VAL_J1)
v2 = get_val(VAL_J2)

def extract_issues(val_result):
    results = val_result.get("result", {}).get("results", [])
    return [r for r in results if r.get("status") in ("fail", "warn")]

issues1 = extract_issues(v1)
issues2 = extract_issues(v2)
print(f"pg20203 issues to fix: {len(issues1)}")
print(f"pg76178 issues to fix: {len(issues2)}")

# ── Step 2: Submit autofix jobs ───────────────────────────────────────────────
def submit_autofix(epub_path, issues):
    with open(epub_path, "rb") as f:
        resp = requests.post(
            f"{BASE_PY}/agent-autofix",
            files={"file": (pathlib.Path(epub_path).name, f, "application/epub+zip")},
            data={"issues": json.dumps(issues)},
            timeout=60,
        )
    resp.raise_for_status()
    return resp.json()["jobId"]

print("\nSubmitting autofix jobs…")
af_j1 = submit_autofix(EPUB1, issues1)
af_j2 = submit_autofix(EPUB2, issues2)
print(f"pg20203 autofix jobId: {af_j1}")
print(f"pg76178 autofix jobId: {af_j2}")

# Write job IDs for monitoring
pathlib.Path("autofix_jobs.json").write_text(
    json.dumps({"pg20203": af_j1, "pg76178": af_j2}, indent=2)
)

# ── Step 3: Poll until both done ─────────────────────────────────────────────
def poll_autofix(job_id):
    r = requests.get(f"{BASE_PY}/agent-autofix-status/{job_id}", timeout=15)
    r.raise_for_status()
    return r.json()

print("\nPolling autofix status (check autofix_jobs.json for job IDs)…")
start = time.time()
done = set()
while len(done) < 2:
    time.sleep(30)
    elapsed = int(time.time() - start)
    for jid, label in [(af_j1, "pg20203"), (af_j2, "pg76178")]:
        if jid in done:
            continue
        s = poll_autofix(jid)
        status = s.get("status", "?")
        stage  = s.get("stage", "?")
        print(f"  [{elapsed}s] {label} {jid[:8]} -> {status}/{stage}")
        if status in ("done", "error"):
            done.add(jid)

print("\nBoth autofix jobs complete. Fetching results…")
af_r1 = poll_autofix(af_j1)
af_r2 = poll_autofix(af_j2)

pathlib.Path("autofix_result_pg20203.json").write_text(json.dumps(af_r1, indent=2))
pathlib.Path("autofix_result_pg76178.json").write_text(json.dumps(af_r2, indent=2))
print("Results saved to autofix_result_pg20203.json and autofix_result_pg76178.json")

# ── Step 4: RAGAS evaluation ──────────────────────────────────────────────────
def run_ragas(job_result, run_id):
    payload = {"job_result": job_result.get("result", {}), "run_id": run_id}
    r = requests.post(f"{BASE_PY}/evaluate/job", json=payload, timeout=300)
    r.raise_for_status()
    return r.json()

print("\nRunning RAGAS evaluation…")
try:
    ragas1 = run_ragas(af_r1, af_j1)
    print(f"pg20203 RAGAS score: {ragas1.get('ragas_score')}")
except Exception as e:
    print(f"pg20203 RAGAS error: {e}")
    ragas1 = {"error": str(e)}

try:
    ragas2 = run_ragas(af_r2, af_j2)
    print(f"pg76178 RAGAS score: {ragas2.get('ragas_score')}")
except Exception as e:
    print(f"pg76178 RAGAS error: {e}")
    ragas2 = {"error": str(e)}

pathlib.Path("ragas_results.json").write_text(
    json.dumps({"pg20203": ragas1, "pg76178": ragas2}, indent=2)
)
print("RAGAS results saved to ragas_results.json")
print("\nDone. Run build_report.py to generate the HTML evaluation report.")
