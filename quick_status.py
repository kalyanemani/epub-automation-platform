import sqlite3, json, time

DB = r'C:\Users\krishkal\Desktop\epub_backend\python_rag_service\jobs.db'
conn = sqlite3.connect(DB, timeout=5)
conn.row_factory = sqlite3.Row
rows = conn.execute('SELECT run_id, status, stage, created_at, updated_at FROM autofix_jobs ORDER BY created_at DESC LIMIT 3').fetchall()
conn.close()

now = time.time()
for row in rows:
    elapsed     = round(now - float(row['created_at']), 1)
    last_update = round(now - float(row['updated_at']), 1)
    print(f"run_id      : {row['run_id']}")
    print(f"status      : {row['status']}")
    print(f"stage       : {row['stage']}")
    print(f"elapsed     : {elapsed}s")
    print(f"last update : {last_update}s ago")
    print()
