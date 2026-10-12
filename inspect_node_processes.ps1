$nodeProcs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'"
$matches = $nodeProcs | Where-Object { $_.CommandLine -match 'server\.js|EPUB-Analysis|node server\.js' }
if (-not $matches) {
  Write-Host 'No matching node.exe processes found.'
  exit 0
}
foreach ($proc in $matches) {
  Write-Host "ProcessId: $($proc.ProcessId)"
  Write-Host "CommandLine: $($proc.CommandLine)"
  Write-Host '---'
}
