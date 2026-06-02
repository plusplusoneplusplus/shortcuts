function Test-DevTunnelAuthError {
    param([string]$Output)
    return $Output -match '(?i)(not logged in|not authenticated|login required|log in|401|unauthorized)'
}

function Test-DevTunnelNotOwnedError {
    param([string]$Output)
    # Surfaces when listing/inspecting a tunnel the current account does not own
    # (owned by a different identity or in use elsewhere). These signals never
    # appear for a tunnel the current account owns, so they indicate ownership.
    return $Output -match '(?i)(tunnel not found|request not permitted|unauthorized tunnel access)'
}

function Invoke-DevTunnelCli {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [string]$Command = 'devtunnel'
    )

    $output = & $Command @Arguments 2>&1
    [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output   = ($output | Out-String)
    }
}

function Add-UniqueDevTunnelPort {
    param(
        [Parameter(Mandatory)]$Ports,
        [int]$Port
    )

    if ($Port -ge 1 -and $Port -le 65535 -and -not $Ports.Contains($Port)) {
        [void]$Ports.Add($Port)
    }
}

function Get-DevTunnelObjectPropertyValue {
    param(
        [Parameter(Mandatory)]$Object,
        [Parameter(Mandatory)][string[]]$Names
    )

    foreach ($name in $Names) {
        $property = $Object.PSObject.Properties[$name]
        if ($property) {
            return $property.Value
        }
    }

    return $null
}

function Get-HttpDevTunnelPorts {
    param([string]$Output)

    $ports = New-Object 'System.Collections.Generic.List[int]'
    if ([string]::IsNullOrWhiteSpace($Output)) {
        return @()
    }

    $trimmedOutput = $Output.Trim()
    try {
        $json = $trimmedOutput | ConvertFrom-Json -ErrorAction Stop
        $items = @()
        if ($json -is [array]) {
            $items = @($json)
        } elseif ($json.PSObject.Properties['ports']) {
            $items = @($json.ports)
        } elseif ($json.PSObject.Properties['items']) {
            $items = @($json.items)
        } else {
            $items = @($json)
        }

        foreach ($item in $items) {
            if ($null -eq $item) { continue }
            $protocolValue = Get-DevTunnelObjectPropertyValue -Object $item -Names @('protocol', 'protocols')
            $portValue = Get-DevTunnelObjectPropertyValue -Object $item -Names @('portNumber', 'port', 'port_number', 'number')
            $protocolText = ($protocolValue | Out-String).Trim()
            if ($protocolText -match '(?i)\bhttp\b' -and $portValue -match '^\d+$') {
                Add-UniqueDevTunnelPort -Ports $ports -Port ([int]$portValue)
            }
        }
    } catch {
        # DevTunnel defaults to table output; fall through to text parsing.
    }

    $pendingPort = $null
    foreach ($line in ($Output -split '\r?\n')) {
        $text = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($text)) { continue }

        $portKeyMatch = [regex]::Match($text, '(?i)\bport(?:\s+number)?\b\s*[:=]\s*(\d{1,5})')
        if ($portKeyMatch.Success) {
            $pendingPort = [int]$portKeyMatch.Groups[1].Value
        }

        if ($text -match '(?i)\bprotocol\b\s*[:=]\s*http\b') {
            if ($null -ne $pendingPort) {
                Add-UniqueDevTunnelPort -Ports $ports -Port $pendingPort
                $pendingPort = $null
            }
            continue
        }

        if ($text -match '(?i)\bhttp\b') {
            $numberMatch = [regex]::Match($text, '(?<![\d.])([1-9]\d{0,4})(?![\d.])')
            if ($numberMatch.Success) {
                Add-UniqueDevTunnelPort -Ports $ports -Port ([int]$numberMatch.Groups[1].Value)
            }
        }
    }

    return @($ports | Select-Object -Unique)
}

function Get-RandomFreePort {
    $listener = New-Object System.Net.Sockets.TcpListener -ArgumentList ([System.Net.IPAddress]::Loopback), 0
    try {
        $listener.Start()
        return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    } finally {
        $listener.Stop()
    }
}
