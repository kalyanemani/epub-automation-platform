$root = 'C:\Users\krishkal\Desktop\epub_backend'
$listen = Get-NetTCPConnection -LocalPort 9000 -State Listen | Select-Object -First 1
if ($listen) {
  $pid = $listen.OwningProcess
  if ($pid -and (Get-Process -Id $pid -ErrorAction SilentlyContinue)) {
    Write-Host "Stopping process listening on port 9000: PID $pid"
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
  }
}
Set-Location $root
& .\restart_node.bat
