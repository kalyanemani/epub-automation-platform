$conn = Get-NetTCPConnection -LocalPort 9000 -State Listen | Select-Object -First 1 OwningProcess
if ($null -eq $conn) { Write-Host 'No listener on port 9000'; exit 1 }
$pid = $conn.OwningProcess
Write-Host "Port 9000 owned by PID $pid"
Get-CimInstance Win32_Process -Filter "ProcessId=$pid" | Select-Object ProcessId,CommandLine | Format-List
