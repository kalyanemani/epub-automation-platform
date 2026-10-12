import zipfile
import sys
import re
import html
import json

try:
    import enchant
except Exception as e:
    print('MISSING_ENCHANT', file=sys.stderr)
    sys.exit(2)

def strip_tags(s):
    s = re.sub(r'<!--.*?-->', ' ', s, flags=re.S)
    s = re.sub(r'<[^>]+>', ' ', s)
    return html.unescape(s)

if len(sys.argv) < 2:
    print('Usage: spellcheck_epub.py path/to/file.epub', file=sys.stderr)
    sys.exit(1)

epub_path = sys.argv[1]
try:
    d = enchant.Dict('en_US')
except Exception as e:
    print('ENCHANT_FAIL', file=sys.stderr)
    sys.exit(3)

issues = []
with zipfile.ZipFile(epub_path, 'r') as z:
    for name in z.namelist():
        if name.lower().endswith(('.xhtml', '.html', '.htm')):
            try:
                content = z.read(name).decode('utf-8', errors='replace')
            except Exception:
                continue
            text = strip_tags(content)
            words = re.findall(r"[A-Za-z']{2,}", text)
            seen = set()
            file_issues = []
            for w in words:
                wl = w.strip("'")
                if len(wl) <= 1:
                    continue
                key = wl.lower()
                if key in seen:
                    continue
                seen.add(key)
                try:
                    ok = d.check(wl)
                except Exception:
                    ok = True
                if not ok:
                    try:
                        sugg = d.suggest(wl)[:5]
                    except Exception:
                        sugg = []
                    m = re.search(r'\b' + re.escape(w) + r'\b', text, flags=re.IGNORECASE)
                    excerpt = ''
                    if m:
                        i = m.start()
                        excerpt = text[max(0, i-40):i+40].strip()
                    file_issues.append({'word': w, 'suggestions': sugg, 'excerpt': excerpt})
            if file_issues:
                issues.append({'file': name, 'issues': file_issues})

print(json.dumps(issues, ensure_ascii=False, indent=2))
