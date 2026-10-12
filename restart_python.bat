@echo off
start "Python8001" cmd /k "cd /d C:\Users\krishkal\Desktop\epub_backend\python_rag_service && set NODE_API_URL=http://localhost:9000 && set PYTHON_API_PORT=8001 && .\venv\Scripts\python.exe main.py"
