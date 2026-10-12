import sqlite3
import json
import time
import sys

DB_PATH = r"C:\Users\krishkal\Desktop\epub_backend\python_rag_service\jobs.db"
RUN_ID  = "b75d6790"

print(f"Polling job {RUN_ID}...")
for attempt in range(60):  # max 5 min
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM autofix_jobs WHERE run_id=?", [RUN_ID]).fetchone()
    conn.close()

    if not row:
        print("Job not found")
        sys.exit(1)

    status = row['status']
    stage  = row['stage'] or ''
    print(f"  [{attempt:02d}] status={status:<10} stage={stage}")

    if status in ('done', 'error', 'failed'):
        break
    time.sleep(5)

print()
# Now analyse
conn = sqlite3.connect(DB_PATH, timeout=5)
conn.row_factory = sqlite3.Row
full = conn.execute("SELECT * FROM autofix_jobs WHERE run_id=?", [RUN_ID]).fetchone()
conn.close()

keys = full.keys()
print(f"Available columns: {list(keys)}")
print()

for col in ['triage_json', 'fix_results_json', 'report_json', 'error_json']:
    if col not in keys:
        continue
    val = full[col]
    if not val:
        continue
    try:
        data = json.loads(val)
    except Exception:
        print(f"{col}: (invalid json)")
        continue

    print(f"{'='*60}")
    print(f"  {col}")
    print(f"{'='*60}")

    if col == 'triage_json':
        triage = data.get('triage_results', data)
        if isinstance(triage, list):
            print(f"  Triaged issues: {len(triage)}")
            for t in triage:
                routing = t.get('routing', t.get('route', '?'))
                issue   = t.get('issue_id', t.get('rule_id', '?'))
                reason  = str(t.get('reason', ''))[:80]
                conf    = t.get('confidence', '')
                print(f"    [{routing:6}] {issue:<35} conf={conf}  {reason}")

    elif col == 'fix_results_json':
        fixes = data if isinstance(data, list) else data.get('fixes', data.get('results', []))
        print(f"  Total: {len(fixes)}")
        for fx in fixes:
            rule   = fx.get('rule_id', fx.get('issue_id', '?'))
            fstatus = fx.get('status', '?')
            method = fx.get('method', fx.get('agent', fx.get('fix_agent', '')))
            conf   = fx.get('confidence', '')
            detail = str(fx.get('detail', fx.get('message', fx.get('error', ''))))[:80]
            print(f"    [{fstatus:10}] {rule:<35}  method={method}  conf={conf}")
            if detail:
                print(f"                   {detail}")

    elif col == 'error_json':
        print(json.dumps(data, indent=2)[:600])

    elif col == 'report_json':
        total  = data.get('total_issues', '?')
        fixed  = data.get('auto_fixed', data.get('fixed_count', '?'))
        hitl   = data.get('hitl_count', data.get('manual_count', '?'))
        score  = data.get('score', data.get('quality_score', '?'))
        print(f"  total_issues : {total}")
        print(f"  auto_fixed   : {fixed}")
        print(f"  hitl         : {hitl}")
        print(f"  final_score  : {score}")
        print(json.dumps(data, indent=2)[:1000])
