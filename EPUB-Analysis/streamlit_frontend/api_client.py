import json
import os
import re

import requests


NODE_BASE_URL = os.getenv("NODE_API_URL", "http://localhost:9000").strip()
PYTHON_BASE_URL = os.getenv("PYTHON_API_URL", "http://localhost:8001").strip()


class APIClient:
    @staticmethod
    def _response_text_preview(response, limit=240):
        try:
            text = (response.text or "").strip()
        except Exception:
            text = ""
        if not text:
            return "<empty response body>"
        return text[:limit]

    @staticmethod
    def _parse_json_response(response):
        try:
            return response.json()
        except ValueError as exc:
            content_type = response.headers.get("content-type", "unknown")
            body_preview = APIClient._response_text_preview(response)
            raise ValueError(
                f"Invalid JSON from {response.request.method} {response.url} "
                f"(HTTP {response.status_code}, content-type={content_type}, body={body_preview})"
            ) from exc

    @staticmethod
    def _header_int(response, name, default=0):
        raw_value = response.headers.get(name)
        if raw_value in (None, ""):
            return default
        try:
            return int(raw_value)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _filename_from_content_disposition(response, default_name="fixed.epub"):
        content_disposition = response.headers.get("content-disposition", "")
        match = re.search(r'filename="?([^";]+)"?', content_disposition, re.IGNORECASE)
        if match:
            return match.group(1).strip()
        return default_name

    @staticmethod
    def get_llm_status():
        try:
            response = requests.get(f"{NODE_BASE_URL}/llm-status")
            return response.json()
        except Exception:
            return {"ok": False, "error": "Node Server Unreachable"}

    @staticmethod
    def generate_hitl_suggestions(issues: list, epub_collection: str = "") -> dict:
        """Call /hitl-suggest to get AI suggestions for any list of HITL issues."""
        try:
            # Sanitise issues: keep only JSON-serialisable fields, ensure 'id' is present
            safe_issues = []
            for iss in issues:
                try:
                    iid = str(iss.get("id") or iss.get("rule_id") or iss.get("ruleId") or "")
                    if not iid:
                        continue
                    safe_issues.append({
                        "id":       iid,
                        "title":    str(iss.get("title") or iss.get("message") or ""),
                        "status":   str(iss.get("status") or "warn"),
                        "location": iss.get("location") or {},
                        "details":  iss.get("details") or {},
                        "suggestion": str(iss.get("suggestion") or ""),
                    })
                except Exception:
                    continue

            if not safe_issues:
                return {"_error": "no valid issues to suggest for"}

            response = requests.post(
                f"{PYTHON_BASE_URL}/hitl-suggest",
                json={"issues": safe_issues, "epub_collection": epub_collection},
                timeout=300,
            )
            if response.ok:
                data = response.json()
                return data if data else {"_error": "service returned empty response"}
            return {"_error": f"HTTP {response.status_code}: {response.text[:200]}"}
        except requests.exceptions.Timeout:
            return {"_error": "Request timed out after 5 minutes"}
        except Exception as exc:
            return {"_error": str(exc)}

    @staticmethod
    def get_textbooks():
        try:
            response = requests.get(f"{NODE_BASE_URL}/api/textbooks")
            return response.json()
        except Exception:
            return []

    @staticmethod
    def get_logs():
        try:
            response = requests.get(f"{NODE_BASE_URL}/api/logs")
            return response.json()
        except Exception:
            return []

    @staticmethod
    def register_textbook(name, filename):
        try:
            payload = {"name": name, "originalFilename": filename}
            response = requests.post(f"{NODE_BASE_URL}/api/textbooks", json=payload)
            return response.json()
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @staticmethod
    def validate_file(file_path):
        """Sends file to Node.js /validate endpoint (legacy sync path)."""
        try:
            with open(file_path, "rb") as handle:
                files = {"file": handle}
                response = requests.post(
                    f"{NODE_BASE_URL}/validate",
                    files=files,
                    timeout=180,
                )
            if not response.ok:
                try:
                    err = response.json().get("error", f"HTTP {response.status_code}")
                except Exception:
                    err = f"HTTP {response.status_code}"
                return {"ok": False, "error": err}
            data = response.json()
            if "results" not in data:
                data["results"] = []
            return data
        except requests.exceptions.Timeout:
            return {
                "ok": False,
                "error": "Validation timed out after 3 minutes. The EPUB may be very large - try reducing file size or contact support.",
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @staticmethod
    def validate_bytes(epub_bytes: bytes, filename: str = "fixed.epub") -> dict:
        """Validate an EPUB from raw bytes - used for post-fix re-validation."""
        import tempfile, os
        try:
            with tempfile.NamedTemporaryFile(suffix=".epub", delete=False) as tmp:
                tmp.write(epub_bytes)
                tmp_path = tmp.name
            result = APIClient.validate_file(tmp_path)
            return result
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    @staticmethod
    def validate_file_async(file_path, on_status=None, poll_interval=4, max_wait=7200):
        """
        Upload file to /validate-async, then poll /validate-status/:jobId until done.
        Works for any file size - no HTTP timeout on the validation itself.

        on_status: optional callable(stage: str, elapsed_s: int) for progress updates.
        max_wait:  maximum seconds to wait before giving up (default 2 hours).
        """
        import time

        started = time.time()

        def _elapsed():
            return int(time.time() - started)

        try:
            with open(file_path, "rb") as handle:
                response = requests.post(
                    f"{NODE_BASE_URL}/validate-async",
                    files={"file": handle},
                    timeout=120,
                )
            if not response.ok:
                try:
                    err = response.json().get("error", f"HTTP {response.status_code}")
                except Exception:
                    err = f"HTTP {response.status_code}"
                return {"ok": False, "error": err}

            job_id = response.json().get("jobId")
            if not job_id:
                return {"ok": False, "error": "Server did not return a job ID"}
        except Exception as exc:
            return {"ok": False, "error": f"Upload failed: {exc}"}

        deadline = time.time() + max_wait
        last_stage = ""
        consecutive_errors = 0
        MAX_CONSECUTIVE_ERRORS = 5

        while time.time() < deadline:
            time.sleep(poll_interval)
            try:
                status_resp = requests.get(
                    f"{NODE_BASE_URL}/validate-status/{job_id}",
                    timeout=120,
                )
                consecutive_errors = 0  # reset on any successful response
                if not status_resp.ok:
                    if status_resp.status_code == 404:
                        return {"ok": False, "error": "Validation job expired or not found"}
                    return {"ok": False, "error": f"Status check failed: HTTP {status_resp.status_code}"}

                payload = status_resp.json()
                stage = payload.get("stage", "")

                if stage != last_stage:
                    last_stage = stage
                    if callable(on_status):
                        on_status(stage, _elapsed())

                if payload.get("status") == "done":
                    data = payload.get("result", {})
                    if "results" not in data:
                        data["results"] = []
                    return data

                if payload.get("status") == "failed":
                    return {"ok": False, "error": payload.get("error", "Validation failed on server")}
            except requests.exceptions.RequestException as exc:
                consecutive_errors += 1
                if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                    return {"ok": False, "error": f"Polling error after {MAX_CONSECUTIVE_ERRORS} retries: {exc}"}
                # transient timeout - Node.js is busy, wait and retry
                time.sleep(poll_interval * 2)

        return {"ok": False, "error": f"Validation did not complete within {max_wait // 60} minutes"}

    @staticmethod
    def orchestrate_pipeline(issues, validation_report=None, filename="document.epub"):
        """
        Call Python /fix-proposals - lightweight: heuristic triage + parallel fixer.
        No KBAgent (ChromaDB), no VisionAgent, no ReporterAgent.
        """
        try:
            response = requests.post(
                f"{PYTHON_BASE_URL}/fix-proposals",
                json={"issues": issues, "filename": filename},
                timeout=120,
            )
            if not response.ok:
                try:
                    err = response.json().get("error", f"HTTP {response.status_code}")
                except Exception:
                    err = f"HTTP {response.status_code}"
                return {"ok": False, "error": err}
            return response.json()
        except requests.exceptions.Timeout:
            return {"ok": False, "error": "Agent scan timed out after 2 minutes"}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @staticmethod
    def download_artifact(relative_url, base_url=None, timeout=180):
        try:
            url_base = (base_url or NODE_BASE_URL).rstrip("/")
            url_path = str(relative_url or "").strip()
            if not url_path:
                return {"ok": False, "error": "Missing artifact URL"}
            if url_path.startswith(("http://", "https://")):
                url = url_path
            else:
                url = f"{url_base}{url_path if url_path.startswith('/') else '/' + url_path}"
            response = requests.get(url, timeout=timeout)
            if not response.ok:
                return {"ok": False, "error": f"HTTP {response.status_code}"}
            return {
                "ok": True,
                "content": response.content,
                "content_type": response.headers.get("content-type", "application/octet-stream"),
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @staticmethod
    def run_autofix(file_path, report):
        """Sends file and report to Node.js /autofix endpoint."""
        try:
            with open(file_path, "rb") as handle:
                files = {"file": handle}
                data = {"report": json.dumps(report) if isinstance(report, dict) else report}
                response = requests.post(
                    f"{NODE_BASE_URL}/autofix",
                    files=files,
                    data=data,
                    timeout=600,
                )
            result = response.json()
            if not response.ok:
                return {"ok": False, "error": result.get("error", f"HTTP {response.status_code}")}

            artifact = APIClient.download_artifact(
                result.get("downloadUrl", ""),
                base_url=NODE_BASE_URL,
                timeout=180,
            )
            if artifact.get("ok"):
                result["fixed_epub_bytes"] = artifact.get("content")
            else:
                result["fixed_epub_download_error"] = artifact.get(
                    "error",
                    "Download unavailable",
                )
            return result
        except requests.exceptions.Timeout:
            return {"ok": False, "error": "Autofix timed out after 10 minutes"}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @staticmethod
    def run_agent_autofix(
        file_path: str,
        issues: list,
        on_status=None,
        poll_interval: int = 5,
        max_wait: int = 1800,
    ):
        """
        POST EPUB + issues to Python /agent-autofix (async job), then poll
        /agent-autofix-status/{jobId} until done.

        on_status: optional callable(stage: str, elapsed_s: int) for progress updates.
        Returns (epub_bytes_or_None, meta_dict).
        """
        import base64
        import time

        started = time.time()

        def _elapsed():
            return int(time.time() - started)

        # -- 1. Submit the job -----------------------------------------------
        try:
            with open(file_path, "rb") as handle:
                response = requests.post(
                    f"{PYTHON_BASE_URL}/agent-autofix",
                    files={"file": (os.path.basename(file_path), handle, "application/epub+zip")},
                    data={"issues": json.dumps(issues)},
                    timeout=300,
                )
            if not response.ok:
                try:
                    err = APIClient._parse_json_response(response).get("detail", f"HTTP {response.status_code}")
                except Exception:
                    err = f"HTTP {response.status_code}: {APIClient._response_text_preview(response)}"
                return None, {"ok": False, "error": err}
            job_id = response.json().get("jobId")
            if not job_id:
                return None, {"ok": False, "error": "Server did not return a job ID"}
        except Exception as exc:
            return None, {"ok": False, "error": f"Failed to submit autofix job: {exc}"}

        # -- 2. Poll for completion ------------------------------------------
        # Status endpoint no longer returns epub_b64 (stripped server-side
        # to keep responses small). Fetch the EPUB separately on done.
        deadline           = time.time() + max_wait
        last_stage         = ""
        consecutive_errors = 0
        MAX_CONSECUTIVE_ERRORS = 8

        while time.time() < deadline:
            time.sleep(poll_interval)
            try:
                status_resp = requests.get(
                    f"{PYTHON_BASE_URL}/agent-autofix-status/{job_id}",
                    timeout=120,   # was 30 - status response is now lightweight
                )
                consecutive_errors = 0  # reset on any successful response
                if not status_resp.ok:
                    if status_resp.status_code == 404:
                        return None, {"ok": False, "error": "Autofix job expired or not found"}
                    return None, {"ok": False, "error": f"Status check failed: HTTP {status_resp.status_code}"}

                payload = status_resp.json()
                stage   = payload.get("stage", "")

                if stage != last_stage:
                    last_stage = stage
                    if callable(on_status):
                        on_status(stage, _elapsed())

                job_status = payload.get("status", "running")

                if job_status == "done":
                    data  = payload.get("result", {})
                    stats = data.get("stats", {})

                    # Fetch the fixed EPUB. Always try the download endpoint
                    # (works with new backend that strips epub_b64 from status
                    # and with old backends that still include it). Fall back
                    # to decoding epub_b64 inline if the endpoint is unavailable.
                    epub_bytes = None
                    try:
                        dl_resp = requests.get(
                            f"{PYTHON_BASE_URL}/agent-autofix-download/{job_id}",
                            timeout=180,
                        )
                        if dl_resp.ok:
                            epub_bytes = dl_resp.content
                    except Exception:
                        pass
                    if epub_bytes is None and data.get("epub_b64"):
                        import base64 as _b64
                        try:
                            epub_bytes = _b64.b64decode(data["epub_b64"])
                        except Exception:
                            pass

                    return epub_bytes, {
                        "ok":               True,
                        "applied":          stats.get("applied", 0),
                        "auto_applied":     stats.get("auto_applied", 0),
                        "llm_applied":      stats.get("llm_applied", 0),
                        "det_applied":      stats.get("det_applied", 0),
                        "failed":           stats.get("failed", 0),
                        "attempted":        stats.get("attempted", 0),
                        "total_issues":     stats.get("total_issues", 0),
                        "auto_issues":      stats.get("auto_issues", 0),
                        "llm_issues":       stats.get("llm_issues", 0),
                        "hitl_issues":      stats.get("hitl_issues", 0),
                        "unique_rules":     stats.get("unique_rules", 0),
                        "cache_hits":       stats.get("cache_hits", 0),
                        "run_id":           data.get("run_id", ""),
                        "filename":         data.get("filename", "fixed.epub"),
                        "triage":           data.get("triage", []),
                        "fix_trace":        data.get("fix_trace", []),
                        "diffs":            data.get("diffs", []),
                        "hitl_suggestions": data.get("hitl_suggestions", {}),
                    }

                if job_status == "failed":
                    return None, {"ok": False, "error": payload.get("error", "Autofix failed on server")}

            except requests.exceptions.RequestException as exc:
                consecutive_errors += 1
                if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                    return None, {"ok": False, "error": f"Polling failed after {MAX_CONSECUTIVE_ERRORS} retries: {exc}"}
                # transient connection drop - server busy with LLM, wait and retry
                time.sleep(poll_interval * 2)

        return None, {"ok": False, "error": f"Autofix did not complete within {max_wait // 60} minutes"}

    @staticmethod
    def run_agent_autofix_stream(
        file_path: str,
        issues: list,
        on_event=None,
        max_wait: int = 3600,
    ):
        """
        Submit autofix job then consume the SSE /stream/autofix/{jobId} endpoint
        for real-time per-second progress updates.
        on_event: callable(event_dict) called on every SSE data frame.
        Returns (epub_bytes_or_None, meta_dict).
        """
        import base64
        import time

        # Submit job
        try:
            with open(file_path, "rb") as handle:
                response = requests.post(
                    f"{PYTHON_BASE_URL}/agent-autofix",
                    files={"file": (os.path.basename(file_path), handle, "application/epub+zip")},
                    data={"issues": json.dumps(issues)},
                    timeout=300,
                )
            if not response.ok:
                return None, {"ok": False, "error": f"Submit failed HTTP {response.status_code}"}
            job_id = response.json().get("jobId")
            if not job_id:
                return None, {"ok": False, "error": "No jobId returned"}
        except Exception as exc:
            return None, {"ok": False, "error": str(exc)}

        # Consume SSE stream (1-second granularity)
        deadline = time.time() + max_wait
        try:
            with requests.get(
                f"{PYTHON_BASE_URL}/stream/autofix/{job_id}",
                stream=True,
                timeout=(10, max_wait),
            ) as stream_resp:
                for raw_line in stream_resp.iter_lines():
                    if time.time() > deadline:
                        break
                    if not raw_line:
                        continue
                    line = raw_line.decode("utf-8") if isinstance(raw_line, bytes) else raw_line
                    if line.startswith("data: "):
                        try:
                            event = json.loads(line[6:])
                            if callable(on_event):
                                on_event(event)
                            if event.get("status") == "done":
                                # Fetch metadata (epub_b64 stripped server-side)
                                status_resp = requests.get(
                                    f"{PYTHON_BASE_URL}/agent-autofix-status/{job_id}",
                                    timeout=120,
                                )
                                data  = status_resp.json().get("result", {})
                                stats = data.get("stats", {})
                                # Fetch fixed EPUB - always try download endpoint,
                                # fall back to epub_b64 inline if unavailable.
                                epub_bytes = None
                                try:
                                    dl_resp = requests.get(
                                        f"{PYTHON_BASE_URL}/agent-autofix-download/{job_id}",
                                        timeout=180,
                                    )
                                    if dl_resp.ok:
                                        epub_bytes = dl_resp.content
                                except Exception:
                                    pass
                                if epub_bytes is None and data.get("epub_b64"):
                                    import base64 as _b64
                                    try:
                                        epub_bytes = _b64.b64decode(data["epub_b64"])
                                    except Exception:
                                        pass
                                return epub_bytes, {
                                    "ok": True,
                                    "applied": stats.get("applied", 0),
                                    "auto_applied": stats.get("auto_applied", 0),
                                    "llm_applied": stats.get("llm_applied", 0),
                                    "det_applied": stats.get("det_applied", 0),
                                    "failed": stats.get("failed", 0),
                                    "attempted": stats.get("attempted", 0),
                                    "total_issues": stats.get("total_issues", 0),
                                    "auto_issues": stats.get("auto_issues", 0),
                                    "llm_issues": stats.get("llm_issues", 0),
                                    "hitl_issues": stats.get("hitl_issues", 0),
                                    "unique_rules": stats.get("unique_rules", 0),
                                    "cache_hits": stats.get("cache_hits", 0),
                                    "run_id": data.get("run_id", job_id),
                                    "filename": data.get("filename", "fixed.epub"),
                                    "triage": data.get("triage", []),
                                    "fix_trace": data.get("fix_trace", []),
                                    "diffs": data.get("diffs", []),
                                    "hitl_suggestions": data.get("hitl_suggestions", {}),
                                    "timing": data.get("timing", {}),
                                }
                            if event.get("status") == "failed":
                                return None, {"ok": False, "error": event.get("error", "Autofix failed")}
                        except (json.JSONDecodeError, KeyError):
                            continue
        except requests.exceptions.ReadTimeout:
            return None, {"ok": False, "error": "SSE stream timed out"}
        except Exception as exc:
            # Fall back to polling if SSE fails
            return APIClient.run_agent_autofix(file_path, issues, max_wait=max_wait)

        return None, {"ok": False, "error": "Autofix stream ended without result"}

    @staticmethod
    def submit_bulk_autofix(
        file_paths: list,
        issues_map: dict,
    ) -> dict:
        """
        Submit multiple EPUB files for parallel autofix.
        issues_map: {filename: [issues_list]}
        Returns {"batch_size": N, "jobs": [{jobId, filename, ...}]}
        """
        try:
            file_handles = []
            files_param = []
            for fp in file_paths:
                name = os.path.basename(fp)
                fh = open(fp, "rb")
                file_handles.append(fh)
                files_param.append(("files", (name, fh, "application/epub+zip")))

            response = requests.post(
                f"{PYTHON_BASE_URL}/bulk-agent-autofix",
                files=files_param,
                data={"issues_map": json.dumps(issues_map)},
                timeout=300,
            )
            for fh in file_handles:
                fh.close()
            if response.ok:
                return response.json()
            return {"error": f"HTTP {response.status_code}: {response.text[:200]}"}
        except Exception as exc:
            return {"error": str(exc)}

    @staticmethod
    def poll_bulk_jobs(jobs: list, on_update=None, poll_interval: int = 2, max_wait: int = 3600):
        """
        Poll multiple autofix jobs in parallel until all complete.
        jobs: list of {jobId, filename}
        on_update: callable(job_id, stage, status) for progress updates
        Returns dict {jobId: result_dict}
        """
        import base64
        import time

        results = {}
        pending = {j["jobId"]: j for j in jobs if "jobId" in j}
        deadline = time.time() + max_wait

        while pending and time.time() < deadline:
            time.sleep(poll_interval)
            done_ids = []
            for job_id, job_meta in pending.items():
                try:
                    r = requests.get(
                        f"{PYTHON_BASE_URL}/agent-autofix-status/{job_id}",
                        timeout=15,
                    )
                    if not r.ok:
                        continue
                    payload = r.json()
                    status  = payload.get("status", "running")
                    stage   = payload.get("stage", "")
                    if callable(on_update):
                        on_update(job_id, stage, status)
                    if status == "done":
                        data = payload.get("result", {})
                        epub_bytes = base64.b64decode(data.get("epub_b64", "")) if data.get("epub_b64") else None
                        stats = data.get("stats", {})
                        results[job_id] = {
                            "ok": True,
                            "filename": job_meta.get("filename", ""),
                            "epub_bytes": epub_bytes,
                            "applied": stats.get("applied", 0),
                            "total_issues": stats.get("total_issues", 0),
                            "llm_applied": stats.get("llm_applied", 0),
                            "auto_applied": stats.get("auto_applied", 0),
                            "failed": stats.get("failed", 0),
                            "fix_trace": data.get("fix_trace", []),
                        }
                        done_ids.append(job_id)
                    elif status == "failed":
                        results[job_id] = {
                            "ok": False,
                            "filename": job_meta.get("filename", ""),
                            "error": payload.get("error", "Failed"),
                        }
                        done_ids.append(job_id)
                except Exception:
                    continue
            for jid in done_ids:
                pending.pop(jid, None)

        # Any still-pending are timeouts
        for jid in pending:
            results[jid] = {"ok": False, "filename": pending[jid].get("filename", ""), "error": "Timed out"}
        return results

    @staticmethod
    def apply_hitl_suggestion(job_id: str, issue_id: str):
        """
        Ask the Python service to apply a stored HITL AI suggestion to the fixed EPUB.
        Returns dict with ok, epub_b64, filename, applied, diffs.
        """
        import base64
        try:
            response = requests.post(
                f"{PYTHON_BASE_URL}/agent-autofix-apply-hitl",
                json={"job_id": job_id, "issue_id": issue_id},
                timeout=120,
            )
            if not response.ok:
                try:
                    err = response.json().get("detail", f"HTTP {response.status_code}")
                except Exception:
                    err = f"HTTP {response.status_code}"
                return {"ok": False, "error": err}
            data = response.json()
            if data.get("epub_b64"):
                data["epub_bytes"] = base64.b64decode(data["epub_b64"])
            return data
        except requests.exceptions.Timeout:
            return {"ok": False, "error": "Apply timed out after 2 minutes"}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @staticmethod
    def get_history(textbook_id):
        try:
            response = requests.get(f"{NODE_BASE_URL}/api/history/{textbook_id}")
            return response.json()
        except Exception:
            return []
