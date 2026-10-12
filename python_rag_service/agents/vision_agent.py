"""VisionAgent: uses Qwen2.5-VL (or best available vision model) to analyse visual layout issues."""
import base64
import json
from agents.base_agent import BaseAgent
from ollama_client import ollama_generate


class VisionAgent(BaseAgent):
    agent_id = "vision_agent"
    system_prompt = (
        "You are an EPUB visual layout analysis specialist using computer vision.\n"
        "Analyse the provided EPUB page screenshot and identify:\n"
        "1. Layout overflow issues (content spilling outside margins)\n"
        "2. Font rendering problems (missing glyphs, wrong sizes)\n"
        "3. Image alignment issues\n"
        "4. Table overflow or column misalignment\n"
        "5. Accessibility: missing alt text indicators, poor contrast areas\n"
        'Return JSON: {"layout_issues": [...], "font_issues": [...], '
        '"image_issues": [...], "table_issues": [...], '
        '"accessibility_issues": [...], "overall_severity": "low|medium|high"}'
    )
    default_policies = {
        "screenshot_width":      1280,
        "screenshot_height":     960,
        "use_vision_for_complex": True,
    }

    async def analyze_image(self, image_path: str, context: str = "") -> dict:
        """Send image to the best available vision-capable model via ollama_generate."""
        try:
            with open(image_path, "rb") as f:
                img_b64 = base64.b64encode(f.read()).decode()
        except FileNotFoundError:
            return {"error": f"Image not found: {image_path}"}

        prompt = (
            f"{self.system_prompt}\n\n"
            f"Context: {context}\n\n"
            "Analyse this EPUB page screenshot."
        )

        try:
            result = await ollama_generate(
                prompt=prompt,
                task_type="vision",
                temperature=0.1,
                images=[img_b64],
            )
            text = result.get("response", "{}")
            start, end = text.find("{"), text.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(text[start:end])
            return {"raw_response": text}
        except Exception as exc:
            return {"error": f"Vision model unavailable: {exc}"}

    async def run(self, task: dict) -> dict:
        image_paths = task.get("image_paths", [])
        context     = task.get("context", "")
        results     = []
        for path in image_paths:
            analysis = await self.analyze_image(path, context)
            results.append({"image": path, "analysis": analysis})
            await self.memory.log_episode(
                agent_id=self.agent_id,
                action="visual_analysis",
                context={"image": path},
                outcome=analysis,
                run_id=task.get("run_id"),
            )
        return {"status": "ok", "visual_analyses": results}
