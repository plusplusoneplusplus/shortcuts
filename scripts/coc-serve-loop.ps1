<#
.SYNOPSIS
    Runs `coc serve` in a rebuild-restart loop.
    Hit POST /api/admin/restart from any browser/node to trigger a rebuild + restart.

.DESCRIPTION
    1. Builds all coc packages (forge → coc) and npm-links them.
    2. Starts `coc serve --no-open`.
    3. When the server exits with code 75 (restart requested), loops back to step 1.
    4. Any other exit code (0 = clean shutdown, Ctrl+C, etc.) stops the loop.

.PARAMETER Port
    Port to serve on (default: 4000).

.PARAMETER SkipInitialBuild
    Skip the first build (useful when you've just built manually).

.PARAMETER LogFile
    Path to a log file. When set, all output is written to this file with timestamps
    (in addition to the console). The file is rotated when it exceeds 10 MB.
    Used by Manage-CoCService.ps1 when running as a scheduled task.

.EXAMPLE
    .\scripts\coc-serve-loop.ps1
    .\scripts\coc-serve-loop.ps1 -Port 8080
    .\scripts\coc-serve-loop.ps1 -SkipInitialBuild
    .\scripts\coc-serve-loop.ps1 -LogFile "$env:USERPROFILE\.coc\logs\coc-service.log"
#>
param(
    [int]$Port = 4000,
    [switch]$SkipInitialBuild,
    [string]$LogFile = ''
)

$RESTART_EXIT_CODE = 75
$LOG_MAX_BYTES     = 10MB

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

# If invoked from repo root, use that instead
if (Test-Path (Join-Path $PWD 'packages\coc')) {
    $repoRoot = $PWD.Path
}

# ── Logging helpers ────────────────────────────────────────────────────────────

function Write-Log {
    param([string]$Message, [ConsoleColor]$Color = [ConsoleColor]::White)
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
    Write-Host $line -ForegroundColor $Color
    if ($Script:LogFile) {
        try { Add-Content -Path $Script:LogFile -Value $line -Encoding UTF8 } catch {}
    }
}

function Invoke-LogRotation {
    if (-not $Script:LogFile -or -not (Test-Path $Script:LogFile)) { return }
    $size = (Get-Item $Script:LogFile).Length
    if ($size -le $LOG_MAX_BYTES) { return }

    $backup = "$Script:LogFile.1"
    if (Test-Path $backup) { Remove-Item $backup -Force -ErrorAction SilentlyContinue }
    Rename-Item $Script:LogFile $backup -Force -ErrorAction SilentlyContinue
    Write-Log "Log rotated (previous: $([math]::Round($size / 1MB, 1)) MB → $backup)" -Color Yellow
}

# ── Build ──────────────────────────────────────────────────────────────────────

function Build-Coc {
    Write-Log '=== Installing dependencies ===' -Color Cyan
    Push-Location $repoRoot
    try {
        npm install
        if ($LASTEXITCODE -ne 0) {
            Write-Log "npm install failed with exit code $LASTEXITCODE" -Color Red
            return $false
        }
        Write-Log '=== Building coc packages ===' -Color Cyan
        npm run coc:link
        if ($LASTEXITCODE -ne 0) {
            Write-Log "Build failed with exit code $LASTEXITCODE" -Color Red
            return $false
        }
        Write-Log 'Build succeeded.' -Color Green
        return $true
    } finally {
        Pop-Location
    }
}

# ── Main loop ──────────────────────────────────────────────────────────────────

$first = $true

while ($true) {
    # Rotate log before each cycle to keep file size bounded
    Invoke-LogRotation

    # Build step
    if ($first -and $SkipInitialBuild) {
        Write-Log 'Skipping initial build (-SkipInitialBuild).' -Color Yellow
    } else {
        $ok = Build-Coc
        if (-not $ok) {
            Write-Log 'Build failed. Waiting 5s before retrying...' -Color Red
            Start-Sleep -Seconds 5
            continue
        }
    }
    $first = $false

    # Serve step
    Write-Log "=== Starting coc serve (port $Port) ===" -Color Cyan
    Write-Log 'POST /api/admin/restart to rebuild and restart.'

    if ($Script:LogFile) {
        # Pipe coc serve output through Write-Log so it lands in the log file with timestamps
        & coc serve --no-open --port $Port 2>&1 | ForEach-Object {
            $entry = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $_"
            Write-Host $entry
            try { Add-Content -Path $Script:LogFile -Value $entry -Encoding UTF8 } catch {}
        }
    } else {
        & coc serve --no-open --port $Port
    }
    $exitCode = $LASTEXITCODE

    if ($exitCode -eq $RESTART_EXIT_CODE) {
        Write-Log "Restart requested (exit code $RESTART_EXIT_CODE). Rebuilding..." -Color Yellow
        continue
    }

    Write-Log "Server exited with code $exitCode. Stopping loop." -Color Cyan
    break
}
