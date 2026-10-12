"""OrchestratorAgent: master agent that fans out tasks, manages message bus, aggregates results."""
import asyncio, uuid, time
from typing import List, Dict, Any
from agents.base_agent import BaseAgent
from agents.triage_agent import TriageAgent
from agents.validator_agent import ValidatorAgent
from agents.fixer_agent import FixerAgent
from agents.kb_agent import KBAgent
from agents.vision_agent import VisionAgent
from agents.reporter_agent import ReporterAgent
from processing.batch_processor import BatchProcessor

class OrchestratorAgent(BaseAgent):
    agent_id = "orchestrator_agent"
    system_prompt = "You are the master EPUB automation orchestrator. Coordinate all agents to process validation results."
    default_policies = {
        "parallel_agent_limit": 4,
        "enable_vision": True,
        "enable_kb": True,
        "report_always": True
    }

    def __init__(self):
        super().__init__()
        self.triage = TriageAgent()
        self.validator = ValidatorAgent()
        self.fixer = FixerAgent()
        self.kb = KBAgent()
        self.vision = VisionAgent()
        self.reporter = ReporterAgent()
        self.message_bus: asyncio.Queue = asyncio.Queue()
        self.batch_processor = BatchProcessor()

        for agent in [self.triage, self.validator, self.fixer, self.kb, self.vision, self.reporter]:
            agent.attach_bus(self.message_bus)

    async def run(self, task: dict) -> dict:
        run_id = task.get("run_id", str(uuid.uuid4())[:8])
        issues: List[dict] = task.get("issues", [])
        validation_report = task.get("validation_report", {})
        filename = task.get("filename", "document.epub")
        image_paths = task.get("image_paths", [])

        # Step 1: Triage (parallel per batch)
        triage_result = await self.triage.execute({
            "run_id": run_id,
            "action": "triage",
            "issues": issues,
            "use_llm_triage": task.get("use_llm_triage", False)
        })
        triage_list = triage_result.get("triage_results", [])

        llm_issues = [issues[i] for i, t in enumerate(triage_list) if t["routing"] == "llm" and i < len(issues)]
        hitl_issues = [issues[i] for i, t in enumerate(triage_list) if t["routing"] == "hitl" and i < len(issues)]

        # Cache hitl queue
        await self.memory.set_short(f"hitl:{run_id}", hitl_issues)

        # Step 2: KB lookup + Vision analysis in parallel
        kb_result     = {"kb_context": {}}
        vision_result = {"visual_analyses": []}

        async def _noop(val):
            return val

        parallel_tasks = []
        if llm_issues:
            parallel_tasks.append(self.kb.execute({
                "run_id": run_id, "action": "kb_lookup", "issues": llm_issues
            }))
        else:
            parallel_tasks.append(_noop(kb_result))

        if image_paths and self._policies.get("enable_vision", True):
            parallel_tasks.append(self.vision.execute({
                "run_id": run_id, "action": "visual_analysis",
                "image_paths": image_paths, "context": filename
            }))
        else:
            parallel_tasks.append(_noop(vision_result))

        gathered = await asyncio.gather(*parallel_tasks, return_exceptions=True)
        if not isinstance(gathered[0], Exception):
            kb_result = gathered[0]
        if len(gathered) > 1 and not isinstance(gathered[1], Exception):
            vision_result = gathered[1]

        # Step 3: Fix (using KB context)
        fix_result = {"fixes": [], "fixed_count": 0, "unfixable_count": 0}
        if llm_issues:
            all_context = "\n\n".join(
                v.get("context_text", "") for v in kb_result.get("kb_context", {}).values()
            )
            fix_result = await self.fixer.execute({
                "run_id": run_id, "action": "fix",
                "issues": llm_issues,
                "kb_context": all_context,
            })

        # Step 4: Validate fixes
        proposals = [
            {
                "issue": issue,
                "fix": next(
                    (f["patch"] for f in fix_result.get("fixes", []) if f["issue_id"] == issue.get("id")),
                    "",
                ),
            }
            for issue in llm_issues
        ]
        validation_result = {"validated_proposals": [], "average_confidence": 0}
        if proposals:
            validation_result = await self.validator.execute({
                "run_id": run_id, "action": "validate_fixes", "proposals": proposals
            })

        # Step 5: Generate report (vision_result already populated above)
        report_result = await self.reporter.execute({
            "run_id": run_id, "action": "generate_report",
            "filename": filename,
            "validation_report": validation_report,
            "triage_results": triage_list,
            "fix_results": fix_result,
        })

        # Log run summary
        await self.memory.long.log_run(
            run_id=run_id, filename=filename,
            issue_count=len(issues),
            fixed_count=fix_result.get("fixed_count", 0),
            hitl_count=len(hitl_issues)
        )

        return {
            "status": "ok",
            "run_id": run_id,
            "triage": triage_result,
            "kb": kb_result,
            "fixes": fix_result,
            "validation": validation_result,
            "vision": vision_result,
            "report": report_result,
            "hitl_queue": hitl_issues,
            "summary": {
                "total_issues": len(issues),
                "llm_routed": len(llm_issues),
                "hitl_routed": len(hitl_issues),
                "fixed": fix_result.get("fixed_count", 0),
                "avg_confidence": validation_result.get("average_confidence", 0)
            }
        }
