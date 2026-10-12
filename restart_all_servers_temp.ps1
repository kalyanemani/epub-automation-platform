$root = 'C:\Users\krishkal\Desktop\epub_backend'
$pidFile = Join-Path $root 'server-logs\pids.json'
if (Test-Path $pidFile) {
  $pids = Get-Content $pidFile | ConvertFrom-Json
  foreach ($prop in $pids.PSObject.Properties) {
    $entry = $prop.Value
    $pidVal = if ($entry -is [System.Management.Automation.PSCustomObject] -and $entry.PSObject.Properties.Name -contains 'pid') { $entry.pid } else { $entry }
    if ($pidVal -and ($pidVal -is [int] -or $pidVal -is [long]) -and (Get-Process -Id $pidVal -ErrorAction SilentlyContinue)) {
      Write-Host "Stopping $($prop.Name) pid=$pidVal"
      Stop-Process -Id $pidVal -Force -ErrorAction SilentlyContinue
    }
  }
}
Set-Location $root
& .\start_all_servers.bat
