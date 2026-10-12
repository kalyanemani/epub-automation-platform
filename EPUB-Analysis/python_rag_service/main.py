import asyncio
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
import uvicorn
import shutil
import os
import json
import tempfile
from pathlib import Path
from pydantic import BaseModel

from ollama_client import (
    ollama_health,
    TASK_MODEL_MAP,
    OLLAMA_PRIMARY_URL,
    OLLAMA_FALLBACK_URL,
    log_ollama_diagnostics,
)
from extractor import DocumentExtractor
from rag_engine import RagPipelineEngine

app = FastAPI(
    title="Advanced RAG Document QA Service",
    description="Python microservice for PDF/EPUB extraction, advanced structural chunking, and dense embeddings",
    version="1.0.0"
)

# Initialize engines on startup (BGE-M3 models)
extractor = DocumentExtractor()
rag_engine = RagPipelineEngine()

class CompareRequest(BaseModel):
    text1: str
    text2: str


def is_pdf_filename(filename: str) -> bool:
    return Path(str(filename or "")).suffix.lower() == ".pdf"


def create_temp_pdf_path(prefix: str, filename: str) -> str:
    safe_name = Path(str(filename or "document.pdf")).name
    suffix = Path(safe_name).suffix or ".pdf"
    handle = tempfile.NamedTemporaryFile(
        delete=False,
        prefix=prefix,
        suffix=suffix,
    )
    handle.close()
    return handle.name


def parse_page_numbers_payload(page_numbers: str):
    try:
        payload = json.loads(page_numbers)
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=400, detail=f"Invalid page_numbers JSON: {error}") from error

    if not isinstance(payload, list):
        raise HTTPException(status_code=400, detail="page_numbers must be a JSON array of positive integers.")

    parsed_pages = []
    for value in payload:
        try:
            page_number = int(value)
        except (TypeError, ValueError) as error:
            raise HTTPException(
                status_code=400,
                detail="page_numbers must contain only positive integers.",
            ) from error

        if page_number <= 0:
            raise HTTPException(
                status_code=400,
                detail="page_numbers must contain only positive integers.",
            )

        parsed_pages.append(page_number)

    return parsed_pages

@app.on_event("startup")
async def startup_event():
    # Pre-load the BGE-M3 model so inference is fast
    rag_engine.initialize_models(raise_on_error=False)
    asyncio.create_task(log_ollama_diagnostics())

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "python_rag_service",
        "embedding_model_loaded": rag_engine.model_available(),
        "embedding_model_error": rag_engine.initialization_error,
        "ocr_available": extractor.ocr_available(),
    }

@app.get("/llm-status")
async def llm_status(probe: bool = False):
    """Check reachability of both Ollama endpoints and return the task-model routing map."""
    return await ollama_health(include_generate_probe=probe)

@app.post("/extract-pdf")
async def extract_pdf(file: UploadFile = File(...)):
    """Receives a PDF and returns physical bounding box blocks and text"""
    if not is_pdf_filename(file.filename):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    temp_path = create_temp_pdf_path("extract_pdf_", file.filename)
    try:
        with open(temp_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
            
        blocks = extractor.extract_pdf_blocks(temp_path)
        return {"status": "success", "filename": file.filename, "pages": blocks}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

@app.post("/extract-pdf-ocr")
async def extract_pdf_ocr(
    file: UploadFile = File(...),
    page_numbers: str = Form(...),
    languages: str = Form("en"),
):
    """Receives a PDF and returns OCR text only for the requested pages."""
    if not is_pdf_filename(file.filename):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    if not extractor.ocr_available():
        raise HTTPException(
            status_code=503,
            detail="OCR dependencies are not installed in python_rag_service.",
        )

    temp_path = create_temp_pdf_path("extract_pdf_ocr_", file.filename)
    try:
        with open(temp_path, "wb") as f:
            shutil.copyfileobj(file.file, f)

        pages = parse_page_numbers_payload(page_numbers)
        parsed_languages = [
            part.strip() for part in str(languages or "en").replace(",", " ").split() if part.strip()
        ] or ["en"]
        extracted_pages = extractor.extract_pdf_ocr_pages(
            temp_path,
            pages,
            languages=parsed_languages,
        )
        return {"status": "success", "filename": file.filename, "pages": extracted_pages}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

@app.post("/extract-epub")
async def extract_epub(file: UploadFile = File(...)):
    """Placeholder for robust local Python EPUB extraction using BeautifulSoup/lxml"""
    if not file.filename.endswith(".epub"):
        raise HTTPException(status_code=400, detail="Only EPUB files are supported.")
    
    # Feature flag placeholder. Currently handled natively in Node.js
    return {"status": "not_implemented", "message": "EPUB chunking is currently handled by the Node.js parser."}

@app.post("/compare")
async def compare_texts(payload: CompareRequest):
    """Calculates dense semantic similarity (BGE-M3) and fuzzy string similarity"""
    try:
        if not rag_engine.model_available():
            rag_engine.initialize_models(raise_on_error=False)
        if not rag_engine.model_available():
            raise HTTPException(
                status_code=503,
                detail=(
                    "Embedding model is unavailable. "
                    f"{rag_engine.initialization_error or 'Model initialization failed.'}"
                ),
            )
        result = rag_engine.compute_similarity(payload.text1, payload.text2)
        return {"status": "success", "comparison": result}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
