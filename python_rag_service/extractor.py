import fitz  # PyMuPDF
from bs4 import BeautifulSoup
from typing import List, Dict, Any
from pathlib import Path
import json

class DocumentExtractor:
    def __init__(self):
        pass

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
        
        for page_num in range(len(doc)):
            page = doc[page_num]
            blocks = page.get_text("dict")["blocks"]
            
            page_content = {
                "page_num": page_num + 1,
                "width": page.rect.width,
                "height": page.rect.height,
                "blocks": []
            }
            
            for b in blocks:
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
                        
                elif b["type"] == 1:
                    block_data = {
                        "type": "image",
                        "bbox": b["bbox"],
                        "image_ref": b.get("image", None) is not None
                    }
                    page_content["blocks"].append(block_data)
                    
            extracted_data.append(page_content)
            
        return extracted_data

    def extract_html_semantic_blocks(self, file_path: str) -> List[Dict[str, Any]]:
        """
        Extracts semantic layout data from HTML/XHTML (EPUB chapters).
        Instead of physical coordinates, chunks are separated by semantic regions.
        """
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        extracted_data = []
        with open(path, "r", encoding="utf-8") as f:
            soup = BeautifulSoup(f.read(), "lxml")

        # Extract semantic chunks based on flow hierarchy (H1, H2, table, section)
        for element in soup.find_all(['h1', 'h2', 'h3', 'p', 'table', 'img', 'div']):
            block_content = element.get_text(separator=' ', strip=True)
            
            block_data = {
                "tag_name": element.name,
                "classes": element.get('class', []),
                "id": element.get('id', None),
                "type": "text" if element.name != 'img' else "image",
                "content": block_content
            }
            
            if element.name == 'img':
                block_data["alt"] = element.get('alt', '')
                block_data["src"] = element.get('src', '')

            if block_data["content"] or element.name == 'img':
                extracted_data.append(block_data)
                
        return extracted_data

if __name__ == "__main__":
    extractor = DocumentExtractor()
    print("DocumentExtractor loaded with PyMuPDF and BeautifulSoup.")
