@echo off
echo Starting all EPUB backend servers...

set "NODE_API_URL=http://localhost:9000"
set "PYTHON_API_URL=http://localhost:8001"
set "PYTHON_API_PORT=8001"
set "REDIS_URL=redis://localhost:6379"
set "SHORT_TERM_MEMORY_TTL_SECONDS=21600"
set "RUN_CONTEXT_TTL_SECONDS=21600"
set "PROMPT_CACHE_TTL_SECONDS=86400"

echo Starting Redis on port 6379...
start "" /B redis-server --port 6379
ping -n 3 127.0.0.1 >nul
echo Redis started.

start "Node.js Server (port 9000)" cmd /k "cd /d C:\Users\krishkal\Desktop\epub_backend\EPUB-Analysis && set NODE_API_URL=%NODE_API_URL% && set PYTHON_API_URL=%PYTHON_API_URL% && set REDIS_URL=%REDIS_URL% && set SHORT_TERM_MEMORY_TTL_SECONDS=%SHORT_TERM_MEMORY_TTL_SECONDS% && set RUN_CONTEXT_TTL_SECONDS=%RUN_CONTEXT_TTL_SECONDS% && set PROMPT_CACHE_TTL_SECONDS=%PROMPT_CACHE_TTL_SECONDS% && node server.js"

start "Python RAG Service (port 8001)" cmd /k "cd /d C:\Users\krishkal\Desktop\epub_backend\python_rag_service && set NODE_API_URL=%NODE_API_URL% && set PYTHON_API_PORT=%PYTHON_API_PORT% && set REDIS_URL=%REDIS_URL% && set SHORT_TERM_MEMORY_TTL_SECONDS=%SHORT_TERM_MEMORY_TTL_SECONDS% && set RUN_CONTEXT_TTL_SECONDS=%RUN_CONTEXT_TTL_SECONDS% && set PROMPT_CACHE_TTL_SECONDS=%PROMPT_CACHE_TTL_SECONDS% && .\venv\Scripts\python.exe main.py"

start "Streamlit Frontend (port 8501)" cmd /k "cd /d C:\Users\krishkal\Desktop\epub_backend\streamlit_frontend && set NODE_API_URL=%NODE_API_URL% && set PYTHON_API_URL=%PYTHON_API_URL% && set REDIS_URL=%REDIS_URL% && set SHORT_TERM_MEMORY_TTL_SECONDS=%SHORT_TERM_MEMORY_TTL_SECONDS% && set RUN_CONTEXT_TTL_SECONDS=%RUN_CONTEXT_TTL_SECONDS% && set PROMPT_CACHE_TTL_SECONDS=%PROMPT_CACHE_TTL_SECONDS% && streamlit run main.py --server.port 8501"

echo All servers launched. Check the opened terminal windows.
