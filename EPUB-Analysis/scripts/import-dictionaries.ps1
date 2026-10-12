# Create a temporary directory for cloning
$tempDir = Join-Path -Path $env:TEMP -ChildPath "epub_dictionaries_temp"
if (Test-Path $tempDir) {
    Remove-Item -Path $tempDir -Recurse -Force
}
New-Item -ItemType Directory -Path $tempDir | Out-Null

Write-Host "Cloning missing dictionary repositories into $tempDir..."

# Define repositories and their IDs
$repos = @(
    @{ id="lookup-scowl"; url="https://github.com/en-wl/wordlist" },
    @{ id="lookup-libreoffice-dictionaries"; url="https://github.com/LibreOffice/dictionaries" },
    @{ id="lookup-wordfreq"; url="https://github.com/rspeer/wordfreq" },
    @{ id="lookup-hunspell-hyphen"; url="https://github.com/hunspell/hyphen" }
)

foreach ($repo in $repos) {
    $repoName = $repo.id
    $repoUrl = $repo.url
    $clonePath = Join-Path -Path $tempDir -ChildPath $repoName
    
    Write-Host "---------------------------------------------------"
    Write-Host "Cloning $repoName from $repoUrl..."
    git clone $repoUrl $clonePath --depth 1

    Write-Host "Importing $repoName into KB..."
    # Execute the Node.js script to import it
    node scripts/manage-kb.js import-local $repoName $clonePath --force
}

Write-Host "---------------------------------------------------"
Write-Host "Cleaning up temporary clone directory..."
Remove-Item -Path $tempDir -Recurse -Force

Write-Host "All dictionaries imported! Generating updated KB status report..."
node scripts/manage-kb.js status
