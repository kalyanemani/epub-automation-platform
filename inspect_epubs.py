import zipfile, re

for path, label in [
    (r'C:\Users\krishkal\Downloads\pg20203-images-3.epub', 'pg20203'),
    (r'C:\Users\krishkal\Downloads\pg76178-images-3.epub', 'pg76178'),
]:
    print(f'\n=== {label} ===')
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        css_files = [n for n in names if n.endswith('.css')]
        xhtml_files = [n for n in names if n.endswith(('.xhtml', '.html', '.htm'))]
        ncx = [n for n in names if n.endswith('.ncx')]

        for cf in css_files[:2]:
            txt = z.read(cf).decode('utf-8', 'replace')
            print(f'  CSS {cf}: {len(txt)} chars, first 200: {txt[:200].strip()}')

        for xf in xhtml_files[:2]:
            txt = z.read(xf).decode('utf-8', 'replace')
            headings = re.findall(r'<h[1-6][^>]*>', txt)
            imgs = re.findall(r'<img[^>]*>', txt)
            has_lang = 'lang=' in txt[:200]
            print(f'  XHTML {xf.split("/")[-1]}: has_lang={has_lang}, headings={headings[:3]}, imgs={len(imgs)}')

        if ncx:
            ncx_txt = z.read(ncx[0]).decode('utf-8', 'replace')
            po = re.findall(r'playOrder="(\d+)"', ncx_txt)
            print(f'  NCX playOrder first 10: {po[:10]}')
