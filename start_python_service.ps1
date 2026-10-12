Set-Location "C:\Users\krishkal\Desktop\epub_backend\python_rag_service"
$env:NODE_API_URL = "http://localhost:9000"
$env:PYTHON_API_PORT = "8001"
$env:REDIS_URL = "redis://localhost:6379"
$env:SHORT_TERM_MEMORY_TTL_SECONDS = "21600"
$env:RUN_CONTEXT_TTL_SECONDS = "21600"
$env:PROMPT_CACHE_TTL_SECONDS = "86400"
.\venv\Scripts\python.exe main.py
