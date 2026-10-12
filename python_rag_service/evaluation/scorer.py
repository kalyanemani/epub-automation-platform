"""
BLEU-4 and ROUGE (1/2/L) scoring for EPUB autofix evaluation.

Measures text-overlap quality between:
  - generated fix  (hypothesis)
  - reference fix  (reference, optional)
  - issue context  (used when no reference is available)

BLEU  → n-gram precision; good for exact structural matches (CSS/JS patches).
ROUGE → recall-oriented; good for prose fixes (metadata, alt-text).
"""
from __future__ import annotations
import re
from typing import Dict, List, Optional

# ── ROUGE ─────────────────────────────────────────────────────────────────────
try:
    from rouge_score import rouge_scorer as _rouge_scorer
    _ROUGE_AVAILABLE = True
except ImportError:
    _ROUGE_AVAILABLE = False

# ── BLEU ──────────────────────────────────────────────────────────────────────
try:
    from nltk.translate.bleu_score import sentence_bleu, SmoothingFunction
    _BLEU_AVAILABLE = True
except ImportError:
    _BLEU_AVAILABLE = False


def _tokenize(text: str) -> List[str]:
    """Lowercase whitespace+punctuation tokenizer."""
    return re.findall(r"[a-z0-9_\-\.]+", text.lower())


class BleuRougeScorer:
    """
    Lightweight BLEU-4 + ROUGE-{1,2,L} scorer.

    Usage
    -----
    scorer = BleuRougeScorer()
    scores = scorer.score(
        hypothesis="font-size: 1.2em;",
        reference="font-size: 1em;",          # optional
        context="CSS font size too small",     # fallback when no reference
    )
    """

    def __init__(self):
        self._rouge = (
            _rouge_scorer.RougeScorer(["rouge1", "rouge2", "rougeL"], use_stemmer=False)
            if _ROUGE_AVAILABLE else None
        )
        self._smooth = SmoothingFunction().method1 if _BLEU_AVAILABLE else None

    # ── public ────────────────────────────────────────────────────────────────

    def score(
        self,
        hypothesis: str,
        reference: Optional[str] = None,
        context: Optional[str] = None,
    ) -> Dict[str, float]:
        """
        Returns a dict with bleu4, rouge1, rouge2, rougeL (all 0-1).
        When reference is absent, context is used as a soft proxy.
        When neither is available, all scores are -1 (not computable).
        """
        ref = reference or context or ""
        hyp = hypothesis or ""
        if not ref or not hyp:
            return {"bleu4": -1.0, "rouge1": -1.0, "rouge2": -1.0, "rougeL": -1.0}

        return {
            "bleu4":  self._bleu(hyp, ref),
            **self._rouge_scores(hyp, ref),
        }

    def score_batch(
        self,
        pairs: List[Dict],  # [{"hypothesis": ..., "reference": ..., "context": ...}]
    ) -> List[Dict[str, float]]:
        return [
            self.score(
                p.get("hypothesis", ""),
                p.get("reference"),
                p.get("context"),
            )
            for p in pairs
        ]

    # ── private ───────────────────────────────────────────────────────────────

    def _bleu(self, hypothesis: str, reference: str) -> float:
        if not _BLEU_AVAILABLE:
            return -1.0
        hyp_tokens = _tokenize(hypothesis)
        ref_tokens = _tokenize(reference)
        if not hyp_tokens or not ref_tokens:
            return 0.0
        try:
            return round(
                sentence_bleu(
                    [ref_tokens], hyp_tokens,
                    weights=(0.25, 0.25, 0.25, 0.25),
                    smoothing_function=self._smooth,
                ),
                4,
            )
        except Exception:
            return 0.0

    def _rouge_scores(self, hypothesis: str, reference: str) -> Dict[str, float]:
        if not self._rouge:
            return {"rouge1": -1.0, "rouge2": -1.0, "rougeL": -1.0}
        try:
            scores = self._rouge.score(reference, hypothesis)
            return {
                "rouge1": round(scores["rouge1"].fmeasure, 4),
                "rouge2": round(scores["rouge2"].fmeasure, 4),
                "rougeL": round(scores["rougeL"].fmeasure, 4),
            }
        except Exception:
            return {"rouge1": 0.0, "rouge2": 0.0, "rougeL": 0.0}
