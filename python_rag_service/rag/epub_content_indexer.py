"""
EPUBContentIndexer: indexes each uploaded EPUB's CSS/HTML/OPF content
into a per-run ChromaDB collection so KBAgent can retrieve epub-specific context.
"""
import os
import re
import zipfile
import tempfile
import shutil
from typing import List, Dict

from rag.chunker import SmartChunker
from rag.indexer import ChromaIndexer


class EPUBContentIndexer:
    """
    Extracts and indexes an EPUB's actual content into a short-lived per-run
    ChromaDB collection (named ``epub_{run_id}``).

    The collection is populated once at the start of the autofix pipeline and
    queried by KBAgent alongside the global kb_css / kb_js collections to give
    the LLM grounding in *this* epub's specific CSS patterns, HTML structure,
    and OPF metadata.
    """

    def __init__(self, indexer: ChromaIndexer):
        self.indexer = indexer
        self.chunker = SmartChunker()

    # ── Public API ────────────────────────────────────────────────────────────

    async def index_epub(self, epub_path: str, run_id: str) -> str:
        """
        Extract and index the EPUB content. Returns the collection name.
        Non-fatal: if indexing fails the pipeline continues without per-epub context.
        """
        collection = f"epub_{run_id}"
        tmp = tempfile.mkdtemp(prefix="epub_idx_")
        try:
            with zipfile.ZipFile(epub_path, "r") as zf:
                zf.extractall(tmp)
            await self._index_css_files(tmp, collection, run_id)
            await self._index_html_files(tmp, collection, run_id)
            await self._index_opf_metadata(tmp, collection, run_id)
        except Exception as exc:
            print(f"[epub-indexer] non-fatal error for run {run_id}: {exc}")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        return collection

    # ── Internal ──────────────────────────────────────────────────────────────

    async def _index_css_files(self, epub_dir: str, collection: str, run_id: str):
        css_files = self._find_files(epub_dir, ".css")
        for path in css_files[:10]:   # cap at 10 CSS files
            try:
                rel = os.path.relpath(path, epub_dir).replace(os.sep, "/")
                content = self._read(path)
                chunks = self.chunker.chunk_css_rules(
                    content,
                    metadata={
                        "source":    "epub_content",
                        "run_id":    run_id,
                        "file":      rel,
                        "file_type": "css",
                        "domain":    "css",
                    }
                )
                # Tag each chunk with precise location
                for c in chunks:
                    c["metadata"]["line_start"] = c.get("line_start", 0)
                    c["metadata"]["line_end"]   = c.get("line_end", 0)
                    c["metadata"]["selector"]   = c.get("selector", "")
                if chunks:
                    await self.indexer.index_chunks(chunks, collection)
            except Exception as exc:
                print(f"[epub-indexer] CSS {path}: {exc}")

    async def _index_html_files(self, epub_dir: str, collection: str, run_id: str):
        html_files = self._find_files(epub_dir, ".xhtml", ".html", ".htm")
        for path in html_files[:20]:  # cap at 20 HTML files
            try:
                rel = os.path.relpath(path, epub_dir).replace(os.sep, "/")
                content = self._read(path)
                if len(content) > 60_000:
                    content = content[:60_000]
                chunks = self.chunker.chunk_hierarchical(
                    content,
                    metadata={
                        "source":    "epub_content",
                        "run_id":    run_id,
                        "file":      rel,
                        "file_type": "html",
                        "domain":    "html",
                    }
                )
                if chunks:
                    await self.indexer.index_chunks(chunks, collection)
            except Exception as exc:
                print(f"[epub-indexer] HTML {path}: {exc}")

    async def _index_opf_metadata(self, epub_dir: str, collection: str, run_id: str):
        """Index OPF metadata as a single semantic chunk so KBAgent can check it."""
        opf_path = self._find_opf(epub_dir)
        if not opf_path:
            return
        try:
            opf_text = self._read(opf_path)
            # Extract key metadata values
            fields = {}
            for tag in ("dc:title", "dc:creator", "dc:publisher", "dc:date",
                        "dc:language", "dc:identifier"):
                m = re.search(rf'<{re.escape(tag)}[^>]*>(.*?)</{re.escape(tag)}>',
                              opf_text, re.I | re.S)
                if m:
                    fields[tag] = m.group(1).strip()
            summary = "OPF Metadata: " + "; ".join(f"{k}={v}" for k, v in fields.items())
            chunks = [{
                "content":  summary + "\n\nFull OPF:\n" + opf_text[:2000],
                "strategy": "semantic",
                "metadata": {
                    "source":    "epub_content",
                    "run_id":    run_id,
                    "file":      os.path.relpath(opf_path, epub_dir).replace(os.sep, "/"),
                    "file_type": "opf",
                    "domain":    "metadata",
                }
            }]
            await self.indexer.index_chunks(chunks, collection)
        except Exception as exc:
            print(f"[epub-indexer] OPF {opf_path}: {exc}")

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _find_files(self, epub_dir: str, *extensions) -> List[str]:
        result = []
        for root, _, files in os.walk(epub_dir):
            for f in files:
                if any(f.lower().endswith(ext) for ext in extensions):
                    result.append(os.path.join(root, f))
        return result

    def _find_opf(self, epub_dir: str) -> str:
        container = os.path.join(epub_dir, "META-INF", "container.xml")
        if os.path.exists(container):
            txt = self._read(container)
            m = re.search(r'full-path=["\']([^"\']+\.opf)["\']', txt, re.I)
            if m:
                return os.path.join(epub_dir, m.group(1).replace("/", os.sep))
        for root, _, files in os.walk(epub_dir):
            for f in files:
                if f.lower().endswith(".opf"):
                    return os.path.join(root, f)
        return ""

    @staticmethod
    def _read(path: str) -> str:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read()
