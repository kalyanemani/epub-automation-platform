import fitz  # PyMuPDF
from typing import List, Dict, Any, Optional
from pathlib import Path

try:
    import easyocr
    import numpy as np
except Exception:  # pragma: no cover - optional runtime dependency
    easyocr = None
    np = None

class DocumentExtractor:
    def __init__(self):
        self._ocr_readers = {}

    def ocr_available(self) -> bool:
        return easyocr is not None and np is not None

    def _get_ocr_reader(self, languages: List[str]):
        if not self.ocr_available():
            raise RuntimeError("easyocr and numpy are required for OCR extraction.")

        key = tuple(languages or ["en"])
        if key not in self._ocr_readers:
            self._ocr_readers[key] = easyocr.Reader(
                list(key),
                gpu=False,
                verbose=False,
                download_enabled=False,
            )

        return self._ocr_readers[key]

    @staticmethod
    def _normalize_text(value: str) -> str:
        return " ".join(str(value or "").split()).strip()

    def _group_results_into_lines(self, results: List[Any], scale: float) -> List[Dict[str, Any]]:
        boxes: List[Dict[str, Any]] = []

        for result in results:
            if not isinstance(result, (list, tuple)) or len(result) < 3:
                continue

            bbox, text, confidence = result[0], result[1], result[2]
            normalized = self._normalize_text(text)
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
            line_text = self._normalize_text(" ".join(box["text"] for box in ordered))
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

    @staticmethod
    def _render_page_to_array(page: fitz.Page, scale: float):
        matrix = fitz.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        image = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
        if pix.n == 4:
            image = image[:, :, :3]
        return image

    def extract_pdf_blocks(self, file_path: str) -> List[Dict[str, Any]]:
        """
        Extracts structural blocks from a PDF using PyMuPDF.
        This focuses on reading physical layout and mapping characters to coordinates.
        """
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        extracted_data = []
        doc = fitz.open(str(path))

        try:
            for page_num in range(len(doc)):
                page = doc[page_num]
                # Use basic blocks extraction (text + images bounding boxes)
                blocks = page.get_text("dict")["blocks"]

                page_content = {
                    "page_num": page_num + 1,
                    "width": page.rect.width,
                    "height": page.rect.height,
                    "blocks": []
                }

                for b in blocks:
                    # Type 0 is text
                    if b["type"] == 0:
                        text_content = ""
                        for line in b.get("lines", []):
                            for span in line.get("spans", []):
                                text_content += span["text"]

                        block_data = {
                            "type": "text",
                            "bbox": b["bbox"],
                            "content": text_content.strip()
                        }
                        if block_data["content"]:
                            page_content["blocks"].append(block_data)

                    # Type 1 is image
                    elif b["type"] == 1:
                        block_data = {
                            "type": "image",
                            "bbox": b["bbox"],
                            "image_ref": b.get("image", None) is not None
                        }
                        page_content["blocks"].append(block_data)

                extracted_data.append(page_content)
        finally:
            doc.close()

        return extracted_data

    def extract_pdf_ocr_pages(
        self,
        file_path: str,
        page_numbers: List[int],
        languages: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        if not self.ocr_available():
            raise RuntimeError("OCR dependencies are not installed in python_rag_service.")

        doc = fitz.open(str(path))
        reader = self._get_ocr_reader(languages or ["en"])
        scale = 2.0
        extracted_pages: List[Dict[str, Any]] = []

        try:
            for page_number in page_numbers:
                page_index = int(page_number) - 1
                if page_index < 0 or page_index >= len(doc):
                    continue

                page = doc[page_index]
                image = self._render_page_to_array(page, scale)
                results = reader.readtext(
                    image,
                    detail=1,
                    paragraph=False,
                    low_text=0.3,
                    text_threshold=0.6,
                    link_threshold=0.2,
                )
                lines = self._group_results_into_lines(results, scale)
                average_confidence = (
                    sum(line.get("confidence", 0.0) for line in lines) / max(1, len(lines))
                    if lines
                    else 0.0
                )

                extracted_pages.append(
                    {
                        "pageNumber": int(page_number),
                        "width": float(page.rect.width),
                        "height": float(page.rect.height),
                        "lines": lines,
                        "text": "\n".join(line["text"] for line in lines),
                        "averageConfidence": average_confidence,
                    }
                )
        finally:
            doc.close()

        return extracted_pages

if __name__ == "__main__":
    # Test block
    extractor = DocumentExtractor()
    print("DocumentExtractor loaded via PyMuPDF.")
