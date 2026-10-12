import json
import os
import sys
from typing import Any, Dict, List

import easyocr
import fitz
import numpy as np


def normalize_text(value: str) -> str:
    return " ".join(str(value or "").split()).strip()


def get_languages() -> List[str]:
    raw = os.environ.get("PDF_OCR_LANGS", "en")
    languages = [part.strip() for part in raw.replace(",", " ").split() if part.strip()]
    return languages or ["en"]


def group_results_into_lines(results: List[Any], scale: float) -> List[Dict[str, Any]]:
    boxes: List[Dict[str, Any]] = []

    for result in results:
        if not isinstance(result, (list, tuple)) or len(result) < 3:
            continue

        bbox, text, confidence = result[0], result[1], result[2]
        normalized = normalize_text(text)
        if not normalized:
            continue

        xs = [float(point[0]) / scale for point in bbox]
        ys = [float(point[1]) / scale for point in bbox]
        x = min(xs)
        y = min(ys)
        width = max(xs) - x
        height = max(ys) - y

        boxes.append(
            {
                "text": normalized,
                "x": x,
                "y": y,
                "width": max(1.0, width),
                "height": max(1.0, height),
                "confidence": float(confidence),
            }
        )

    boxes.sort(key=lambda entry: (entry["y"], entry["x"]))
    lines: List[Dict[str, Any]] = []

    for box in boxes:
      tolerance = max(4.0, box["height"] * 0.6)
      target_line = None

      for candidate in lines:
        if abs(candidate["y"] - box["y"]) <= tolerance:
          target_line = candidate
          break

      if target_line is None:
        target_line = {
            "y": box["y"],
            "boxes": [],
        }
        lines.append(target_line)

      target_line["boxes"].append(box)

    normalized_lines: List[Dict[str, Any]] = []

    for index, line in enumerate(sorted(lines, key=lambda entry: entry["y"]), start=1):
        ordered = sorted(line["boxes"], key=lambda entry: entry["x"])
        line_text = normalize_text(" ".join(box["text"] for box in ordered))
        if not line_text:
            continue

        x = min(box["x"] for box in ordered)
        y = min(box["y"] for box in ordered)
        max_right = max(box["x"] + box["width"] for box in ordered)
        max_bottom = max(box["y"] + box["height"] for box in ordered)
        average_confidence = (
            sum(box["confidence"] for box in ordered) / max(1, len(ordered))
        )

        normalized_lines.append(
            {
                "lineNumber": index,
                "text": line_text,
                "x": x,
                "y": y,
                "width": max(1.0, max_right - x),
                "height": max(1.0, max_bottom - y),
                "items": [],
                "confidence": average_confidence,
            }
        )

    return normalized_lines


def render_page_to_array(page: fitz.Page, scale: float) -> np.ndarray:
    matrix = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=matrix, alpha=False)
    image = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    if pix.n == 4:
      image = image[:, :, :3]
    return image


def run_ocr(pdf_path: str, page_numbers: List[int]) -> Dict[str, Any]:
    doc = fitz.open(pdf_path)
    reader = easyocr.Reader(get_languages(), gpu=False, verbose=False, download_enabled=False)
    scale = 2.0
    pages: List[Dict[str, Any]] = []

    try:
        for page_number in page_numbers:
            page_index = page_number - 1
            if page_index < 0 or page_index >= len(doc):
                continue

            page = doc[page_index]
            image = render_page_to_array(page, scale)
            results = reader.readtext(
                image,
                detail=1,
                paragraph=False,
                low_text=0.3,
                text_threshold=0.6,
                link_threshold=0.2,
            )
            lines = group_results_into_lines(results, scale)
            average_confidence = (
                sum(line.get("confidence", 0.0) for line in lines) / max(1, len(lines))
                if lines
                else 0.0
            )
            pages.append(
                {
                    "pageNumber": page_number,
                    "width": float(page.rect.width),
                    "height": float(page.rect.height),
                    "lines": lines,
                    "text": "\n".join(line["text"] for line in lines),
                    "averageConfidence": average_confidence,
                }
            )
    finally:
        doc.close()

    return {"pages": pages}


def main() -> int:
    if len(sys.argv) < 3:
        print(json.dumps({"pages": [], "error": "usage: pdf-ocr.py <pdf_path> <page_numbers_json>"}))
        return 1

    pdf_path = sys.argv[1]
    page_numbers = json.loads(sys.argv[2])
    payload = run_ocr(pdf_path, [int(page) for page in page_numbers])
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
