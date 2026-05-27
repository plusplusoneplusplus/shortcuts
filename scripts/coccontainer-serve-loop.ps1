<#
.SYNOPSIS
    Runs `coccontainer serve` in a rebuild-restart loop.
    Hit POST /api/admin/restart from any browser/node to trigger a rebuild + restart.

.DESCRIPTION
    1. Builds all packages (forge -> coc -> coccontainer) and npm-links them.
    2. Starts `coccontainer serve --no-open`.
    3. When the server exits with code 75 (restart requested), loops back to step 1.
    4. Any other exit code (0 = clean shutdown, Ctrl+C, etc.) stops the loop.

.PARAMETER Port
    Port to serve on (default: 5000).

.PARAMETER SkipInitialBuild
    Skip the first build (useful when you've just built manually).

.PARAMETER BindAddress
    Network address that `coccontainer serve` binds to (default: 127.0.0.1).
    Use 0.0.0.0 to expose on all interfaces. Named -BindAddress to avoid
    collision with PowerShell's automatic `$Host` variable.

.EXAMPLE
    .\scripts\coccontainer-serve-loop.ps1
    .\scripts\coccontainer-serve-loop.ps1 -Port 8080
    .\scripts\coccontainer-serve-loop.ps1 -BindAddress 0.0.0.0
    .\scripts\coccontainer-serve-loop.ps1 -SkipInitialBuild
#>
param(
    [int]$Port = 5000,
    [switch]$SkipInitialBuild,
    [string]$BindAddress = '127.0.0.1'
)

$RESTART_EXIT_CODE = 75
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

# If invoked from repo root, use that instead
if (Test-Path (Join-Path $PWD "packages\coccontainer")) {
    $repoRoot = $PWD.Path
}

function Build-CocContainer {
    Write-Host "`n=== Installing dependencies ===" -ForegroundColor Cyan
    Push-Location $repoRoot
    try {
        npm install
        if ($LASTEXITCODE -ne 0) {
            Write-Host "npm install failed with exit code $LASTEXITCODE" -ForegroundColor Red
            return $false
        }
        Write-Host "`n=== Building all packages (coc-memory → forge → teams-bot → whatsapp-bot → coc → coccontainer) ===" -ForegroundColor Cyan

        Push-Location (Join-Path $repoRoot "packages\coc-memory")
        npm run build
        if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host "coc-memory build failed" -ForegroundColor Red; return $false }
        Pop-Location

        Push-Location (Join-Path $repoRoot "packages\forge")
        npm run build
        if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host "forge build failed" -ForegroundColor Red; return $false }
        npm link
        Pop-Location

        Push-Location (Join-Path $repoRoot "packages\teams-bot")
        npm run build
        if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host "teams-bot build failed" -ForegroundColor Red; return $false }
        Pop-Location

        Push-Location (Join-Path $repoRoot "packages\whatsapp-bot")
        npm run build
        if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host "whatsapp-bot build failed" -ForegroundColor Red; return $false }
        Pop-Location

        Push-Location (Join-Path $repoRoot "packages\coc")
        npm run build
        if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host "coc build failed" -ForegroundColor Red; return $false }
        Pop-Location

        Push-Location (Join-Path $repoRoot "packages\coccontainer")
        npm run build
        if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host "coccontainer build failed" -ForegroundColor Red; return $false }
        npm link
        # Remove symlinked forge so global link resolves correctly
        $forgeLink = Join-Path $PWD "node_modules\@plusplusoneplusplus\forge"
        if (Test-Path $forgeLink) { Remove-Item $forgeLink -Recurse -Force }
        Pop-Location

        # Re-run npm install after npm link steps -- npm link in workspace packages prunes
        # optional peer deps (@openai/codex-sdk, @anthropic-ai/claude-agent-sdk) from
        # root node_modules. A second install restores them from the local cache.
        Push-Location $repoRoot
        npm install
        $installCode = $LASTEXITCODE
        Pop-Location
        if ($installCode -ne 0) {
            Write-Host "Post-link npm install failed with exit code $installCode" -ForegroundColor Red
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
        $ok = Build-CocContainer
        if (-not $ok) {
            Write-Host "Build failed. Waiting 5s before retrying..." -ForegroundColor Red
            Start-Sleep -Seconds 5
            continue
        }
    }
    $first = $false

    # Serve step
    Write-Host "`n=== Starting coccontainer serve (host $BindAddress, port $Port) ===" -ForegroundColor Cyan
    Write-Host "POST /api/admin/restart to rebuild & restart.`n" -ForegroundColor DarkGray

    & coccontainer serve --no-open --port $Port --host $BindAddress
    $exitCode = $LASTEXITCODE

    if ($exitCode -eq $RESTART_EXIT_CODE) {
        Write-Host "`nRestart requested (exit code $RESTART_EXIT_CODE). Rebuilding..." -ForegroundColor Yellow
        continue
    }

    Write-Host "`nServer exited with code $exitCode. Stopping loop." -ForegroundColor Cyan
    break
}
