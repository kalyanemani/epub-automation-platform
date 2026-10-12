"""
Ollama configuration module for the Python RAG microservice.
Mirrors the Node.js dual-endpoint and task-based model routing behavior.
"""

import logging
import os
import time
from pathlib import Path

import httpx


LOGGER = logging.getLogger("uvicorn.error")


def load_repo_env() -> None:
    """Load the repo-level .env without overriding real process env vars."""
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


load_repo_env()

OLLAMA_PRIMARY_URL = os.getenv("OLLAMA_PRIMARY_URL", "http://127.0.0.1:11434")
OLLAMA_FALLBACK_URL = os.getenv("OLLAMA_FALLBACK_URL", "http://127.0.0.1:11434")
OLLAMA_TIMEOUT_S = int(os.getenv("OLLAMA_TIMEOUT_S", "120"))
OLLAMA_DIAGNOSTIC_TIMEOUT_S = int(os.getenv("OLLAMA_DIAGNOSTIC_TIMEOUT_S", "12"))
OLLAMA_DIAGNOSTIC_PROMPT = os.getenv("OLLAMA_DIAGNOSTIC_PROMPT", "Reply with OK.")
OLLAMA_MODEL_LIGHT = os.getenv("OLLAMA_MODEL_LIGHT", "")

TASK_MODEL_MAP = {
    "vision": os.getenv("OLLAMA_MODEL_VISION", "qwen2.5vl:7b"),
    "reasoning": os.getenv("OLLAMA_MODEL_REASONING", "qwen3:14b"),
    "structured": os.getenv("OLLAMA_MODEL_STRUCTURED", "qwen2.5:7b"),
    "codegen": os.getenv("OLLAMA_MODEL_CODEGEN", "qwen3-coder:30b"),
    "default": os.getenv("OLLAMA_MODEL", "qwen2.5:7b"),
}


def normalize_model_name(value: str) -> str:
    return str(value or "").strip().lower()


def normalize_url(value: str) -> str:
    return str(value or "").strip().rstrip("/")


def unique_non_empty(values) -> list[str]:
    seen = set()
    result = []
    for value in values:
        text = str(value or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


def format_error(error: Exception) -> str:
    message = str(error).strip()
    return message or error.__class__.__name__


def model_aliases(name: str) -> list[str]:
    normalized = normalize_model_name(name)
    if not normalized:
        return []

    aliases = {normalized}
    without_path = normalized.split("/")[-1]
    without_tag = without_path.split(":")[0]
    aliases.add(without_path)
    aliases.add(without_tag)
    return [alias for alias in aliases if alias]


def model_matches_preferred(available_model: str, preferred_model: str) -> bool:
    available_aliases = model_aliases(available_model)
    preferred_aliases = model_aliases(preferred_model)
    return any(
        available == preferred
        or available.startswith(f"{preferred}:")
        or preferred.startswith(f"{available}:")
        for preferred in preferred_aliases
        for available in available_aliases
    )


def resolve_model(task_type: str = "default") -> str:
    return TASK_MODEL_MAP.get(task_type, TASK_MODEL_MAP["default"])


def score_model_for_task(task_type: str, model_name: str) -> int:
    normalized = normalize_model_name(model_name)
    if not normalized:
        return -100

    vision_hints = ["vl", "vision", "llava", "bakllava", "moondream", "minicpm"]
    code_hints = ["coder", "code", "codellama", "starcoder", "deepseek-coder"]
    reasoning_hints = ["qwen3", "deepseek-r1", "qwq", "llama3", "mistral", "phi4"]
    light_hints = ["3b", "1.5b", "2b", "mini", "small"]
    is_vision = any(hint in normalized for hint in vision_hints)
    is_code = any(hint in normalized for hint in code_hints)
    is_reasoning = any(hint in normalized for hint in reasoning_hints)
    is_embedding = "embed" in normalized

    score = 0
    if is_embedding:
        score -= 100

    normalized_task = str(task_type or "default").lower()
    if normalized_task == "vision":
        score += 30 if is_vision else -10
        score += 2 if is_reasoning else 0
    elif normalized_task == "codegen":
        score += 25 if is_code else -4
        score += 2 if is_reasoning else 0
    elif normalized_task == "reasoning":
        score += 16 if is_reasoning else 0
        score += -2 if is_code else 0
        score += -4 if is_vision else 0
    elif normalized_task == "structured":
        score += -5 if is_vision else 0
        score += 1 if is_code else 0
        score += 4 if "qwen" in normalized else 0
        score += 3 if "llama" in normalized else 0
        score += 2 if "phi" in normalized else 0
    else:
        score += -4 if is_vision else 0
        score += -1 if is_code else 0
        score += 4 if is_reasoning else 0

    score += 1 if any(hint in normalized for hint in light_hints) else 0
    return score


def build_model_cascade(task_type: str = "default", preferred_model: str = "") -> list[str]:
    return unique_non_empty(
        [
            preferred_model,
            resolve_model(task_type),
            OLLAMA_MODEL_LIGHT,
            TASK_MODEL_MAP["default"],
        ]
    )


def build_configured_model_checks(available_models: list[str]) -> list[dict]:
    checks = []
    for task_type, configured_model in TASK_MODEL_MAP.items():
        matched_models = unique_non_empty(
            [
                available_model
                for available_model in available_models
                if model_matches_preferred(available_model, configured_model)
            ]
        )
        checks.append(
            {
                "task_type": task_type,
                "configured_model": configured_model,
                "present": bool(matched_models),
                "matched_models": matched_models,
            }
        )
    return checks


def build_resolved_task_models(available_models: list[str]) -> list[dict]:
    resolved = []
    for task_type, configured_model in TASK_MODEL_MAP.items():
        matched_models = unique_non_empty(
            [
                available_model
                for available_model in available_models
                if model_matches_preferred(available_model, configured_model)
            ]
        )
        adaptive_candidates = rank_available_models(
            [
                model_name
                for model_name in available_models
                if model_name not in matched_models
            ],
            task_type,
        )
        selected_model = matched_models[0] if matched_models else (adaptive_candidates[0] if adaptive_candidates else "")
        resolved.append(
            {
                "task_type": task_type,
                "configured_model": configured_model,
                "matched_models": matched_models,
                "selected_model": selected_model,
                "selected_from": "configured"
                if matched_models
                else ("adaptive" if selected_model else "unavailable"),
                "present": bool(selected_model),
                "adaptive_candidates": [] if matched_models else adaptive_candidates[:3],
            }
        )
    return resolved


def unique_configured_models() -> list[str]:
    return unique_non_empty(TASK_MODEL_MAP.values())


def endpoint_definitions() -> list[tuple[str, str]]:
    definitions = []
    seen = set()
    for label, raw_url in [("primary", OLLAMA_PRIMARY_URL), ("fallback", OLLAMA_FALLBACK_URL)]:
        normalized_url = normalize_url(raw_url)
        if not normalized_url or normalized_url in seen:
            continue
        seen.add(normalized_url)
        definitions.append((label, normalized_url))
    return definitions


async def fetch_ollama_models(client: httpx.AsyncClient, base_url: str) -> list[str]:
    response = await client.get(f"{base_url}/api/tags")
    response.raise_for_status()
    data = response.json()
    return unique_non_empty([model.get("name") for model in data.get("models", [])])


def rank_available_models(available_models: list[str], task_type: str) -> list[str]:
    ranked = [
        {
            "name": model_name,
            "score": score_model_for_task(task_type, model_name),
        }
        for model_name in available_models
    ]
    return [
        entry["name"]
        for entry in sorted(ranked, key=lambda entry: entry["score"], reverse=True)
        if entry["score"] > -20
    ]


async def resolve_endpoint_model_options(
    client: httpx.AsyncClient,
    base_url: str,
    preferred_models: list[str],
    task_type: str,
) -> dict:
    normalized_base_url = normalize_url(base_url)
    try:
        available_models = await fetch_ollama_models(client, normalized_base_url)
        preferred_matches = []
        for preferred_model in preferred_models:
            preferred_matches.extend(
                [
                    available_model
                    for available_model in available_models
                    if model_matches_preferred(available_model, preferred_model)
                ]
            )

        fallback_models = rank_available_models(
            [
                model_name
                for model_name in available_models
                if model_name not in preferred_matches
            ],
            task_type,
        )
        return {
            "base_url": normalized_base_url,
            "preferred_matches": unique_non_empty(preferred_matches),
            "fallback_models": unique_non_empty(fallback_models),
        }
    except Exception as error:  # noqa: BLE001
        LOGGER.warning(
            "[LLM] Ollama model discovery failed at %s: %s",
            normalized_base_url,
            format_error(error),
        )
        return {
            "base_url": normalized_base_url,
            "preferred_matches": [],
            "fallback_models": [],
        }


async def build_attempt_plans(
    client: httpx.AsyncClient,
    preferred_models: list[str],
    task_type: str,
) -> list[dict]:
    normalized_primary_url = normalize_url(OLLAMA_PRIMARY_URL)
    endpoint_options = []
    for _, base_url in endpoint_definitions():
        endpoint_options.append(
            await resolve_endpoint_model_options(
                client=client,
                base_url=base_url,
                preferred_models=preferred_models,
                task_type=task_type,
            )
        )

    plans = []
    seen = set()
    for option in endpoint_options:
        for model_name in [*option["preferred_matches"], *option["fallback_models"]]:
            key = (option["base_url"], model_name)
            if key in seen:
                continue
            seen.add(key)
            plans.append(
                {
                    "endpoint": option["base_url"],
                    "model": model_name,
                    "used_fallback_endpoint": option["base_url"] != normalized_primary_url,
                    "used_fallback_model": model_name not in option["preferred_matches"],
                }
            )

    if plans:
        return plans

    return [
        {
            "endpoint": normalize_url(base_url),
            "model": model_name,
            "used_fallback_endpoint": normalize_url(base_url) != normalized_primary_url,
            "used_fallback_model": False,
        }
        for _, base_url in endpoint_definitions()
        for model_name in preferred_models
    ]


async def probe_generation(client: httpx.AsyncClient, base_url: str, model: str) -> dict:
    started_at = time.perf_counter()
    response = await client.post(
        f"{base_url}/api/generate",
        timeout=min(OLLAMA_TIMEOUT_S, 30),
        json={
            "model": model,
            "prompt": OLLAMA_DIAGNOSTIC_PROMPT,
            "stream": False,
            "keep_alive": "0s",
            "options": {
                "temperature": 0,
                "num_predict": 8,
            },
        },
    )
    response.raise_for_status()
    data = response.json()
    text = str(data.get("response", "")).strip()
    if not text:
        raise RuntimeError(f"Empty response from {base_url} using model {model}")

    return {
        "model": model,
        "ok": True,
        "latency_ms": int((time.perf_counter() - started_at) * 1000),
        "response_preview": text[:80],
    }


async def ollama_generate(prompt: str, task_type: str = "default", temperature: float = 0.2) -> dict:
    """
    Send a prompt to Ollama with dual-endpoint cascade.
    Returns: {"response": str, "model": str, "endpoint_used": str}
    """
    preferred_models = build_model_cascade(task_type=task_type)

    async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT_S) as client:
        plans = await build_attempt_plans(client, preferred_models, task_type)
        last_error = None
        for index, plan in enumerate(plans):
            payload = {
                "model": plan["model"],
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": temperature},
            }
            try:
                resp = await client.post(f"{plan['endpoint']}/api/generate", json=payload)
                resp.raise_for_status()
                data = resp.json()
                response_text = str(data.get("response", "")).strip()
                if not response_text:
                    raise RuntimeError(
                        f"Empty response from {plan['endpoint']} using model {plan['model']}"
                    )
                fallback_reasons = unique_non_empty(
                    [
                        "fallback_endpoint" if plan["used_fallback_endpoint"] else "",
                        "fallback_model" if plan["used_fallback_model"] else "",
                        "retry_after_failure" if index > 0 else "",
                    ]
                )
                return {
                    "response": response_text,
                    "model": plan["model"],
                    "endpoint_used": plan["endpoint"],
                    "task_type": task_type,
                    "fallback_used": bool(fallback_reasons),
                    "fallback_reason": ",".join(fallback_reasons),
                    "attempt_count": index + 1,
                }
            except Exception as error:  # noqa: BLE001
                last_error = error
                LOGGER.warning(
                    "[LLM] Ollama at %s with model %s failed: %s, trying next...",
                    plan["endpoint"],
                    plan["model"],
                    format_error(error),
                )

    raise RuntimeError(f"All Ollama endpoints failed. Last error: {format_error(last_error)}")


async def ollama_health(include_generate_probe: bool = False) -> dict:
    """Check reachability and model availability across primary and fallback Ollama."""
    diagnostics = []
    primary_healthy = False
    async with httpx.AsyncClient(timeout=min(OLLAMA_DIAGNOSTIC_TIMEOUT_S, OLLAMA_TIMEOUT_S)) as client:
        for label, base_url in endpoint_definitions():
            try:
                model_names = await fetch_ollama_models(client, base_url)
                configured_model_checks = build_configured_model_checks(model_names)
                resolved_task_models = build_resolved_task_models(model_names)
                present_count = sum(
                    1 for check in configured_model_checks if check["present"]
                )
                resolved_count = sum(
                    1 for check in resolved_task_models if check["present"]
                )
                endpoint_diagnostics = {
                    "label": label,
                    "url": base_url,
                    "status": "reachable",
                    "models": model_names,
                    "configured_model_checks": configured_model_checks,
                    "configured_model_summary": {
                        "present_count": present_count,
                        "total_count": len(configured_model_checks),
                        "all_present": present_count == len(configured_model_checks),
                    },
                    "resolved_task_models": resolved_task_models,
                    "resolved_task_summary": {
                        "present_count": resolved_count,
                        "total_count": len(resolved_task_models),
                        "all_present": resolved_count == len(resolved_task_models),
                    },
                }

                if include_generate_probe:
                    if label == "primary" or not primary_healthy:
                        models_to_probe = unique_non_empty(
                            [
                                check["selected_model"]
                                for check in resolved_task_models
                                if check["present"]
                            ]
                        )
                    else:
                        models_to_probe = []

                    endpoint_diagnostics["generate_probes"] = []
                    for model_name in models_to_probe:
                        try:
                            endpoint_diagnostics["generate_probes"].append(
                                await probe_generation(client, base_url, model_name)
                            )
                        except Exception as error:  # noqa: BLE001
                            endpoint_diagnostics["generate_probes"].append(
                                {
                                    "model": model_name,
                                    "ok": False,
                                    "error": format_error(error),
                                }
                            )

                if label == "primary":
                    failed_probe = include_generate_probe and any(
                        not probe["ok"]
                        for probe in endpoint_diagnostics.get("generate_probes", [])
                    )
                    primary_healthy = (
                        endpoint_diagnostics["resolved_task_summary"]["all_present"]
                        and not failed_probe
                    )

                diagnostics.append(endpoint_diagnostics)
            except Exception as error:  # noqa: BLE001
                diagnostics.append(
                    {
                        "label": label,
                        "url": base_url,
                        "status": "unreachable",
                        "error": format_error(error),
                        "models": [],
                        "configured_model_checks": build_configured_model_checks([]),
                        "configured_model_summary": {
                            "present_count": 0,
                            "total_count": len(TASK_MODEL_MAP),
                            "all_present": False,
                        },
                        "resolved_task_models": build_resolved_task_models([]),
                        "resolved_task_summary": {
                            "present_count": 0,
                            "total_count": len(TASK_MODEL_MAP),
                            "all_present": False,
                        },
                    }
                )

    primary = next((entry for entry in diagnostics if entry["label"] == "primary"), None)
    fallback = next((entry for entry in diagnostics if entry["label"] == "fallback"), None)

    if primary and primary["status"] == "reachable" and primary["configured_model_summary"]["all_present"]:
        overall_status = "primary_ready"
    elif primary and primary["status"] == "reachable" and primary["resolved_task_summary"]["all_present"]:
        overall_status = "primary_adaptive_ready"
    elif fallback and fallback["status"] == "reachable" and fallback["configured_model_summary"]["all_present"]:
        overall_status = "fallback_ready"
    elif fallback and fallback["status"] == "reachable" and fallback["resolved_task_summary"]["all_present"]:
        overall_status = "fallback_adaptive_ready"
    else:
        overall_status = "degraded"

    return {
        "primary_preferred": bool(endpoint_definitions()) and endpoint_definitions()[0][0] == "primary",
        "primary_url": normalize_url(OLLAMA_PRIMARY_URL),
        "fallback_url": normalize_url(OLLAMA_FALLBACK_URL),
        "task_model_map": TASK_MODEL_MAP,
        "endpoints": diagnostics,
        "overall_status": overall_status,
    }


async def log_ollama_diagnostics() -> dict:
    """Emit startup-friendly Ollama diagnostics to stdout."""
    diagnostics = await ollama_health(include_generate_probe=True)
    LOGGER.info(
        "[LLM DIAG] primary_first=%s primary=%s fallback=%s overall=%s",
        diagnostics["primary_preferred"],
        diagnostics["primary_url"],
        diagnostics["fallback_url"],
        diagnostics["overall_status"],
    )

    for endpoint in diagnostics["endpoints"]:
        summary = endpoint["configured_model_summary"]
        LOGGER.info(
            "[LLM DIAG] %s status=%s url=%s configured_models=%s/%s",
            endpoint["label"],
            endpoint["status"],
            endpoint["url"],
            summary["present_count"],
            summary["total_count"],
        )
        for check in endpoint["configured_model_checks"]:
            matches = ",".join(check["matched_models"]) if check["matched_models"] else "none"
            LOGGER.info(
                "[LLM DIAG] %s task=%s configured=%s present=%s matches=%s",
                endpoint["label"],
                check["task_type"],
                check["configured_model"],
                check["present"],
                matches,
            )
        for check in endpoint.get("resolved_task_models", []):
            LOGGER.info(
                "[LLM DIAG] %s resolved task=%s selected=%s source=%s",
                endpoint["label"],
                check["task_type"],
                check.get("selected_model", "") or "none",
                check.get("selected_from", "unavailable"),
            )
        for probe in endpoint.get("generate_probes", []):
            LOGGER.info(
                "[LLM DIAG] %s generate model=%s ok=%s latency_ms=%s preview=%s",
                endpoint["label"],
                probe["model"],
                probe["ok"],
                probe.get("latency_ms", 0),
                probe.get("response_preview") or probe.get("error", ""),
            )

    return diagnostics
