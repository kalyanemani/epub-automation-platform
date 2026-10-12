# EPUB-Analysis — Setup & Server Startup Guide

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| **Node.js** | v18+ | [nodejs.org](https://nodejs.org) |
| **Python** | 3.10+ | [python.org](https://python.org) |
| **Redis** | Latest | [redis.io](https://redis.io/docs/install/) or `choco install redis` on Windows |
| **Git** | Latest | [git-scm.com](https://git-scm.com) |

---

## Step 1: Clone & Switch to the Backend Branch

```bash
git clone https://github.com/CreativeDT/EPUB-Analysis.git
cd EPUB-Analysis
git checkout backend
```

---

## Step 2: Environment Variables

```bash
# Copy the example env file
cp .env.example .env
```

Then edit `.env` and set your **FIREWORKS_API_KEY** (required for LLM features):

```env
FIREWORKS_API_KEY=your_actual_api_key_here
```

---

## Step 3: Install Dependencies

### Node.js (API Server)
```bash
npm install
```

### Python (RAG Service + Streamlit Frontend)
```bash
python -m venv venv

# Windows (PowerShell)
.\venv\Scripts\Activate.ps1

# macOS/Linux
source venv/bin/activate

pip install -r requirements.txt
```

---

## Step 4: Start All Servers

> **Open 5 separate terminals**, all from the project root (`EPUB-Analysis/`).

### Terminal 1 — Redis Server
```bash
redis-server --port 6379
```

### Terminal 2 — Node.js API (Port 9000)
```bash
# Windows PowerShell
$env:NODE_API_URL='http://localhost:9000'
$env:PYTHON_API_URL='http://localhost:8001'
$env:REDIS_URL='redis://localhost:6379'
$env:SHORT_TERM_MEMORY_TTL_SECONDS='21600'
$env:RUN_CONTEXT_TTL_SECONDS='21600'
$env:PROMPT_CACHE_TTL_SECONDS='86400'
node server.js

# macOS/Linux
NODE_API_URL=http://localhost:9000 \
PYTHON_API_URL=http://localhost:8001 \
REDIS_URL=redis://localhost:6379 \
SHORT_TERM_MEMORY_TTL_SECONDS=21600 \
RUN_CONTEXT_TTL_SECONDS=21600 \
PROMPT_CACHE_TTL_SECONDS=86400 \
node server.js
```

### Terminal 3 — Python RAG Service (Port 8001)
```bash
# Activate venv first, then:

# Windows PowerShell
cd python_rag_service
$env:NODE_API_URL='http://localhost:9000'
$env:PYTHON_API_PORT='8001'
$env:REDIS_URL='redis://localhost:6379'
python main.py

# macOS/Linux
cd python_rag_service
NODE_API_URL=http://localhost:9000 \
PYTHON_API_PORT=8001 \
REDIS_URL=redis://localhost:6379 \
python main.py
```

### Terminal 4 — Streamlit Frontend (Port 8501)
```bash
# Activate venv first, then:

# Windows PowerShell
cd streamlit_frontend
$env:NODE_API_URL='http://localhost:9000'
$env:PYTHON_API_URL='http://localhost:8001'
python -m streamlit run main.py --server.port 8501

# macOS/Linux
cd streamlit_frontend
NODE_API_URL=http://localhost:9000 \
PYTHON_API_URL=http://localhost:8001 \
python -m streamlit run main.py --server.port 8501
```

### Terminal 5 — React Frontend (Port 5173)
```bash
npm run dev
```

---

## Service URLs After Startup

| Service | URL |
|---------|-----|
| Node.js API | http://localhost:9000 |
| Python RAG Service | http://localhost:8001 |
| Streamlit Frontend | http://localhost:8501 |
| React Frontend | http://localhost:5173 |

---

## Quick Health Check

Once all servers are running, verify:

```bash
# Node.js API
curl http://localhost:9000/health

# Python RAG Service
curl http://localhost:8001/docs

# Streamlit — open in browser
# http://localhost:8501

# React — open in browser
# http://localhost:5173
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `MODULE_NOT_FOUND: short-term-memory` | Make sure you're on the `backend` branch (`git checkout backend`) |
| Redis connection refused | Start Redis first: `redis-server --port 6379` |
| Python import errors | Activate venv: `.\venv\Scripts\Activate.ps1` and run `pip install -r requirements.txt` |
| Port already in use | Kill the process using that port or change the port number |
| `.env` missing | Copy: `cp .env.example .env` and set your API keys |
