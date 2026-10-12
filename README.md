# EPUB Automation Platform

EPUB Automation Platform validates EPUB files, detects structural and content issues, applies deterministic and AI-assisted fixes, and provides reports through a Streamlit interface.

## Architecture

| Component | Technology | Default URL | Responsibility |
|---|---|---|---|
| EPUB API | Node.js, Express | `http://localhost:9000` | EPUB validation, conversion, deterministic autofix, and reports |
| RAG service | Python, FastAPI | `http://localhost:8001` | AI agents, RAG retrieval, LLM fixes, evaluation, and job processing |
| Web UI | Python, Streamlit | `http://localhost:8501` | Uploads, validation, autofix, HITL review, and reports |

The Node.js API and Python service must be running before using the Streamlit UI.

## Prerequisites

- Windows, macOS, or Linux
- Node.js 20 or later and npm
- Python 3.11 or later
- A Fireworks AI API key for cloud LLM support
- Redis, only if the selected features/configuration require the Redis-backed cache
- Calibre, optional and required only for PDF-to-EPUB conversion. On Windows, install it so `ebook-convert.exe` is available at `C:\Program Files\Calibre2\ebook-convert.exe`.
- Ollama, optional. Install it only when using local Ollama models.

## Configuration

From the repository root, create a local environment file for each component.

### Windows PowerShell

```powershell
Copy-Item python_rag_service\.env.example python_rag_service\.env
Copy-Item EPUB-Analysis\.env.example EPUB-Analysis\.env
Copy-Item streamlit_frontend\.env.example streamlit_frontend\.env
```

### macOS/Linux

```bash
cp python_rag_service/.env.example python_rag_service/.env
cp EPUB-Analysis/.env.example EPUB-Analysis/.env
cp streamlit_frontend/.env.example streamlit_frontend/.env
```

At minimum, set `FIREWORKS_API_KEY` in `python_rag_service/.env` and `EPUB-Analysis/.env`. The example files already contain the correct local service URLs:

```dotenv
# python_rag_service/.env
NODE_API_URL=http://localhost:9000
PYTHON_API_PORT=8001
FIREWORKS_API_KEY=your_fireworks_api_key_here

# EPUB-Analysis/.env
PYTHON_API_URL=http://localhost:8001
FIREWORKS_API_KEY=your_fireworks_api_key_here

# streamlit_frontend/.env
NODE_API_URL=http://localhost:9000
PYTHON_API_URL=http://localhost:8001
```

Leave Ollama variables empty when using Fireworks only. Set `SERVICE_API_KEY` in the Python `.env` to enable API-key authentication; clients must then send the same value in the `X-API-Key` header.

Do not commit `.env` files or API keys.

## Installation

Run each component in its own terminal. On Windows, use `py -3.11` if `python` does not point to Python 3.11.

### Node.js EPUB API

```powershell
cd EPUB-Analysis
npm install
```

### Python RAG service

```powershell
cd python_rag_service
py -3.11 -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

The Python requirements include FastAPI/Uvicorn, HTTP clients, Pydantic, sentence-transformers, ChromaDB, Redis client support, EPUB/PDF parsing, and evaluation metrics. The first RAG request may download an embedding model.

### Streamlit frontend

```powershell
cd streamlit_frontend
py -3.11 -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

The frontend requirements are Streamlit, Pandas, `streamlit-option-menu`, and Requests.

## Running the application

Start the services in this order, each from its own terminal.

### Node.js API

```powershell
cd EPUB-Analysis
npm start
```

For development with automatic restart, run `npm run dev`.

### Python RAG service

```powershell
cd python_rag_service
.\venv\Scripts\Activate.ps1
python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

For a production-style Windows start, run `.\start_prod.ps1 -Workers 2 -Port 8001`.

### Streamlit frontend

```powershell
cd streamlit_frontend
.\venv\Scripts\Activate.ps1
python -m streamlit run main.py --server.port 8501
```

Open `http://localhost:8501` in a browser.

## Verify the services

```powershell
Invoke-WebRequest http://localhost:9000
Invoke-WebRequest http://localhost:8001/health
Invoke-WebRequest http://localhost:8001/docs
```

FastAPI interactive documentation is available at `http://localhost:8001/docs`. Common endpoints include `/health`, `/llm-status`, `/orchestrate`, `/agent-autofix`, `/agent-autofix-status/{job_id}`, and `/agent-autofix-download/{job_id}`.

## Project layout

```text
EPUB-Analysis/       Node.js validation and autofix API
python_rag_service/  FastAPI multi-agent and RAG service
streamlit_frontend/  Streamlit web application
uploads/              Uploaded EPUB files
storage_data/         Runtime storage and generated data
```

## Troubleshooting

- **Python service cannot reach Node.js:** confirm the Node API is running on port `9000` and `NODE_API_URL` is correct.
- **Frontend shows connection errors:** verify both backend URLs in `streamlit_frontend/.env` and restart Streamlit after changing them.
- **LLM requests fail:** verify `FIREWORKS_API_KEY`, model settings, and outbound network access. Ollama is optional when Fireworks is configured.
- **PDF conversion fails:** install Calibre and verify `ebook-convert` is on the expected path.
- **PowerShell blocks activation:** run `Set-ExecutionPolicy -Scope Process Bypass` for the current terminal, then activate the virtual environment again.
- **Large first startup:** sentence-transformers/ChromaDB may download or initialize models and indexes on first use.

## Security

- Keep `.env` files private and use strong random values for `SERVICE_API_KEY` in shared environments.
- Do not expose development ports directly to the public internet without authentication and a reverse proxy.
- Review generated AI fixes before publishing an EPUB, especially text and accessibility changes.
