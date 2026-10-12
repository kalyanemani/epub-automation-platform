import zipfile, os

for path in [
    r'C:\Users\krishkal\Downloads\pg20203-images-3-issues.epub',
    r'C:\Users\krishkal\Downloads\pg76178-images-3-issues.epub',
]:
    size = os.path.getsize(path)
    label = os.path.basename(path)
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        js_files = [x for x in names if x.endswith('.js')]
        print(f'\n{label}: {size//1024}KB, {len(names)} files')
        print(f'  JS files: {js_files}')

        opf = z.read('OEBPS/content.opf').decode('utf-8', 'replace')
        for line in opf.split('\n'):
            s = line.strip()
            if any(x in s for x in ['dc:date', 'dc:language', 'dcterms:modified']):
                print(f'  OPF: {s}')

        if 'OEBPS/pgepub.css' in names:
            css = z.read('OEBPS/pgepub.css').decode('utf-8', 'replace')
            print(f'  pgepub.css contains "rainbow": {"rainbow" in css}')

        if 'OEBPS/1.css' in names:
            css1 = z.read('OEBPS/1.css').decode('utf-8', 'replace')
            print(f'  1.css contains "extrabold": {"extrabold" in css1}')

        if 'OEBPS/scripts/chapter-nav.js' in names:
            js = z.read('OEBPS/scripts/chapter-nav.js').decode('utf-8', 'replace')
            print(f'  chapter-nav.js: localStorage={("localStorage" in js)}, fetch={("fetch(" in js)}, syntax_err={("if (stored {" in js)}')

        # Check lang removal in pg76178
        xhtmls = sorted([n for n in names if n.endswith(('.xhtml', '.html', '.htm'))])
        for xf in xhtmls[:3]:
            txt = z.read(xf).decode('utf-8', 'replace')
            has_lang = 'lang=' in txt[:300]
            print(f'  {xf.split("/")[-1][:50]}: lang={has_lang}')
