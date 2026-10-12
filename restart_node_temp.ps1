$root = 'C:\Users\krishkal\Desktop\epub_backend'
$pidFile = Join-Path $root 'server-logs\pids.json'
if (Test-Path $pidFile) {
  $pids = Get-Content $pidFile | ConvertFrom-Json
  $nodeEntry = $pids.node
  if ($nodeEntry -and $nodeEntry.pid) {
    $nodePid = $nodeEntry.pid
    if (Get-Process -Id $nodePid -ErrorAction SilentlyContinue) {
      Write-Host "Stopping Node pid=$nodePid"
      Stop-Process -Id $nodePid -Force -ErrorAction SilentlyContinue
    }
  }
}
Set-Location $root
& .\restart_node.bat
