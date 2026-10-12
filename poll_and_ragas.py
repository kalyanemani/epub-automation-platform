"""Poll existing autofix jobs and run RAGAS evaluation once done."""
import json, time, pathlib, sys
import requests

BASE_PY = "http://localhost:8001"

# Jobs submitted by run_eval.py
AF_J1 = "3d2b86a9"   # pg20203
AF_J2 = "3b38ffec"   # pg76178

def poll_autofix(job_id):
    r = requests.get(f"{BASE_PY}/agent-autofix-status/{job_id}", timeout=15)
    r.raise_for_status()
    return r.json()

print("Polling autofix jobs…")
start = time.time()
done = set()
while len(done) < 2:
    time.sleep(30)
    elapsed = int(time.time() - start)
    for jid, label in [(AF_J1, "pg20203"), (AF_J2, "pg76178")]:
        if jid in done:
            continue
        s = poll_autofix(jid)
        status = s.get("status", "?")
        stage  = s.get("stage", "?")
        print(f"  [{elapsed}s] {label} {jid[:8]} -> {status}/{stage}", flush=True)
        if status in ("done", "error"):
            done.add(jid)

print("Both autofix jobs complete. Fetching results…")
af_r1 = poll_autofix(AF_J1)
af_r2 = poll_autofix(AF_J2)

pathlib.Path("autofix_result_pg20203.json").write_text(
    json.dumps(af_r1, indent=2, ensure_ascii=True)
)
pathlib.Path("autofix_result_pg76178.json").write_text(
    json.dumps(af_r2, indent=2, ensure_ascii=True)
)
print("Results saved.")

# Summary from result
for label, af_r in [("pg20203", af_r1), ("pg76178", af_r2)]:
    result = af_r.get("result", {})
    applied = result.get("applied", [])
    failed  = result.get("failed", [])
    total_s = result.get("timing", {}).get("total_s", "?")
    print(f"{label}: applied={len(applied)} failed={len(failed)} total_s={total_s}")

# ── RAGAS evaluation ─────────────────────────────────────────────────────────
def run_ragas(job_result, run_id):
    payload = {"job_result": job_result.get("result", {}), "run_id": run_id}
    r = requests.post(f"{BASE_PY}/evaluate/job", json=payload, timeout=300)
    r.raise_for_status()
    return r.json()

print("Running RAGAS evaluation…")
ragas1, ragas2 = {}, {}
try:
    ragas1 = run_ragas(af_r1, AF_J1)
    print(f"pg20203 RAGAS score: {ragas1.get('ragas_score')}")
except Exception as e:
    print(f"pg20203 RAGAS error: {e}")
    ragas1 = {"error": str(e)}

try:
    ragas2 = run_ragas(af_r2, AF_J2)
    print(f"pg76178 RAGAS score: {ragas2.get('ragas_score')}")
except Exception as e:
    print(f"pg76178 RAGAS error: {e}")
    ragas2 = {"error": str(e)}

pathlib.Path("ragas_results.json").write_text(
    json.dumps({"pg20203": ragas1, "pg76178": ragas2}, indent=2, ensure_ascii=True)
)
print("RAGAS results saved to ragas_results.json")
