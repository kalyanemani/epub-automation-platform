import sqlite3, json, time, sys

DB = r'C:\Users\krishkal\Desktop\epub_backend\python_rag_service\jobs.db'

def get_job(run_id):
    conn = sqlite3.connect(DB, timeout=5)
    conn.row_factory = sqlite3.Row
    row = conn.execute('SELECT * FROM autofix_jobs WHERE run_id=?', [run_id]).fetchone()
    conn.close()
    return row

def latest_run_id():
    conn = sqlite3.connect(DB, timeout=5)
    conn.row_factory = sqlite3.Row
    row = conn.execute('SELECT run_id FROM autofix_jobs ORDER BY created_at DESC LIMIT 1').fetchone()
    conn.close()
    return row['run_id'] if row else None

RUN_ID = latest_run_id()
print(f"Monitoring job: {RUN_ID}")
print("-" * 55)

last_stage = None
tick = 0
while True:
    row = get_job(RUN_ID)
    if not row:
        print("Job not found")
        break

    status = row['status']
    stage  = row['stage'] or ''
    elapsed = round(time.time() - float(row['created_at']), 1)

    if stage != last_stage:
        print(f"  [{elapsed:6.1f}s]  {stage or status}")
        last_stage = stage
    else:
        sys.stdout.write(f"\r  [{elapsed:6.1f}s]  {stage}  ...")
        sys.stdout.flush()

    if status in ('done', 'error', 'failed'):
        print()
        print("-" * 55)
        print(f"FINISHED in {elapsed}s — status={status}")
        print()

        result_raw = row['result']
        error_raw  = row['error']

        if error_raw:
            print(f"ERROR: {error_raw[:400]}")

        if result_raw:
            data  = json.loads(result_raw)
            stats = data.get('stats', {})
            print(f"Total issues    : {stats.get('total_issues','?')}")
            print(f"Auto applied    : {stats.get('auto_applied','?')} / {stats.get('auto_issues','?')}")
            print(f"LLM applied     : {stats.get('llm_applied','?')} / {stats.get('llm_issues','?')}")
            print(f"HITL queued     : {stats.get('hitl_issues','?')}")
            print(f"Total applied   : {stats.get('applied','?')}")
            print(f"Failed          : {stats.get('failed','?')}")
            print(f"Cache hits      : {stats.get('cache_hits','?')}")
            print()

            fix_trace = data.get('fix_trace', [])
            print(f"FIX TRACE ({len(fix_trace)} items):")
            for fx in fix_trace:
                issue   = fx.get('issue_id','?')
                engine  = fx.get('engine','?')
                applied = fx.get('applied', False)
                fixable = fx.get('fixable', None)
                conf    = fx.get('confidence','')
                val     = str(fx.get('fix_value',''))[:50]
                reason  = str(fx.get('fix_reason',''))[:70]
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
                if reason:
                    print(f"         why: {reason}")

            hitl = data.get('hitl_suggestions', [])
            if hitl:
                print(f"\nHITL QUEUE ({len(hitl)}):")
                for h in hitl:
                    print(f"  * {h}")

            diffs = data.get('diffs', [])
            changed = [d for d in diffs if d.get('changed')]
            print(f"\nFiles changed: {len(changed)}")
            for d in changed:
                print(f"  {d.get('file')}")
        break

    time.sleep(2)
    tick += 1
    if tick > 150:
        print("\nTimeout — job still running after 5 min")
        break
