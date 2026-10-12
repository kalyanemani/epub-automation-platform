"""SmartChunker: three strategies — semantic (sentence-boundary), hierarchical (h1→p tree), sliding-window."""
import re
from enum import Enum
from typing import List, Dict, Any
from bs4 import BeautifulSoup


class ChunkStrategy(str, Enum):
    SEMANTIC = "semantic"         # sentence-boundary ~300 tokens, for prose
    HIERARCHICAL = "hierarchical"  # heading-anchored, preserves structure
    SLIDING_WINDOW = "sliding"    # 512/128 overlap, for CSS/JS


class SmartChunker:
    def __init__(self, max_tokens: int = 512, overlap_tokens: int = 128):
        self.max_tokens = max_tokens
        self.overlap_tokens = overlap_tokens

    def _approx_tokens(self, text: str) -> int:
        # char/4 is the standard LLM approximation; more accurate than word-split
        # for minified CSS/JS where a "word" can be hundreds of characters
        return max(1, len(text) // 4)

    def chunk_semantic(self, text: str, metadata: dict = None) -> List[Dict[str, Any]]:
        """Split at sentence boundaries, ~300 tokens per chunk."""
        sentences = re.split(r'(?<=[.!?])\s+', text.strip())
        chunks, current, current_tokens = [], [], 0

        for sent in sentences:
            t = self._approx_tokens(sent)
            if current_tokens + t > 300 and current:
                chunks.append({
                    "content": " ".join(current),
                    "strategy": "semantic",
                    "token_count": current_tokens,
                    "metadata": metadata or {}
                })
                current, current_tokens = [], 0
            current.append(sent)
            current_tokens += t

        if current:
            chunks.append({
                "content": " ".join(current),
                "strategy": "semantic",
                "token_count": current_tokens,
                "metadata": metadata or {}
            })
        return chunks

    def chunk_hierarchical(self, html_content: str, metadata: dict = None) -> List[Dict[str, Any]]:
        """Parse HTML and chunk by heading hierarchy, preserving parent heading in metadata."""
        soup = BeautifulSoup(html_content, "lxml")
        chunks = []
        current_h1, current_h2 = "", ""
        current_text, current_tokens = [], 0

        for elem in soup.find_all(["h1", "h2", "h3", "p", "li", "td", "th"]):
            tag = elem.name
            text = elem.get_text(separator=" ", strip=True)
            if not text:
                continue

            if tag == "h1":
                if current_text:
                    chunks.append({
                        "content": " ".join(current_text),
                        "strategy": "hierarchical",
                        "h1": current_h1,
                        "h2": current_h2,
                        "metadata": metadata or {}
                    })
                    current_text, current_tokens = [], 0
                current_h1 = text
            elif tag == "h2":
                if current_text:
                    chunks.append({
                        "content": " ".join(current_text),
                        "strategy": "hierarchical",
                        "h1": current_h1,
                        "h2": current_h2,
                        "metadata": metadata or {}
                    })
                    current_text, current_tokens = [], 0
                current_h2 = text
            else:
                t = self._approx_tokens(text)
                if current_tokens + t > self.max_tokens and current_text:
                    chunks.append({
                        "content": " ".join(current_text),
                        "strategy": "hierarchical",
                        "h1": current_h1,
                        "h2": current_h2,
                        "metadata": metadata or {}
                    })
                    current_text, current_tokens = [], 0
                current_text.append(text)
                current_tokens += t

        if current_text:
            chunks.append({
                "content": " ".join(current_text),
                "strategy": "hierarchical",
                "h1": current_h1,
                "h2": current_h2,
                "metadata": metadata or {}
            })
        return chunks

    def chunk_sliding_window(self, text: str, metadata: dict = None) -> List[Dict[str, Any]]:
        """Sliding window chunking (for CSS/JS). 512 tokens, 128 overlap."""
        words = text.split()
        chunks = []
        i = 0
        while i < len(words):
            chunk_words = words[i:i + self.max_tokens]
            chunks.append({
                "content": " ".join(chunk_words),
                "strategy": "sliding_window",
                "window_start": i,
                "token_count": len(chunk_words),
                "metadata": metadata or {}
            })
            i += self.max_tokens - self.overlap_tokens
            if i >= len(words):
                break
        return chunks

    def chunk_css_rules(self, css_text: str, metadata: dict = None) -> List[Dict[str, Any]]:
        """
        Parse CSS into individual rule blocks (selector { declarations }).
        Each chunk is one complete rule block with line-number metadata.
        Falls back to sliding_window if no blocks found.
        """
        chunks = []
        lines = css_text.split('\n')
        depth = 0
        block_lines: List[tuple] = []   # (line_no, line_text)

        for line_no, line in enumerate(lines, 1):
            for ch in line:
                if ch == '{':
                    depth += 1
                elif ch == '}':
                    depth = max(0, depth - 1)
            block_lines.append((line_no, line))

            # Complete block when we return to depth 0 and have content
            if depth == 0 and block_lines:
                block_text = '\n'.join(l for _, l in block_lines).strip()
                if block_text and '{' in block_text:
                    selector_m = re.match(r'^([^{]+)', block_text)
                    selector = selector_m.group(1).strip()[:200] if selector_m else ''
                    chunks.append({
                        "content":    block_text[:800],
                        "strategy":   "css_rule",
                        "selector":   selector,
                        "line_start": block_lines[0][0],
                        "line_end":   block_lines[-1][0],
                        "token_count": self._approx_tokens(block_text),
                        "metadata":   {**(metadata or {}), "chunk_type": "css_rule"},
                    })
                block_lines = []

        return chunks if chunks else self.chunk_sliding_window(css_text, metadata)

    def chunk(self, content: str, strategy: ChunkStrategy, metadata: dict = None) -> List[Dict]:
        if strategy == ChunkStrategy.SEMANTIC:
            return self.chunk_semantic(content, metadata)
        elif strategy == ChunkStrategy.HIERARCHICAL:
            return self.chunk_hierarchical(content, metadata)
        else:
            return self.chunk_sliding_window(content, metadata)

    def auto_chunk(self, content: str, content_type: str, metadata: dict = None) -> List[Dict]:
        """Auto-select strategy based on content type."""
        if content_type in ["css"]:
            return self.chunk_css_rules(content, metadata)
        elif content_type in ["js", "javascript"]:
            return self.chunk_sliding_window(content, metadata)
        elif content_type in ["html", "xhtml", "epub"]:
            return self.chunk_hierarchical(content, metadata)
        else:
            return self.chunk_semantic(content, metadata)
