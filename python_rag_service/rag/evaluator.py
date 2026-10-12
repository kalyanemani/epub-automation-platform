"""RAGEvaluator: faithfulness, context_recall, answer_relevancy. Self-fix loop below thresholds."""
from typing import List, Dict, Any, Optional
from ollama_client import ollama_generate
import json
import asyncio

THRESHOLDS = {
    "faithfulness": 0.80,
    "context_recall": 0.75,
    "answer_relevancy": 0.70,
}
MAX_RETRIES = 3


class RAGEvaluator:
    def __init__(self, memory_manager=None):
        self.memory = memory_manager

    async def _score_faithfulness(self, answer: str, context: str) -> float:
        """Does the answer only contain claims supported by the context?"""
        prompt = f"""Rate how faithfully this answer is grounded in the context. Return ONLY a decimal 0.0-1.0.
Context: {context[:800]}
Answer: {answer[:500]}
Score (0.0-1.0):"""
        try:
            resp = await ollama_generate(prompt, task_type="structured")
            return min(1.0, max(0.0, float(resp["response"].strip().split()[0])))
        except Exception:
            return 0.75

    async def _score_context_recall(self, question: str, context: str) -> float:
        """Does the context contain enough information to answer the question?"""
        prompt = f"""Rate how well this context covers the question. Return ONLY a decimal 0.0-1.0.
Question: {question[:300]}
Context: {context[:800]}
Score (0.0-1.0):"""
        try:
            resp = await ollama_generate(prompt, task_type="structured")
            return min(1.0, max(0.0, float(resp["response"].strip().split()[0])))
        except Exception:
            return 0.70

    async def _score_answer_relevancy(self, question: str, answer: str) -> float:
        """Is the answer relevant to the question?"""
        prompt = f"""Rate how relevant this answer is to the question. Return ONLY a decimal 0.0-1.0.
Question: {question[:300]}
Answer: {answer[:500]}
Score (0.0-1.0):"""
        try:
            resp = await ollama_generate(prompt, task_type="structured")
            return min(1.0, max(0.0, float(resp["response"].strip().split()[0])))
        except Exception:
            return 0.70

    async def evaluate(self, question: str, context: str, answer: str) -> Dict[str, float]:
        scores_raw = await asyncio.gather(
            self._score_faithfulness(answer, context),
            self._score_context_recall(question, context),
            self._score_answer_relevancy(question, answer),
        )
        return {
            "faithfulness": round(scores_raw[0], 3),
            "context_recall": round(scores_raw[1], 3),
            "answer_relevancy": round(scores_raw[2], 3),
            "passed": all(
                scores_raw[i] >= list(THRESHOLDS.values())[i]
                for i in range(3)
            )
        }

    async def evaluate_with_selffix(self, question: str, context: str, answer: str,
                                     retriever_fn=None) -> Dict[str, Any]:
        """Evaluate and retry with self-fix strategies if below thresholds."""
        current_context = context
        current_answer = answer
        history = []
        scores = {}

        for attempt in range(MAX_RETRIES):
            scores = await self.evaluate(question, current_context, current_answer)
            history.append({"attempt": attempt + 1, "scores": scores})

            if scores["passed"]:
                return {
                    "scores": scores,
                    "passed": True,
                    "attempts": attempt + 1,
                    "history": history
                }

            # Self-fix strategies
            if scores["faithfulness"] < THRESHOLDS["faithfulness"]:
                # Re-generate answer grounded in context
                prompt = (
                    f"Using ONLY the following context, answer this question faithfully.\n"
                    f"Context: {current_context[:1000]}\n"
                    f"Question: {question}\n"
                    f"Answer:"
                )
                resp = await ollama_generate(prompt, task_type="reasoning")
                current_answer = resp["response"]
            elif scores["context_recall"] < THRESHOLDS["context_recall"] and retriever_fn:
                # Expand retrieval
                extra_context = await retriever_fn(question, limit=8)
                current_context = current_context + "\n\n" + extra_context
            elif scores["answer_relevancy"] < THRESHOLDS["answer_relevancy"]:
                # Rewrite with different model
                prompt = (
                    f"Answer this question directly and concisely: {question}\n"
                    f"Context: {current_context[:800]}\n"
                    f"Answer:"
                )
                resp = await ollama_generate(prompt, task_type="structured", temperature=0.1)
                current_answer = resp["response"]

        return {
            "scores": scores,
            "passed": False,
            "attempts": MAX_RETRIES,
            "history": history,
            "flagged_for_hitl": True
        }
