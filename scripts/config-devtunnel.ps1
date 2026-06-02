<#
.SYNOPSIS
    Installs and configures the Microsoft Dev Tunnel used by the CoC service.

.DESCRIPTION
    Ensures the devtunnel CLI is available, creates or reuses the stable CoC
    tunnel ID, and owns the persistent TunnelId -> HTTP port binding. This script
    does not host the tunnel; use coc-serve-loop.ps1 -TunnelId <id> to read the
    configured binding and start devtunnel host with the server.

.PARAMETER Port
    Optional HTTP port to expose through the tunnel when no HTTP port exists.
    If omitted, a random free local port is selected once and persisted on the
    tunnel. Existing HTTP port bindings are reused.

.PARAMETER TunnelId
    Dev Tunnel ID to configure. Defaults to "$env:COMPUTERNAME-coc".

.EXAMPLE
    .\scripts\config-devtunnel.ps1
    .\scripts\config-devtunnel.ps1 -TunnelId my-remote-coc
    .\scripts\config-devtunnel.ps1 -TunnelId my-remote-coc -Port 51234
#>
param(
    [Nullable[int]]$Port = $null,
    [string]$TunnelId = "$($env:COMPUTERNAME.ToLower())-coc"
)

. (Join-Path $PSScriptRoot 'devtunnel-utils.ps1')

$portWasProvided = $PSBoundParameters.ContainsKey('Port')
if ($portWasProvided -and ($Port -lt 1 -or $Port -gt 65535)) {
    Write-Error '-Port must be between 1 and 65535.'
    exit 2
}

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

function Test-DevTunnelAlreadyConfigured {
    param([string]$Output)
    return $Output -match '(?i)(already exists|conflict with existing entity)'
}

function Invoke-EnsureTunnel {
    param(
        [Parameter(Mandatory)][string]$TunnelId,
        [Nullable[int]]$RequestedPort = $null
    )

    if (-not (Install-DevTunnelCli)) {
        return [pscustomobject]@{ Status = 'Unavailable'; Port = $null }
    }

    $create = Invoke-DevTunnelCli -Arguments @('create', $TunnelId)
    if (Test-DevTunnelNotOwnedError $create.Output) {
        Write-Log "Dev tunnel '$TunnelId' is not accessible to the current account; the tunnel ID is owned by a different account or in use elsewhere." -Color Red
        Write-Log "Log in as the tunnel's owner ('devtunnel user login'), or rerun with a different -TunnelId." -Color Yellow
        return [pscustomobject]@{ Status = 'NotOwned'; Port = $null }
    }
    if (Test-DevTunnelAuthError $create.Output) {
        Write-Log "devtunnel is not authenticated. Run 'devtunnel user login', then rerun this script." -Color Yellow
        return [pscustomobject]@{ Status = 'Unauthenticated'; Port = $null }
    }
    if ($create.ExitCode -ne 0 -and -not (Test-DevTunnelAlreadyConfigured $create.Output)) {
        Write-Log "Failed to create dev tunnel '$TunnelId': $($create.Output.Trim())" -Color Red
        return [pscustomobject]@{ Status = 'Unavailable'; Port = $null }
    }

    $portList = Invoke-DevTunnelCli -Arguments @('port', 'list', $TunnelId)
    if (Test-DevTunnelNotOwnedError $portList.Output) {
        Write-Log "Dev tunnel '$TunnelId' is not accessible to the current account; the tunnel ID is owned by a different account or in use elsewhere." -Color Red
        Write-Log "Log in as the tunnel's owner ('devtunnel user login'), or rerun with a different -TunnelId." -Color Yellow
        return [pscustomobject]@{ Status = 'NotOwned'; Port = $null }
    }
    if (Test-DevTunnelAuthError $portList.Output) {
        Write-Log "devtunnel is not authenticated. Run 'devtunnel user login', then rerun this script." -Color Yellow
        return [pscustomobject]@{ Status = 'Unauthenticated'; Port = $null }
    }
    if ($portList.ExitCode -ne 0) {
        Write-Log "Failed to list dev tunnel ports for '$TunnelId': $($portList.Output.Trim())" -Color Red
        return [pscustomobject]@{ Status = 'Unavailable'; Port = $null }
    }

    $existingHttpPorts = @(Get-HttpDevTunnelPorts -Output $portList.Output)
    if ($existingHttpPorts.Count -gt 1) {
        Write-Log "Dev tunnel '$TunnelId' has multiple HTTP ports ($($existingHttpPorts -join ', ')). Remove the extra ports or recreate the tunnel, then rerun this script." -Color Red
        return [pscustomobject]@{ Status = 'InvalidConfiguration'; Port = $null }
    }

    if ($existingHttpPorts.Count -eq 1) {
        $resolvedPort = [int]$existingHttpPorts[0]
        if ($null -ne $RequestedPort -and [int]$RequestedPort -ne $resolvedPort) {
            Write-Log "Dev tunnel '$TunnelId' already has HTTP port $resolvedPort; reusing it instead of requested port $RequestedPort." -Color Yellow
        }
        return [pscustomobject]@{ Status = 'Ready'; Port = $resolvedPort }
    }

    if ($null -ne $RequestedPort) {
        $resolvedPort = [int]$RequestedPort
    } else {
        $resolvedPort = Get-RandomFreePort
        Write-Log "No HTTP port is configured for '$TunnelId'. Selected free local port $resolvedPort." -Color Yellow
    }

    $portCreate = Invoke-DevTunnelCli -Arguments @('port', 'create', $TunnelId, '-p', "$resolvedPort", '--protocol', 'http')
    if (Test-DevTunnelAuthError $portCreate.Output) {
        Write-Log "devtunnel is not authenticated. Run 'devtunnel user login', then rerun this script." -Color Yellow
        return [pscustomobject]@{ Status = 'Unauthenticated'; Port = $null }
    }
    if ($portCreate.ExitCode -ne 0 -and -not (Test-DevTunnelAlreadyConfigured $portCreate.Output)) {
        Write-Log "Failed to create dev tunnel port $resolvedPort for '$TunnelId': $($portCreate.Output.Trim())" -Color Red
        return [pscustomobject]@{ Status = 'Unavailable'; Port = $null }
    }

    return [pscustomobject]@{ Status = 'Ready'; Port = $resolvedPort }
}

$requestedPort = if ($portWasProvided) { [int]$Port } else { $null }
$target = if ($portWasProvided) { "requested port $requestedPort" } else { 'a persistent generated port' }
Write-Log "=== Configuring dev tunnel '$TunnelId' for $target ===" -Color Cyan
$status = Invoke-EnsureTunnel -TunnelId $TunnelId -RequestedPort $requestedPort
if ($status.Status -eq 'Ready') {
    Write-Log "Dev tunnel '$TunnelId' is configured for HTTP port $($status.Port)." -Color Green
    Write-Log "Start CoC with: .\scripts\coc-serve-loop.ps1 -TunnelId $TunnelId" -Color Green
    exit 0
}
if ($status.Status -eq 'Unauthenticated' -or $status.Status -eq 'InvalidConfiguration' -or $status.Status -eq 'NotOwned') {
    exit 2
}
exit 1
