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
    Port to serve on in non-tunnel mode (default: 4000). Cannot be used with
    -TunnelId; configure tunnel ports with config-devtunnel.ps1 instead.

.PARAMETER SkipInitialBuild
    Skip the first build (useful when you've just built manually).

.PARAMETER LogFile
    Path to a log file. When set, all output is written to this file with timestamps
    (in addition to the console). The file is rotated when it exceeds 10 MB.
    Used by Manage-CoCService.ps1 when running as a scheduled task.

.PARAMETER TunnelId
    Host the configured Microsoft Dev Tunnel for the CoC server using this
    stable tunnel ID. The HTTP port is read from the tunnel binding created by
    config-devtunnel.ps1.

.PARAMETER BindAddress
    Network address that `coc serve` binds to (default: 127.0.0.1). Use
    0.0.0.0 to expose the server on all interfaces. Note: PowerShell reserves
    `$Host` as an automatic variable, so this parameter is named -BindAddress.

.EXAMPLE
    .\scripts\coc-serve-loop.ps1
    .\scripts\coc-serve-loop.ps1 -Port 8080
    .\scripts\coc-serve-loop.ps1 -BindAddress 0.0.0.0
    .\scripts\config-devtunnel.ps1 -TunnelId my-remote-coc
    .\scripts\coc-serve-loop.ps1 -TunnelId my-remote-coc
    .\scripts\coc-serve-loop.ps1 -SkipInitialBuild
    .\scripts\coc-serve-loop.ps1 -LogFile "$env:USERPROFILE\.coc\logs\coc-service.log"
#>
param(
    [int]$Port = 4000,
    [switch]$SkipInitialBuild,
    [string]$LogFile = '',
    [string]$TunnelId = '',
    [string]$BindAddress = '127.0.0.1'
)

$RESTART_EXIT_CODE = 75
$LOG_MAX_BYTES     = 10MB

# Seconds to wait for `devtunnel host` to publish a public URL before treating the
# tunnel as failed. Override with COC_DEVTUNNEL_URL_TIMEOUT (positive integer).
$DEVTUNNEL_URL_TIMEOUT = 30
if ($env:COC_DEVTUNNEL_URL_TIMEOUT -match '^[1-9][0-9]*$') {
    $DEVTUNNEL_URL_TIMEOUT = [int]$env:COC_DEVTUNNEL_URL_TIMEOUT
}

. (Join-Path $PSScriptRoot 'devtunnel-utils.ps1')

$portWasProvided = $PSBoundParameters.ContainsKey('Port')
if (-not [string]::IsNullOrWhiteSpace($TunnelId) -and $portWasProvided) {
    Write-Error '-Port cannot be used with -TunnelId. Configure the tunnel port with config-devtunnel.ps1, then start the loop with only -TunnelId.'
    exit 2
}

$repoRoot = Split-Path -Parent $PSScriptRoot

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

# ── Dev Tunnel host process ────────────────────────────────────────────────────

function Resolve-DevTunnelCommand {
    $command = Get-Command devtunnel -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }

    $localExe = Join-Path $env:USERPROFILE '.coc\bin\devtunnel.exe'
    if (Test-Path $localExe) { return $localExe }

    return $null
}

function Test-DevTunnelUrlMatchesPort {
    param(
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][int]$Port
    )

    try {
        $uri = [Uri]$Url
    } catch {
        return $false
    }

    if ($uri.Port -eq $Port) {
        return $true
    }

    return $uri.Host -match "(^|[-.])$([regex]::Escape([string]$Port))([-.]|$)"
}

function Select-DevTunnelUrl {
    param(
        [string]$Text,
        [Parameter(Mandatory)][int]$Port
    )

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $null
    }

    $urlMatches = [regex]::Matches($Text, 'https://[^\s,]+devtunnels\.ms[^\s,]*')
    if ($urlMatches.Count -eq 0) {
        return $null
    }

    $urls = @($urlMatches | ForEach-Object { $_.Value.TrimEnd('.', ';', ')', ']') })
    foreach ($candidate in $urls) {
        if (Test-DevTunnelUrlMatchesPort -Url $candidate -Port $Port) {
            return $candidate
        }
    }

    return $urls[0]
}

function Start-DevTunnel {
    param(
        [Parameter(Mandatory)][string]$TunnelId,
        [Parameter(Mandatory)][int]$Port
    )

    $devTunnelCommand = Resolve-DevTunnelCommand
    if (-not $devTunnelCommand) {
        Write-Log 'devtunnel CLI not found. Run .\scripts\config-devtunnel.ps1 before starting the service with -TunnelId.' -Color Yellow
        return $null
    }

    $safeId = ($TunnelId -replace '[^A-Za-z0-9_.-]', '_')
    $stdoutPath = Join-Path ([IO.Path]::GetTempPath()) "coc-devtunnel-$safeId.out.log"
    $stderrPath = Join-Path ([IO.Path]::GetTempPath()) "coc-devtunnel-$safeId.err.log"
    Remove-Item $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue

    $startArgs = @{
        FilePath               = $devTunnelCommand
        ArgumentList           = @('host', $TunnelId)
        PassThru               = $true
        RedirectStandardOutput = $stdoutPath
        RedirectStandardError  = $stderrPath
        ErrorAction            = 'Stop'
    }
    # -WindowStyle is only supported by Start-Process on Windows editions of
    # PowerShell; on PowerShell 7 for Linux/macOS it throws and would leave the
    # process handle null. Apply it only when hosting on Windows.
    $isWindowsHost = ($null -eq $IsWindows) -or $IsWindows
    if ($isWindowsHost) { $startArgs['WindowStyle'] = 'Hidden' }

    $proc = $null
    $startError = $null
    try {
        $proc = Start-Process @startArgs
    } catch {
        $startError = $_.Exception.Message
    }

    $url = $null
    if ($proc) {
        $deadline = (Get-Date).AddSeconds($DEVTUNNEL_URL_TIMEOUT)
        while ((Get-Date) -lt $deadline) {
            if ($proc.HasExited) { break }
            $text = ''
            if (Test-Path $stdoutPath) { $text += (Get-Content $stdoutPath -Raw -ErrorAction SilentlyContinue) }
            if (Test-Path $stderrPath) { $text += "`n" + (Get-Content $stderrPath -Raw -ErrorAction SilentlyContinue) }
            $matchedUrl = Select-DevTunnelUrl -Text $text -Port $Port
            if ($matchedUrl) {
                $url = $matchedUrl
                break
            }
            Start-Sleep -Milliseconds 500
            $proc.Refresh()
        }
    }

    [pscustomobject]@{
        Process    = $proc
        Url        = $url
        StdoutPath = $stdoutPath
        StderrPath = $stderrPath
        StartError = $startError
    }
}

function Resolve-ConfiguredDevTunnelPort {
    param([Parameter(Mandatory)][string]$TunnelId)

    $devTunnelCommand = Resolve-DevTunnelCommand
    if (-not $devTunnelCommand) {
        Write-Log 'devtunnel CLI not found. Run .\scripts\config-devtunnel.ps1 before starting the service with -TunnelId.' -Color Red
        return $null
    }

    $portList = Invoke-DevTunnelCli -Command $devTunnelCommand -Arguments @('port', 'list', $TunnelId)
    if (Test-DevTunnelAuthError $portList.Output) {
        Write-Log "devtunnel is not authenticated. Run 'devtunnel user login', then rerun this script." -Color Red
        return $null
    }
    if (Test-DevTunnelNotOwnedError $portList.Output) {
        Write-Log "Dev tunnel '$TunnelId' is not accessible to the current account; the tunnel ID is owned by a different account or in use elsewhere. Log in as the owner with 'devtunnel user login', or pick a new tunnel ID." -Color Red
        return $null
    }
    if ($portList.ExitCode -ne 0) {
        Write-Log "Failed to list dev tunnel ports for '$TunnelId': $($portList.Output.Trim())" -Color Red
        return $null
    }

    $httpPorts = @(Get-HttpDevTunnelPorts -Output $portList.Output)
    if ($httpPorts.Count -eq 0) {
        Write-Log "Dev tunnel '$TunnelId' has no configured HTTP port. Run .\scripts\config-devtunnel.ps1 -TunnelId $TunnelId first." -Color Red
        return $null
    }
    if ($httpPorts.Count -gt 1) {
        Write-Log "Dev tunnel '$TunnelId' has multiple HTTP ports ($($httpPorts -join ', ')). Remove the extra ports or recreate the tunnel, then rerun this script." -Color Red
        return $null
    }

    return [int]$httpPorts[0]
}

function Stop-ProcessTree {
    param([Parameter(Mandatory)][int]$ProcessId)

    # Win32_Process (CIM/WMI) is Windows-only, so on PowerShell 7 for Linux/macOS it
    # enumerates nothing and child `devtunnel` processes would leak. There, use .NET's
    # Process.Kill($true) (available on .NET 5+, which pwsh 7 runs on) to kill the whole
    # tree. On Windows (incl. Windows PowerShell 5.1) keep the portable CIM walk.
    $isWindowsHost = ($null -eq $IsWindows) -or $IsWindows
    if (-not $isWindowsHost) {
        try {
            (Get-Process -Id $ProcessId -ErrorAction Stop).Kill($true)
        } catch {
            # Process already exited or cannot be killed — best effort.
        }
        return
    }

    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ParentProcessId -eq $ProcessId } |
        ForEach-Object { Stop-ProcessTree -ProcessId $_.ProcessId }

    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Stop-DevTunnel {
    param($TunnelSession)

    if (-not $TunnelSession -or -not $TunnelSession.Process) { return }
    $proc = $TunnelSession.Process
    $proc.Refresh()
    if (-not $proc.HasExited) {
        Write-Log "Stopping dev tunnel process $($proc.Id)..." -Color Yellow
        Stop-ProcessTree -ProcessId $proc.Id
    }
}

# ── Build ──────────────────────────────────────────────────────────────────────

function Build-Coc {
    Write-Log '=== Installing dependencies ===' -Color Cyan
    Push-Location $repoRoot
    try {
        npm install 2>&1 | ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -ne 0) {
            Write-Log "npm install failed with exit code $LASTEXITCODE" -Color Red
            return $false
        }
        Write-Log '=== Building coc packages ===' -Color Cyan
        npm run coc:link 2>&1 | ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -ne 0) {
            Write-Log "Build failed with exit code $LASTEXITCODE" -Color Red
            return $false
        }
        # Re-run npm install after coc:link — npm link in workspace packages prunes
        # optional peer deps (@openai/codex-sdk, @anthropic-ai/claude-agent-sdk) from
        # root node_modules. A second install restores them cheaply from the local cache.
        npm install 2>&1 | ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -ne 0) {
            Write-Log "Post-link npm install failed with exit code $LASTEXITCODE" -Color Red
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
$tunnelEnabled = -not [string]::IsNullOrWhiteSpace($TunnelId)
if ($tunnelEnabled) {
    $resolvedPort = Resolve-ConfiguredDevTunnelPort -TunnelId $TunnelId
    if ($null -eq $resolvedPort) {
        exit 2
    }
    $Port = $resolvedPort
    Write-Log "Using dev tunnel '$TunnelId' configured HTTP port $Port." -Color Green
}

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
    $tunnelSession = $null
    if ($tunnelEnabled) {
        $tunnelSession = Start-DevTunnel -TunnelId $TunnelId -Port $Port
        if (-not $tunnelSession -or -not $tunnelSession.Url) {
            Write-Log "Failed to host dev tunnel '$TunnelId' within $DEVTUNNEL_URL_TIMEOUT seconds. Aborting startup instead of serving locally without a working tunnel." -Color Red
            if (-not $tunnelSession) {
                Write-Log 'devtunnel CLI not found. Run .\scripts\config-devtunnel.ps1 before starting the loop with -TunnelId.' -Color Red
            } else {
                if ($tunnelSession.StartError) {
                    Write-Log "Could not start 'devtunnel host $TunnelId': $($tunnelSession.StartError)" -Color Red
                }
                $diag = ''
                foreach ($logPath in @($tunnelSession.StdoutPath, $tunnelSession.StderrPath)) {
                    if ($logPath -and (Test-Path $logPath)) {
                        $content = Get-Content $logPath -Raw -ErrorAction SilentlyContinue
                        if (-not [string]::IsNullOrWhiteSpace($content)) { $diag += $content }
                    }
                }
                if (-not [string]::IsNullOrWhiteSpace($diag)) {
                    Write-Log "devtunnel host output:`n$($diag.Trim())" -Color Red
                }
            }
            Write-Log "Verify you are logged in as the tunnel owner ('devtunnel user login') and that 'devtunnel host $TunnelId' works, then retry. Set COC_DEVTUNNEL_URL_TIMEOUT to wait longer." -Color Yellow
            Stop-DevTunnel -TunnelSession $tunnelSession
            exit 1
        }
        Write-Log "Dev tunnel URL: $($tunnelSession.Url)" -Color Green
    }

    Write-Log "=== Starting coc serve (host $BindAddress, port $Port) ===" -Color Cyan
    Write-Log 'POST /api/admin/restart to rebuild and restart.'

    try {
        if ($Script:LogFile) {
            # Pipe coc serve output through Write-Log so it lands in the log file with timestamps
            & coc serve --no-open --port $Port --host $BindAddress 2>&1 | ForEach-Object {
                $entry = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $_"
                Write-Host $entry
                try { Add-Content -Path $Script:LogFile -Value $entry -Encoding UTF8 } catch {}
            }
        } else {
            & coc serve --no-open --port $Port --host $BindAddress
        }
        $exitCode = $LASTEXITCODE
    } finally {
        Stop-DevTunnel -TunnelSession $tunnelSession
    }

    if ($exitCode -eq $RESTART_EXIT_CODE) {
        Write-Log "Restart requested (exit code $RESTART_EXIT_CODE). Rebuilding..." -Color Yellow
        continue
    }

    Write-Log "Server exited with code $exitCode. Stopping loop." -Color Cyan
    break
}
