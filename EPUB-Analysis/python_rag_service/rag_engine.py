import os
from pathlib import Path
from sentence_transformers import SentenceTransformer, util
from fuzzywuzzy import fuzz
from typing import List, Dict, Any, Optional


def _resolve_cached_embedding_model() -> Optional[str]:
    snapshot_roots = [
        Path.home()
        / ".cache"
        / "huggingface"
        / "hub"
        / "models--sentence-transformers--all-MiniLM-L6-v2"
        / "snapshots",
        Path.home()
        / ".cache"
        / "huggingface"
        / "hub"
        / "models--sentence-transformers--all-MiniLM-L12-v2"
        / "snapshots",
        Path.home()
        / ".cache"
        / "huggingface"
        / "hub"
        / "models--sentence-transformers--all-mpnet-base-v2"
        / "snapshots",
    ]
    for snapshot_root in snapshot_roots:
        if not snapshot_root.is_dir():
            continue
        snapshots = sorted(snapshot_root.iterdir(), key=lambda path: path.stat().st_mtime, reverse=True)
        for snapshot in snapshots:
            if not snapshot.is_dir():
                continue
            has_sentence_transformer_layout = (snapshot / "modules.json").exists()
            has_model_weights = (snapshot / "model.safetensors").exists() or (snapshot / "pytorch_model.bin").exists()
            if has_sentence_transformer_layout and has_model_weights:
                return str(snapshot)
    return None

class RagPipelineEngine:
    def __init__(self, model_name: Optional[str] = None):
        resolved_model = (
            model_name
            or os.getenv("RAG_EMBEDDING_MODEL")
            or _resolve_cached_embedding_model()
            or "BAAI/bge-m3"
        )
        self.model_name = resolved_model
        self.local_files_only = Path(resolved_model).exists()
        self.embed_model = None
        self.initialization_error = None

    def initialize_models(self, raise_on_error: bool = True):
        """Loads the high-precision BGE-M3 embedding model. Keep lazy to speed up startup."""
        if not self.embed_model:
            try:
                print(f"Loading dense embedding model: {self.model_name}")
                self.embed_model = SentenceTransformer(
                    self.model_name,
                    local_files_only=self.local_files_only,
                )
                self.initialization_error = None
            except Exception as exc:
                self.initialization_error = str(exc)
                if raise_on_error:
                    raise
        return self.embed_model

    def model_available(self) -> bool:
        return self.embed_model is not None

    def generate_embeddings(self, texts: List[str]):
        """Generates embeddings using BGE-M3"""
        self.initialize_models()
        return self.embed_model.encode(texts, normalize_embeddings=True)

    def compute_similarity(self, text1: str, text2: str) -> Dict[str, Any]:
        """
        Calculates both dense vector semantic similarity and fuzzy string similarity.
        Useful to isolate formatting differences (hyphenation/merges) vs true missing content.
        """
        # Semantic mapping
        emb1, emb2 = self.generate_embeddings([text1, text2])
        semantic_score = util.pytorch_cos_sim(emb1, emb2).item()
        
        # Levenshtein/Fuzzy match for formatting nuances
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

if __name__ == "__main__":
    engine = RagPipelineEngine()
    print("RagPipelineEngine defined. Run initialize_models() to load BGE-M3.")
