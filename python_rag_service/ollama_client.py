"""
LLM routing for the Python RAG microservice.

Local dev / testing  — set only FIREWORKS_API_KEY; Ollama tiers are skipped.
Production (AWS)     — set OLLAMA_PRIMARY_URL; Fireworks becomes the fallback.

  Tier 1 — Remote/Local Ollama  (OLLAMA_PRIMARY_URL)   — skipped when not configured or circuit open
  Tier 2 — Fireworks AI         (FIREWORKS_API_KEY)    — cloud fallback / sole provider in dev
  Tier 3 — Local Ollama         (OLLAMA_FALLBACK_URL)  — skipped when not configured

Circuit-breaker: after one primary Ollama failure, Fireworks becomes active
for _PRIMARY_COOLDOWN_S (120 s). Primary is re-probed after cooldown expires.
"""
from __future__ import annotations
import os
import asyncio
import httpx
from typing import Dict, List, Optional

# ── Endpoints & base timeouts ──────────────────────────────────────────────────
# Leave empty to disable that Ollama tier (local dev uses Fireworks only).
OLLAMA_PRIMARY_URL  = os.getenv("OLLAMA_PRIMARY_URL",  "")
OLLAMA_FALLBACK_URL = os.getenv("OLLAMA_FALLBACK_URL", "")
OLLAMA_DISCOVERY_TIMEOUT_S = max(1, int(os.getenv("OLLAMA_DISCOVERY_TIMEOUT_MS", "4000")) // 1000)

_PRIMARY_TIMEOUT_S  = int(os.getenv("OLLAMA_PRIMARY_TIMEOUT_S", "30"))
_LOCAL_TIMEOUT_S    = int(os.getenv("OLLAMA_LOCAL_TIMEOUT_S",   "30"))
_FIREWORKS_TIMEOUT_S = int(os.getenv("FIREWORKS_TIMEOUT_S",     "20"))

# ── Fireworks AI ───────────────────────────────────────────────────────────────
FIREWORKS_API_KEY  = os.getenv("FIREWORKS_API_KEY", "")
FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1"

# Best Fireworks model per task type (based on account's available models).
# deepseek-v4-pro: fastest (~900ms), strong code + reasoning — used for all LLM tasks.
# kimi-k2p6: fallback alternative (~3.7s) if deepseek is unavailable.
_FIREWORKS_MODEL_MAP: Dict[str, str] = {
    "codegen":    "accounts/fireworks/models/deepseek-v4-pro",  # CSS, JS fixes
    "structured": "accounts/fireworks/models/deepseek-v4-pro",  # HTML, metadata fixes
    "reasoning":  "accounts/fireworks/models/deepseek-v4-pro",  # orchestrator tasks
    "vision":     "",                                            # not available on Fireworks
    "default":    "accounts/fireworks/models/deepseek-v4-pro",
}

# ── Ollama model preferences per task type ─────────────────────────────────────
TASK_MODEL_MAP = {
    "vision":     os.getenv("OLLAMA_MODEL_VISION",     "qwen2.5vl:7b"),
    "reasoning":  os.getenv("OLLAMA_MODEL_REASONING",  "qwen3:14b"),
    "structured": os.getenv("OLLAMA_MODEL_STRUCTURED", "qwen2.5:7b"),
    "codegen":    os.getenv("OLLAMA_MODEL_CODEGEN",    "qwen3-coder:30b"),
    "default":    os.getenv("OLLAMA_MODEL",            "qwen2.5:7b"),
}

_ADAPTIVE_FALLBACKS: Dict[str, List[str]] = {
    "vision":     ["qwen2.5vl", "llava", "minicpm-v", "llama3.2-vision"],
    "reasoning":  ["qwen3", "qwen2.5-coder:14b", "qwen2.5-coder:7b", "llama3.1:8b", "llama3:latest", "llama3.2"],
    "codegen":    ["qwen3-coder", "qwen2.5-coder:14b", "qwen2.5-coder:7b", "qwen3", "llama3.1:8b"],
    "structured": ["qwen2.5-coder:7b", "qwen2.5-coder:14b", "gemma2", "llama3.2", "llama3.1:8b"],
    "default":    ["qwen2.5-coder:7b", "qwen2.5-coder:14b", "gemma2", "llama3.2", "llama3.1:8b"],
}

# ── Runtime model cache ────────────────────────────────────────────────────────
_model_cache: Dict[str, Optional[List[str]]] = {}
_cache_lock = asyncio.Lock()

# ── Primary circuit-breaker — skip primary for 2 min after first timeout ──────
import time as _time
_primary_down_until: float = 0.0   # epoch seconds; 0 means "assume up"
_PRIMARY_COOLDOWN_S: int   = 120   # re-probe primary after this many seconds

# ── Lazy semaphores (created inside the running event loop, Python 3.9 safe) ──
_primary_sem:   Optional[asyncio.Semaphore] = None
_local_sem:     Optional[asyncio.Semaphore] = None
_fireworks_sem: Optional[asyncio.Semaphore] = None


def _get_primary_sem() -> asyncio.Semaphore:
    global _primary_sem
    if _primary_sem is None:
        _primary_sem = asyncio.Semaphore(6)
    return _primary_sem


def _get_local_sem() -> asyncio.Semaphore:
    global _local_sem
    if _local_sem is None:
        _local_sem = asyncio.Semaphore(1)
    return _local_sem


def _get_fireworks_sem() -> asyncio.Semaphore:
    global _fireworks_sem
    if _fireworks_sem is None:
        _fireworks_sem = asyncio.Semaphore(2)  # 2 concurrent — reduces 429 rate limit pressure
    return _fireworks_sem


# ── Model discovery helpers ────────────────────────────────────────────────────

def resolve_model(task_type: str = "default") -> str:
    return TASK_MODEL_MAP.get(task_type, TASK_MODEL_MAP["default"])


async def _fetch_models(base_url: str) -> List[str]:
    async with httpx.AsyncClient(timeout=OLLAMA_DISCOVERY_TIMEOUT_S) as client:
        try:
            resp = await client.get(f"{base_url}/api/tags")
            resp.raise_for_status()
            return [m["name"] for m in resp.json().get("models", [])]
        except Exception:
            return []


async def _get_models(base_url: str) -> List[str]:
    async with _cache_lock:
        if _model_cache.get(base_url) is None:
            _model_cache[base_url] = await _fetch_models(base_url)
        return _model_cache[base_url] or []


def _best_model(available: List[str], preferred: str, fallback_keys: List[str]) -> Optional[str]:
    for m in available:
        if m == preferred or m.startswith(preferred.split(":")[0] + ":"):
            return m
    for fragment in fallback_keys:
        for m in available:
            if fragment.lower() in m.lower():
                return m
    return None


# ── Per-tier call helpers ──────────────────────────────────────────────────────

async def _call_ollama(
    base_url: str,
    task_type: str,
    prompt: str,
    temperature: float,
    images: Optional[List[str]],
    timeout: int,
    sem: asyncio.Semaphore,
) -> dict:
    """Raw call to one Ollama endpoint with its own timeout and semaphore."""
    preferred = resolve_model(task_type)
    fb_keys   = _ADAPTIVE_FALLBACKS.get(task_type, _ADAPTIVE_FALLBACKS["default"])
    models    = await _get_models(base_url)
    model     = _best_model(models, preferred, fb_keys) or preferred

    payload: dict = {
        "model":   model,
        "prompt":  prompt,
        "stream":  False,
        "options": {"temperature": temperature},
    }
    if images:
        payload["images"] = images

    async with sem:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(f"{base_url}/api/generate", json=payload)
            resp.raise_for_status()
            data = resp.json()
            print(f"[LLM] {task_type} -> {model} @ {base_url}")
            return {
                "response":      data.get("response", ""),
                "model":         model,
                "endpoint_used": base_url,
                "task_type":     task_type,
            }


async def fireworks_generate(
    prompt: str,
    task_type: str = "default",
    temperature: float = 0.2,
) -> dict:
    """
    Fireworks AI chat completions (OpenAI-compatible).
    Splits the prompt at the first '\\n\\n---\\n\\n' separator so the system
    prompt is sent as a system message for better instruction following.
    """
    fw_model = _FIREWORKS_MODEL_MAP.get(task_type, _FIREWORKS_MODEL_MAP["default"])
    if not fw_model:
        raise ValueError(f"No Fireworks model configured for task_type='{task_type}'")

    sep = "\n\n---\n\n"
    if sep in prompt:
        system_part, user_part = prompt.split(sep, 1)
        messages = [
            {"role": "system", "content": system_part},
            {"role": "user",   "content": user_part},
        ]
    else:
        messages = [{"role": "user", "content": prompt}]

    headers = {
        "Authorization": f"Bearer {FIREWORKS_API_KEY}",
        "Content-Type":  "application/json",
    }
    payload = {
        "model":       fw_model,
        "messages":    messages,
        "max_tokens":  512,
        "temperature": temperature,
    }

    async with _get_fireworks_sem():
        for _attempt in range(3):  # retry up to 3 times on 429
            async with httpx.AsyncClient(timeout=_FIREWORKS_TIMEOUT_S) as client:
                resp = await client.post(
                    f"{FIREWORKS_BASE_URL}/chat/completions",
                    headers=headers,
                    json=payload,
                )
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("retry-after", 5 * (2 ** _attempt)))
                print(f"[LLM] Fireworks 429 — waiting {retry_after}s before retry {_attempt + 1}/3")
                await asyncio.sleep(retry_after)
                continue
            resp.raise_for_status()
            break
        data = resp.json()
        if not data.get("choices"):
            raise RuntimeError(f"Fireworks returned no choices: {list(data.keys())} — {str(data)[:200]}")
        content = data["choices"][0]["message"]["content"]
        print(f"[LLM] fireworks {task_type} -> {fw_model}")
        return {
            "response":      content,
            "model":         fw_model,
            "endpoint_used": FIREWORKS_BASE_URL,
            "task_type":     task_type,
        }


# ── Main entry point: three-tier fallback ─────────────────────────────────────

async def ollama_generate(
    prompt: str,
    task_type: str = "default",
    temperature: float = 0.2,
    images: Optional[List[str]] = None,
) -> dict:
    """
    Three-tier LLM fallback:
      1. Remote Ollama  (PRIMARY)    — skipped via circuit-breaker when unreachable
      2. Fireworks AI   (cloud)      — fast cloud fallback (primary when primary is down)
      3. Local Ollama   (FALLBACK)   — always-available last resort
    """
    global _primary_down_until
    errors: List[str] = []

    # ── Tier 1: Ollama primary (skipped when URL not configured) ──────────────
    if OLLAMA_PRIMARY_URL:
        now = _time.monotonic()
        if now >= _primary_down_until:
            try:
                result = await _call_ollama(
                    OLLAMA_PRIMARY_URL, task_type, prompt, temperature, images,
                    timeout=_PRIMARY_TIMEOUT_S, sem=_get_primary_sem(),
                )
                _primary_down_until = 0.0
                return result
            except Exception as e:
                errors.append(f"primary_ollama({type(e).__name__})")
                _model_cache[OLLAMA_PRIMARY_URL] = None
                _primary_down_until = _time.monotonic() + _PRIMARY_COOLDOWN_S
                print(f"[LLM] primary Ollama failed ({type(e).__name__}) — circuit open for {_PRIMARY_COOLDOWN_S}s, routing to Fireworks")
        else:
            remaining = int(_primary_down_until - now)
            print(f"[LLM] primary Ollama circuit OPEN ({remaining}s remaining) — routing to Fireworks")
    else:
        print("[LLM] OLLAMA_PRIMARY_URL not set — using Fireworks")

    # ── Tier 2: Fireworks AI ───────────────────────────────────────────────────
    if FIREWORKS_API_KEY:
        try:
            return await fireworks_generate(prompt, task_type, temperature)
        except Exception as e:
            errors.append(f"fireworks({type(e).__name__})")
            print(f"[LLM] Fireworks failed ({type(e).__name__}), trying local Ollama...")
    else:
        errors.append("fireworks(no_api_key)")
        print("[LLM] FIREWORKS_API_KEY not set — skipping Fireworks tier")

    # ── Tier 3: Local Ollama fallback (skipped when URL not configured) ───────
    if OLLAMA_FALLBACK_URL:
        try:
            return await _call_ollama(
                OLLAMA_FALLBACK_URL, task_type, prompt, temperature, images,
                timeout=_LOCAL_TIMEOUT_S, sem=_get_local_sem(),
            )
        except Exception as e:
            errors.append(f"local_ollama({type(e).__name__})")
            _model_cache[OLLAMA_FALLBACK_URL] = None
    else:
        errors.append("local_ollama(not_configured)")

    raise RuntimeError(f"All LLM tiers failed for task_type={task_type}: {'; '.join(errors)}")


# ── Health check ───────────────────────────────────────────────────────────────

async def ollama_health() -> dict:
    results: dict = {}
    async with httpx.AsyncClient(timeout=OLLAMA_DISCOVERY_TIMEOUT_S) as client:
        for label, base_url in [("primary", OLLAMA_PRIMARY_URL), ("local", OLLAMA_FALLBACK_URL)]:
            if not base_url:
                results[label] = {"status": "not_configured"}
                continue
            try:
                resp = await client.get(f"{base_url}/api/tags")
                resp.raise_for_status()
                model_names = [m["name"] for m in resp.json().get("models", [])]
                _model_cache[base_url] = model_names
                results[label] = {"url": base_url, "status": "reachable", "models": model_names}
            except Exception as e:
                _model_cache[base_url] = []
                results[label] = {"url": base_url, "status": "unreachable", "error": str(e)}

    results["fireworks"] = {
        "status": "configured" if FIREWORKS_API_KEY else "not_configured",
        "models": _FIREWORKS_MODEL_MAP,
    }

    resolved: dict = {}
    for task in TASK_MODEL_MAP:
        # Show what each tier would use
        preferred = resolve_model(task)
        fw_model  = _FIREWORKS_MODEL_MAP.get(task, _FIREWORKS_MODEL_MAP["default"])
        resolved[task] = {
            "preferred_ollama": preferred,
            "fireworks_model":  fw_model,
        }
    results["task_model_map"] = resolved
    return results
