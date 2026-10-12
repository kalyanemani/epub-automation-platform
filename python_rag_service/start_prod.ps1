# Production startup for Python RAG service
# Uses uvicorn with multiple workers, access log, and structured JSON logging.
# Adjust --workers based on available CPU cores (typically cores - 1).
#
# Usage:
#   .\start_prod.ps1              # 2 workers (default)
#   .\start_prod.ps1 -Workers 4  # 4 workers

param(
    [int]$Workers = 2,
    [int]$Port    = 8001,
    [string]$LogLevel = "info"
)

Set-Location $PSScriptRoot

$VenvPython = Join-Path $PSScriptRoot "venv\Scripts\python.exe"
if (-not (Test-Path $VenvPython)) {
    Write-Error "venv not found at $PSScriptRoot\venv — run: python -m venv venv && pip install -r requirements.txt"
    exit 1
}

Write-Host "[prod] Starting EPUB Python service on port $Port with $Workers worker(s)..."

# Single-process mode (uvicorn) — safe for Windows (multiprocessing fork issues)
# For true multi-process on Linux, use gunicorn:
#   gunicorn main:app -w $Workers -k uvicorn.workers.UvicornWorker -b 0.0.0.0:$Port
& $VenvPython -m uvicorn main:app `
    --host 0.0.0.0 `
    --port $Port `
    --workers $Workers `
    --log-level $LogLevel `
    --access-log `
    --proxy-headers `
    --forwarded-allow-ips "*" `
    --timeout-keep-alive 75
