import json

with open("job_result.json", encoding="utf-8") as f:
    data = json.load(f)

stats = data.get('stats', {})
triage = data.get('triage', [])
fix_trace = data.get('fix_trace', [])
hitl = data.get('hitl_suggestions', [])
diffs = data.get('diffs', [])

SEP = "=" * 65
DIV = "-" * 65

print(SEP)
print("  AUTOFIX PIPELINE ANALYSIS - run b75d6790")
print(SEP)
print()

# STATS
print("[STATS]")
print(f"  Total issues detected : {stats.get('total_issues', '?')}")
print(f"  Auto-fix (det)        : {stats.get('auto_issues', '?')} issues -> {stats.get('auto_applied', '?')} applied")
print(f"  LLM-fix               : {stats.get('llm_issues', '?')} issues -> {stats.get('llm_applied', '?')} applied")
print(f"  HITL (manual review)  : {stats.get('hitl_issues', '?')} issues")
print(f"  Total applied         : {stats.get('applied', '?')}")
print(f"  Failed                : {stats.get('failed', '?')}")
print(f"  LLM cache hits        : {stats.get('cache_hits', '?')}")
print()

# TRIAGE
print(DIV)
print(f"[TRIAGE] {len(triage)} issues")
print(DIV)
auto_t  = [t for t in triage if t.get('routing') == 'auto']
llm_t   = [t for t in triage if t.get('routing') == 'llm']
hitl_t  = [t for t in triage if t.get('routing') == 'hitl']
print(f"  auto  ({len(auto_t):2}) : deterministic Node.js fixer")
print(f"  llm   ({len(llm_t):2}) : LLM-assisted Python fixer")
print(f"  hitl  ({len(hitl_t):2}) : needs human review")
print()

for t in triage:
    routing = t.get('routing', '?')
    issue   = t.get('issue_id', '?')
    conf    = t.get('confidence', '?')
    task    = t.get('task_type', '')
    reason  = t.get('reason', '')
    tag = {'auto': 'DET', 'llm': 'LLM', 'hitl': 'HIT'}[routing] if routing in ('auto','llm','hitl') else routing.upper()
    print(f"  [{tag}] {issue:<35} conf={conf:<5} task={task}")
    print(f"        {reason[:90]}")
print()

# FIX TRACE
print(DIV)
print(f"[FIX RESULTS] {len(fix_trace)} items")
print(DIV)
applied = [f for f in fix_trace if f.get('applied')]
manual  = [f for f in fix_trace if f.get('engine') == 'manual']
not_fix = [f for f in fix_trace if not f.get('applied') and f.get('engine') != 'manual']
print(f"  Applied  : {len(applied)}")
print(f"  Manual   : {len(manual)}")
print(f"  Not fixed: {len(not_fix)}")
print()

for fx in fix_trace:
    issue   = fx.get('issue_id', '?')
    engine  = fx.get('engine', '?')
    applied_flag = fx.get('applied', False)
    fixable = fx.get('fixable', None)
    conf    = fx.get('confidence', '')
    model   = fx.get('model_used', '').replace('accounts/fireworks/models/', '')
    fix_val = str(fx.get('fix_value', ''))[:60]
    reason  = str(fx.get('fix_reason', ''))[:90]

    if engine == 'manual':
        status_tag = 'HITL '
    elif applied_flag:
        status_tag = 'FIXED'
    elif fixable is False:
        status_tag = 'SKIP '
    else:
        status_tag = 'UNKN '

    print(f"  [{status_tag}] {issue:<35} engine={engine}")
    if fix_val and engine != 'manual':
        print(f"         fix    : {fix_val}")
    if reason:
        print(f"         reason : {reason}")
    if conf:
        print(f"         conf   : {conf}%")
    print()

# HITL
print(DIV)
print(f"[HITL QUEUE] {len(hitl)} items needing human review")
print(DIV)
for h in hitl:
    print(f"  * {h}")
print()

# DIFFS
print(DIV)
print(f"[CHANGED FILES] {len(diffs)} files modified")
print(DIV)
for d in diffs:
    fname   = d.get('file', '?')
    hunks   = d.get('hunks', [])
    ch      = [h for h in hunks if h.get('tag') != 'equal']
    print(f"\n  {fname}  ({len(ch)} change blocks)")
    for h in ch:
        tag   = h.get('tag', '?')
        before = h.get('before_lines', [])
        after  = h.get('after_lines', [])
        print(f"    [{tag:7}]  removed {len(before)} lines, added {len(after)} lines")
        # Show first few lines of before/after (they can be strings or ints)
        for line in before[:3]:
            if isinstance(line, str):
                print(f"      - {line[:80]}")
        for line in after[:3]:
            if isinstance(line, str):
                print(f"      + {line[:80]}")
