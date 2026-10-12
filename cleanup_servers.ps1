$root = 'C:\Users\krishkal\Desktop\epub_backend'
Set-Location $root

$pidsFile = Join-Path $root 'server-logs\pids.json'
if (Test-Path $pidsFile) {
    $pids = Get-Content $pidsFile | ConvertFrom-Json
    foreach ($entry in $pids.PSObject.Properties) {
        $pidValue = $entry.Value.pid
        if ($pidValue -and (Get-Process -Id $pidValue -ErrorAction SilentlyContinue)) {
            Write-Host "Stopping $($entry.Name) pid=$pidValue"
            Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item -Force -ErrorAction SilentlyContinue $pidsFile
}

$filesToRemove = @(
    '.\dump.rdb',
    '.\storage_data\epub_episodic.db',
    '.\storage_data\epub_longterm.db'
)
foreach ($file in $filesToRemove) {
    if (Test-Path $file) { Remove-Item -Force -ErrorAction SilentlyContinue $file }
}

$dirsToClean = @(
    '.\uploads',
    '.\temp_with_error',
    '.\temp_without_error',
    '.\tmp_demo_error_file1_nav_c0834c08',
    '.\tmp_navigation_repair_test'
)
foreach ($dir in $dirsToClean) {
    if (Test-Path $dir) {
        Get-ChildItem $dir -Force -Recurse -ErrorAction SilentlyContinue | Remove-Item -Force -Recurse -ErrorAction SilentlyContinue
    }
}

Write-Host 'Cleanup complete.'
