import sqlite3, json

DB = r'C:\Users\krishkal\Desktop\epub_backend\python_rag_service\jobs.db'
conn = sqlite3.connect(DB, timeout=5)
conn.row_factory = sqlite3.Row
row = conn.execute("SELECT * FROM autofix_jobs ORDER BY created_at DESC LIMIT 1").fetchone()
conn.close()

print(f"run_id : {row['run_id']}")
print(f"status : {row['status']}")
print(f"stage  : {row['stage']}")
print()

if row['error']:
    print(f"ERROR: {row['error'][:300]}")

if not row['result']:
    print("No result data")
else:
    data  = json.loads(row['result'])
    stats = data.get('stats', {})
    print(f"Total issues  : {stats.get('total_issues','?')}")
    print(f"Auto applied  : {stats.get('auto_applied','?')} / {stats.get('auto_issues','?')}")
    print(f"LLM applied   : {stats.get('llm_applied','?')} / {stats.get('llm_issues','?')}")
    print(f"HITL queued   : {stats.get('hitl_issues','?')}")
    print(f"Total applied : {stats.get('applied','?')}")
    print(f"Failed        : {stats.get('failed','?')}")
    print(f"Cache hits    : {stats.get('cache_hits','?')}")
    print()

    fix_trace = data.get('fix_trace', [])
    print(f"FIX TRACE ({len(fix_trace)}):")
    for fx in fix_trace:
        issue   = fx.get('issue_id','?')
        engine  = fx.get('engine','?')
        applied = fx.get('applied', False)
        fixable = fx.get('fixable', None)
        conf    = fx.get('confidence','')
        val     = str(fx.get('fix_value',''))[:55]
        if engine == 'manual':
            tag = 'HITL '
        elif applied:
            tag = 'FIXED'
        elif fixable is False:
            tag = 'SKIP '
        else:
            tag = 'UNKN '
        print(f"  [{tag}] {issue:<35} engine={engine}  conf={conf}")
        if val and engine != 'manual':
            print(f"         fix: {val}")

    hitl = data.get('hitl_suggestions', [])
    if hitl:
        print(f"\nHITL ({len(hitl)}): {hitl}")

    diffs = data.get('diffs', [])
    changed = [d for d in diffs if d.get('changed')]
    print(f"\nFiles changed: {len(changed)}")
    for d in changed:
        print(f"  {d.get('file')}")
