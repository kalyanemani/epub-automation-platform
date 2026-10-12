import requests
import json
import sys
import time
import base64

EPUB_PATH = r'C:\Users\krishkal\Downloads\9781637429532_with_error 1.epub'
NODE_URL = "http://localhost:9000"
PYTHON_URL = "http://localhost:8001"

SEP = "=" * 60
DIV = "-" * 60

# -- STEP 1: VALIDATE ---------------------------------------------------------
print(SEP)
print("STEP 1: VALIDATION (Node.js :9000)")
print(SEP)

with open(EPUB_PATH, 'rb') as f:
    files = {'file': ('test_errors.epub', f, 'application/epub+zip')}
    r = requests.post(f"{NODE_URL}/validate", files=files, timeout=120)

if r.status_code != 200:
    print(f"ERROR HTTP {r.status_code}: {r.text[:500]}")
    sys.exit(1)

val_data = r.json()
results  = val_data.get('results', [])
summary  = val_data.get('summary', {})
run_id   = val_data.get('run_id', 'N/A')

print(f"Run ID        : {run_id}")
print(f"Total rules   : {summary.get('totalRules', '?')}")
print(f"  Passing     : {summary.get('passing', '?')}")
print(f"  Failing     : {summary.get('failing', '?')}")
print(f"  Warnings    : {summary.get('warnings', '?')}")
print()

# Separate fail / warn / pass
fails = [r for r in results if r.get('status') == 'fail']
warns = [r for r in results if r.get('status') == 'warn']

print(DIV)
print(f"FAILURES ({len(fails)}):")
print(DIV)
for i, item in enumerate(fails, 1):
    rid   = item.get('id', '?')
    title = item.get('title', '?')
    det   = item.get('details', '')
    if isinstance(det, dict):
        det = json.dumps(det)[:120]
    elif isinstance(det, str):
        det = det[:120]
    loc   = item.get('locationText', item.get('location', {}).get('file', ''))
    risk  = item.get('breakageRisk', '')
    fix   = item.get('report_meta', {}).get('rulePolicy', {}).get('safeToAutofix', False)
    conf  = item.get('confidenceLabel', '')
    print(f"\n  {i:2}. [{rid}] {title}")
    print(f"       details  : {det}")
    if loc:
        print(f"       location : {loc}")
    print(f"       risk     : {risk}  |  autofix-safe: {fix}  |  confidence: {conf}")

print()
print(DIV)
print(f"WARNINGS ({len(warns)}):")
print(DIV)
for i, item in enumerate(warns, 1):
    rid   = item.get('id', '?')
    title = item.get('title', '?')
    det   = item.get('details', '')
    if isinstance(det, dict):
        det = json.dumps(det)[:100]
    elif isinstance(det, str):
        det = det[:100]
    print(f"  {i:2}. [{rid}] {title} -- {det}")

# Save for autofix
with open("val_result.json", "w", encoding="utf-8") as f:
    json.dump(val_data, f, indent=2)
print(f"\nSaved full result -> val_result.json")

# -- STEP 2: TRIGGER AUTOFIX VIA PYTHON SERVICE -------------------------------
print()
print(SEP)
print("STEP 2: AUTOFIX (Python :8000)")
print(SEP)

# Find correct autofix endpoint
r_docs = requests.get(f"{PYTHON_URL}/openapi.json", timeout=5)
if r_docs.status_code == 200:
    paths = list(r_docs.json().get('paths', {}).keys())
    fix_paths = [p for p in paths if 'fix' in p.lower() or 'autofix' in p.lower() or 'repair' in p.lower()]
    print(f"Fix-related endpoints: {fix_paths}")
    print(f"All endpoints: {paths}")
else:
    print(f"Could not fetch OpenAPI spec: {r_docs.status_code}")

print()

# Read epub bytes for the autofix call
with open(EPUB_PATH, 'rb') as f:
    epub_bytes = f.read()

epub_b64 = base64.b64encode(epub_bytes).decode()

# Try the autofix endpoint used by Streamlit frontend
# Check api_client.py to find the right one
print("Triggering autofix job...")
payload = {
    "epub_b64": epub_b64,
    "filename": "test_errors.epub",
    "validation_results": results,
    "run_id": run_id,
}

r2 = requests.post(f"{PYTHON_URL}/autofix", json=payload, timeout=30)
print(f"  /autofix -> HTTP {r2.status_code}: {r2.text[:400]}")

if r2.status_code not in (200, 202):
    # Try alternative payload shape
    payload2 = {
        "epub_bytes_b64": epub_b64,
        "filename": "test_errors.epub",
        "validation_report": val_data,
    }
    r3 = requests.post(f"{PYTHON_URL}/autofix", json=payload2, timeout=30)
    print(f"  /autofix (alt) -> HTTP {r3.status_code}: {r3.text[:400]}")
