import threading
from sentence_transformers import SentenceTransformer, util
from fuzzywuzzy import fuzz
from typing import List, Dict, Any

class RagPipelineEngine:
    def initialize_models(self):
        """Load the embedding model from the local Hugging Face cache."""
    def initialize_models(self):
        """Load the embedding model from the local Hugging Face cache."""
        if self.embed_model is not None or self._load_failed:
            return self.embed_model is not None
        with self._load_lock:
            if self.embed_model is not None or self._load_failed:
                return self.embed_model is not None
            try:
                print(f"Loading dense embedding model: {self.model_name}")
                self.embed_model = SentenceTransformer(self.model_name)
                return True
            except Exception as e:
                print(f"[rag_engine] {self.model_name} unavailable in local cache: {e}")
                self._load_failed = True
                return False
    def __init__(self, model_name: str = "BAAI/bge-m3"):
        self.model_name = model_name
        self.embed_model = None
        self._load_failed = False
        self._load_lock = threading.Lock()

    def generate_embeddings(self, texts: List[str]):
        """Generates embeddings using BGE-M3. Returns None if model is unavailable."""
        self.initialize_models()
        if self.embed_model is None:
            return None
        return self.embed_model.encode(texts, normalize_embeddings=True)

    def embed_html_blocks(self, blocks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Embeds structured HTML elements (from DocumentExtractor.extract_html_semantic_blocks).
        Injects CSS context and tag names to improve spatial-awareness for BGE-M3.
        """
        if not blocks:
            return []

        # Create a semantic string combining the HTML tag/classes and text content
        # BGE-M3 supports long contexts well.
        semantic_texts = []
        for b in blocks:
            class_str = " ".join(b.get("classes", []))
            tag_context = f"<{b['tag_name']} class='{class_str}'>"
            semantic_texts.append(f"{tag_context} {b['content']}")

        vectors = self.generate_embeddings(semantic_texts)
        
        # Attach vectors back to the blocks for downstream vector DB storage
        for i, b in enumerate(blocks):
            b["vector"] = vectors[i]
            
        return blocks

    def compute_similarity(self, text1: str, text2: str) -> Dict[str, Any]:
        """
        Calculates both dense vector semantic similarity and fuzzy string similarity.
        Useful to isolate formatting differences (hyphenation/merges) vs true missing content.
        """
        emb1, emb2 = self.generate_embeddings([text1, text2])
        semantic_score = util.pytorch_cos_sim(emb1, emb2).item()
        
        fuzzy_score = fuzz.ratio(text1.lower(), text2.lower()) / 100.0
        
        return {
            "semantic_similarity": round(semantic_score, 4),
            "fuzzy_similarity": round(fuzzy_score, 4),
            "match_category": self._categorize_match(semantic_score, fuzzy_score)
        }

    def _categorize_match(self, semantic: float, fuzzy: float) -> str:
        """Categorizes the diff based on thresholding rules."""
        if semantic > 0.98 and fuzzy > 0.98:
            return "identical"
        elif semantic > 0.95 and fuzzy < 0.90:
            return "formatting_mismatch" # e.g., hyphenation or merged word
        elif semantic < 0.85:
            return "high_risk_divergence" # Substantial text missing or changed
        else:
            return "low_risk_divergence"

# Shared singleton â€” import this instead of constructing new instances
rag_engine = RagPipelineEngine()

if __name__ == "__main__":
    print("RagPipelineEngine defined. Run initialize_models() to load BGE-M3.")




