"""Run RAGAS evaluation on completed autofix jobs."""
import json, pathlib, sys
import requests

BASE_PY = "http://localhost:8001"
AF_J1   = "3d2b86a9"
AF_J2   = "3b38ffec"

def get_result(job_id):
    r = requests.get(f"{BASE_PY}/agent-autofix-status/{job_id}", timeout=60)
    r.raise_for_status()
    return r.json()

def run_ragas(job_result_dict, run_id):
    payload = {"job_result": job_result_dict, "run_id": run_id}
    r = requests.post(f"{BASE_PY}/evaluate/job", json=payload, timeout=600)
    r.raise_for_status()
    return r.json()

print("Fetching autofix results...", flush=True)
af1 = get_result(AF_J1)
af2 = get_result(AF_J2)

print(f"pg20203: applied={af1['result']['stats']['applied']} failed={af1['result']['stats']['failed']}", flush=True)
print(f"pg76178: applied={af2['result']['stats']['applied']} failed={af2['result']['stats']['failed']}", flush=True)

print("Running RAGAS for pg20203...", flush=True)
try:
    ragas1 = run_ragas(af1["result"], AF_J1)
    print(f"pg20203 RAGAS: score={ragas1.get('ragas_score')} evaluated={ragas1.get('evaluated_fixes')}", flush=True)
except Exception as e:
    print(f"pg20203 RAGAS error: {e}", flush=True)
    ragas1 = {"error": str(e)}

print("Running RAGAS for pg76178...", flush=True)
try:
    ragas2 = run_ragas(af2["result"], AF_J2)
    print(f"pg76178 RAGAS: score={ragas2.get('ragas_score')} evaluated={ragas2.get('evaluated_fixes')}", flush=True)
except Exception as e:
    print(f"pg76178 RAGAS error: {e}", flush=True)
    ragas2 = {"error": str(e)}

out = {"pg20203": ragas1, "pg76178": ragas2}
pathlib.Path("ragas_results.json").write_text(json.dumps(out, indent=2, ensure_ascii=True))
print("Saved ragas_results.json", flush=True)

# Print key metrics
for label, rg in [("pg20203", ragas1), ("pg76178", ragas2)]:
    if "error" in rg:
        print(f"{label}: ERROR {rg['error']}")
        continue
    print(f"\n{label}:")
    for k in ["ragas_score","faithfulness","answer_relevancy","context_precision","fix_applicability","bleu4","rouge1","rouge2","rougeL"]:
        v = rg.get(k, -1)
        print(f"  {k:<22} {v:.4f}" if isinstance(v, float) else f"  {k:<22} {v}")
