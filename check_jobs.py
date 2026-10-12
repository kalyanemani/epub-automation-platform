import sqlite3
import json
import os

DB_PATH = r"C:\Users\krishkal\Desktop\epub_backend\python_rag_service\jobs.db"

conn = sqlite3.connect(DB_PATH, timeout=10)
conn.row_factory = sqlite3.Row

# Show all recent jobs
rows = conn.execute(
    "SELECT run_id, status, stage, created_at, updated_at FROM autofix_jobs ORDER BY created_at DESC LIMIT 10"
).fetchall()

print(f"{'RUN_ID':<12}  {'STATUS':<10}  {'STAGE':<25}  {'CREATED':<22}  {'UPDATED'}")
print("-" * 100)
for row in rows:
    print(f"{row['run_id']:<12}  {row['status']:<10}  {str(row['stage'] or ''):<25}  {row['created_at']:<22}  {row['updated_at']}")

print()

# Get full detail for the most recent job
latest = rows[0]['run_id'] if rows else None
if latest:
    full = conn.execute("SELECT * FROM autofix_jobs WHERE run_id=?", [latest]).fetchone()
    print(f"=== LATEST JOB: {latest} ===")
    print(f"Status  : {full['status']}")
    print(f"Stage   : {full['stage']}")
    print()

    for col in ['triage_json', 'fix_results_json', 'report_json', 'error_json']:
        val = full[col] if col in full.keys() else None
        if val:
            try:
                data = json.loads(val)
                print(f"--- {col} ---")
                if col == 'triage_json':
                    triage = data.get('triage_results', data)
                    if isinstance(triage, list):
                        print(f"  Total triaged: {len(triage)}")
                        auto = [t for t in triage if t.get('routing') == 'auto']
                        hitl = [t for t in triage if t.get('routing') == 'hitl']
                        skip = [t for t in triage if t.get('routing') not in ('auto','hitl')]
                        print(f"  Auto-fix  : {len(auto)}")
                        print(f"  HITL      : {len(hitl)}")
                        print(f"  Skip/other: {len(skip)}")
                        for t in triage:
                            print(f"    [{t.get('routing','?'):6}] {t.get('issue_id','?')} | confidence={t.get('confidence','?')} | {t.get('reason','')[:80]}")
                    else:
                        print(json.dumps(data, indent=2)[:600])
                elif col == 'fix_results_json':
                    fixes = data if isinstance(data, list) else data.get('fixes', [])
                    print(f"  Total fixes: {len(fixes)}")
                    ok  = [f for f in fixes if f.get('status') in ('fixed','ok','success')]
                    fail= [f for f in fixes if f.get('status') in ('failed','error','unfixable')]
                    skip= [f for f in fixes if f.get('status') in ('skipped','skip')]
                    print(f"  Fixed   : {len(ok)}")
                    print(f"  Failed  : {len(fail)}")
                    print(f"  Skipped : {len(skip)}")
                    for f in fixes:
                        rule   = f.get('rule_id', f.get('issue_id', '?'))
                        fstatus = f.get('status', '?')
                        method = f.get('method', f.get('agent', ''))
                        conf   = f.get('confidence', '')
                        print(f"    [{fstatus:8}] {rule:<35}  method={method}  conf={conf}")
                else:
                    print(json.dumps(data, indent=2)[:800])
            except Exception as e:
                print(f"  (parse error: {e})")

conn.close()
