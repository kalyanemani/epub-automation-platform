$root = 'C:\Users\krishkal\Desktop\epub_backend'
$listen = Get-NetTCPConnection -LocalPort 9000 -State Listen | Select-Object -First 1
if ($listen) {
  $procId = $listen.OwningProcess
  if ($procId -and (Get-Process -Id $procId -ErrorAction SilentlyContinue)) {
    Write-Host "Stopping process listening on port 9000: PID $procId"
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  }
}
Set-Location $root
& .\restart_node.bat
