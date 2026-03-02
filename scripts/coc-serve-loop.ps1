<#
.SYNOPSIS
    Runs `coc serve` in a rebuild-restart loop.
    Hit POST /api/admin/restart from any browser/node to trigger a rebuild + restart.

.DESCRIPTION
    1. Builds all coc packages (pipeline-core → coc-server → coc) and npm-links them.
    2. Starts `coc serve --no-open`.
    3. When the server exits with code 75 (restart requested), loops back to step 1.
    4. Any other exit code (0 = clean shutdown, Ctrl+C, etc.) stops the loop.

.PARAMETER Port
    Port to serve on (default: 4000).

.PARAMETER SkipInitialBuild
    Skip the first build (useful when you've just built manually).

.EXAMPLE
    .\scripts\coc-serve-loop.ps1
    .\scripts\coc-serve-loop.ps1 -Port 8080
    .\scripts\coc-serve-loop.ps1 -SkipInitialBuild
#>
param(
    [int]$Port = 4000,
    [switch]$SkipInitialBuild
)

$RESTART_EXIT_CODE = 75
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

# If invoked from repo root, use that instead
if (Test-Path (Join-Path $PWD "packages\coc")) {
    $repoRoot = $PWD.Path
}

function Build-Coc {
    Write-Host "`n=== Building coc packages ===" -ForegroundColor Cyan
    Push-Location $repoRoot
    try {
        npm run coc:link
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Build failed with exit code $LASTEXITCODE" -ForegroundColor Red
            return $false
        }
        Write-Host "Build succeeded." -ForegroundColor Green
        return $true
    } finally {
        Pop-Location
    }
}

$first = $true

while ($true) {
    # Build step
    if ($first -and $SkipInitialBuild) {
        Write-Host "Skipping initial build (-SkipInitialBuild)." -ForegroundColor Yellow
    } else {
        $ok = Build-Coc
        if (-not $ok) {
            Write-Host "Build failed. Waiting 5s before retrying..." -ForegroundColor Red
            Start-Sleep -Seconds 5
            continue
        }
    }
    $first = $false

    # Serve step
    Write-Host "`n=== Starting coc serve (port $Port) ===" -ForegroundColor Cyan
    Write-Host "POST /api/admin/restart to rebuild & restart.`n" -ForegroundColor DarkGray

    & coc serve --no-open --port $Port
    $exitCode = $LASTEXITCODE

    if ($exitCode -eq $RESTART_EXIT_CODE) {
        Write-Host "`nRestart requested (exit code $RESTART_EXIT_CODE). Rebuilding..." -ForegroundColor Yellow
        continue
    }

    Write-Host "`nServer exited with code $exitCode. Stopping loop." -ForegroundColor Cyan
    break
}
