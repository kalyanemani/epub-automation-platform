import sqlite3, time

DB = r'C:\Users\krishkal\Desktop\epub_backend\python_rag_service\jobs.db'
conn = sqlite3.connect(DB, timeout=5)
conn.row_factory = sqlite3.Row

# Mark any job stuck in running for > 600s as failed
now = time.time()
cur = conn.execute(
    "SELECT run_id, stage, created_at FROM autofix_jobs WHERE status='running'"
)
stuck = [(r['run_id'], r['stage'], round(now - float(r['created_at']), 0)) for r in cur.fetchall()]

for run_id, stage, elapsed in stuck:
    print(f"Stuck job: {run_id}  stage={stage}  elapsed={elapsed}s")
    if elapsed > 600:
        conn.execute(
            "UPDATE autofix_jobs SET status='error', stage='failed - node_fixing timeout', updated_at=? WHERE run_id=?",
            [now, run_id]
        )
        print(f"  -> marked as error")

conn.commit()
conn.close()
print("Done.")
