<#
.SYNOPSIS
    Installs and configures the Microsoft Dev Tunnel used by the CoC service.

.DESCRIPTION
    Ensures the devtunnel CLI is available, creates the stable CoC tunnel ID, and
    configures the CoC HTTP port. This script does not host the tunnel; use
    coc-serve-loop.ps1 -Tunnel to start and stop devtunnel host with the server.

.PARAMETER Port
    Port to expose through the tunnel (default: 4000).

.PARAMETER TunnelId
    Dev Tunnel ID to configure. Defaults to "$env:COMPUTERNAME-coc".

.EXAMPLE
    .\scripts\config-devtunnel.ps1
    .\scripts\config-devtunnel.ps1 -Port 4001
#>
param(
    [int]$Port = 4000,
    [string]$TunnelId = "$($env:COMPUTERNAME.ToLower())-coc"
)

function Write-Log {
    param([string]$Message, [ConsoleColor]$Color = [ConsoleColor]::White)
    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message" -ForegroundColor $Color
}

function Get-DevTunnelCommand {
    Get-Command devtunnel -ErrorAction SilentlyContinue
}

function Install-DevTunnelCli {
    if (Get-DevTunnelCommand) { return $true }

    $localBin = Join-Path $env:USERPROFILE '.coc\bin'
    $localExe = Join-Path $localBin 'devtunnel.exe'
    if (Test-Path $localExe) {
        $env:PATH = "$localBin;$env:PATH"
        if (Get-DevTunnelCommand) {
            Write-Log "Using devtunnel CLI from $localExe" -Color Green
            return $true
        }
    }

    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Log 'devtunnel CLI not found. Installing with winget...' -Color Yellow
        & winget install Microsoft.devtunnel --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -eq 0 -and (Get-DevTunnelCommand)) {
            Write-Log 'devtunnel CLI installed with winget.' -Color Green
            return $true
        }
    }

    Write-Log "Downloading devtunnel CLI to $localExe..." -Color Yellow
    try {
        if (-not (Test-Path $localBin)) {
            New-Item -ItemType Directory -Path $localBin -Force | Out-Null
        }
        Invoke-WebRequest -Uri 'https://aka.ms/TunnelsCliDownload/win-x64' -OutFile $localExe -UseBasicParsing
        $env:PATH = "$localBin;$env:PATH"
        if (Get-DevTunnelCommand) {
            Write-Log "devtunnel CLI installed to $localExe." -Color Green
            return $true
        }
    } catch {
        Write-Log "devtunnel CLI download failed: $($_.Exception.Message)" -Color Red
    }

    Write-Log 'Unable to install devtunnel CLI. Install it manually from https://learn.microsoft.com/azure/developer/dev-tunnels/get-started.' -Color Red
    return $false
}

function Test-DevTunnelAuthError {
    param([string]$Output)
    return $Output -match '(?i)(not logged in|not authenticated|login required|log in|401|unauthorized)'
}

function Test-DevTunnelAlreadyConfigured {
    param([string]$Output)
    return $Output -match '(?i)(already exists|conflict with existing entity)'
}

function Invoke-DevTunnelCli {
    param([string[]]$Arguments)

    $output = & devtunnel @Arguments 2>&1
    [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output   = ($output | Out-String)
    }
}

function Invoke-EnsureTunnel {
    param(
        [Parameter(Mandatory)][string]$TunnelId,
        [Parameter(Mandatory)][int]$Port
    )

    if (-not (Install-DevTunnelCli)) { return 'Unavailable' }

    $create = Invoke-DevTunnelCli -Arguments @('create', $TunnelId)
    if (Test-DevTunnelAuthError $create.Output) {
        Write-Log "devtunnel is not authenticated. Run 'devtunnel user login', then rerun this script." -Color Yellow
        return 'Unauthenticated'
    }
    if ($create.ExitCode -ne 0 -and -not (Test-DevTunnelAlreadyConfigured $create.Output)) {
        Write-Log "Failed to create dev tunnel '$TunnelId': $($create.Output.Trim())" -Color Red
        return 'Unavailable'
    }

    $portCreate = Invoke-DevTunnelCli -Arguments @('port', 'create', $TunnelId, '-p', "$Port", '--protocol', 'http')
    if (Test-DevTunnelAuthError $portCreate.Output) {
        Write-Log "devtunnel is not authenticated. Run 'devtunnel user login', then rerun this script." -Color Yellow
        return 'Unauthenticated'
    }
    if ($portCreate.ExitCode -ne 0 -and -not (Test-DevTunnelAlreadyConfigured $portCreate.Output)) {
        Write-Log "Failed to create dev tunnel port $Port for '$TunnelId': $($portCreate.Output.Trim())" -Color Red
        return 'Unavailable'
    }

    return 'Ready'
}

Write-Log "=== Configuring dev tunnel '$TunnelId' for port $Port ===" -Color Cyan
$status = Invoke-EnsureTunnel -TunnelId $TunnelId -Port $Port
if ($status -eq 'Ready') {
    Write-Log "Dev tunnel '$TunnelId' is configured for port $Port." -Color Green
    exit 0
}
if ($status -eq 'Unauthenticated') {
    exit 2
}
exit 1
