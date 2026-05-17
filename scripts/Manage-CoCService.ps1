#Requires -Version 5.1
<#
.SYNOPSIS
    Manage the CoC server as a Windows scheduled task.

.DESCRIPTION
    Registers coc-serve-loop.ps1 as a scheduled task and provides day-to-day
    management: install, uninstall, start, stop, restart, status, logs.

    Two modes are supported:
      - system (default): runs as SYSTEM at startup. Requires administrator
        privileges to install/uninstall. The task survives logoff and starts
        before any user logs in.
      - user: runs as the current user at logon. Does NOT require administrator
        privileges. The task starts when the current user signs in.

.PARAMETER Command
    Subcommand to run: install | uninstall | start | stop | restart | status | logs

.PARAMETER Mode
    Scheduling mode: system (default) or user.
      system — SYSTEM principal, AtStartup trigger, requires admin.
      user   — current-user principal, AtLogOn trigger, no admin required.

.PARAMETER Port
    Port for the CoC server in non-tunnel mode (default: 4000). Used only by install.

.PARAMETER NoBuildSkip
    install: do NOT pass -SkipInitialBuild to the loop script (forces a fresh build
    every time the task starts, not just on the first run after registration).

.PARAMETER TunnelId
    install: pass -TunnelId to the loop script so it hosts the configured
    Microsoft Dev Tunnel alongside the CoC server. Run config-devtunnel.ps1 first.
    Cannot be combined with -Port.

.PARAMETER BindAddress
    install: network address that `coc serve` binds to (default: 127.0.0.1).
    Use 0.0.0.0 to expose the server on all interfaces. Named -BindAddress to
    avoid colliding with PowerShell's automatic `$Host` variable.

.PARAMETER LogLines
    logs: number of trailing lines to display (default: 50).

.PARAMETER Follow
    logs: tail the log file continuously (like `tail -f`).

.PARAMETER TaskName
    Override the Task Scheduler task name (default: CoCServer).

.EXAMPLE
    .\scripts\Manage-CoCService.ps1 install
    .\scripts\Manage-CoCService.ps1 install -Mode user
    .\scripts\config-devtunnel.ps1 -TunnelId my-remote-coc
    .\scripts\Manage-CoCService.ps1 install -TunnelId my-remote-coc
    .\scripts\Manage-CoCService.ps1 status
    .\scripts\Manage-CoCService.ps1 logs -Follow
    .\scripts\Manage-CoCService.ps1 restart
    .\scripts\Manage-CoCService.ps1 uninstall
#>
param(
    [Parameter(Mandatory, Position = 0)]
    [ValidateSet('install', 'uninstall', 'start', 'stop', 'restart', 'status', 'logs')]
    [string]$Command,

    [ValidateSet('system', 'user')]
    [string]$Mode = 'user',

    [int]$Port = 4000,

    [switch]$NoBuildSkip,

    [string]$TunnelId = '',

    [string]$BindAddress = '127.0.0.1',

    [int]$LogLines = 50,

    [switch]$Follow,

    [string]$TaskName = 'CoCServer'
)

$ErrorActionPreference = 'Stop'

$portWasProvided = $PSBoundParameters.ContainsKey('Port')
if (-not [string]::IsNullOrWhiteSpace($TunnelId) -and $portWasProvided) {
    Write-Error '-Port cannot be used with -TunnelId. Configure the tunnel port with config-devtunnel.ps1, then install the service with only -TunnelId.'
    exit 2
}

$Script:ScriptPath = $PSCommandPath
$Script:ScriptDir  = Split-Path -Parent $Script:ScriptPath
$Script:RepoRoot   = Split-Path -Parent $Script:ScriptDir
$Script:LoopScript = Join-Path $Script:ScriptDir 'coc-serve-loop.ps1'
$Script:LogDir     = Join-Path $env:USERPROFILE '.coc\logs'
$Script:LogFile    = Join-Path $Script:LogDir 'coc-service.log'

# ── Task-path helper ──────────────────────────────────────────────────────────
# system mode places the task in the root (\) folder (requires admin).
# user mode places it under \CoC\ so a non-admin user can create it.

function Get-TaskPath {
    if ($Mode -eq 'user') { return '\CoC\' } else { return '\' }
}

function Find-CocTask {
    $paths = @('\', '\CoC\')
    foreach ($tp in $paths) {
        $t = Get-ScheduledTask -TaskName $TaskName -TaskPath $tp -ErrorAction SilentlyContinue
        if ($t) { return $t }
    }
    return $null
}

# ── Admin guard ────────────────────────────────────────────────────────────────
# system mode install/uninstall require Task Scheduler access (Administrator).
# Re-launches the script elevated if needed.

function Assert-Admin {
    if ($Mode -eq 'user') { return }

    $principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { return }

    Write-Host 'Elevation required for system mode. Re-launching as administrator...' -ForegroundColor Yellow

    $argParts = @(
        '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', "`"$Script:ScriptPath`"",
        '-Command', $Command,
        '-Mode', $Mode,
        '-TaskName', "`"$TaskName`""
    )
    if ([string]::IsNullOrWhiteSpace($TunnelId)) {
        $argParts += @('-Port', $Port)
    }
    if ($NoBuildSkip) { $argParts += '-NoBuildSkip' }
    if (-not [string]::IsNullOrWhiteSpace($TunnelId)) {
        $argParts += @('-TunnelId', "`"$TunnelId`"")
    }
    if ($PSBoundParameters.ContainsKey('BindAddress')) {
        $argParts += @('-BindAddress', "`"$BindAddress`"")
    }

    $proc = Start-Process powershell.exe -Verb RunAs -ArgumentList ($argParts -join ' ') -Wait -PassThru
    exit $proc.ExitCode
}

# ── Process helpers ────────────────────────────────────────────────────────────

function Get-CocProcesses {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'coc-serve-loop|coc serve|devtunnel host .*-coc' } |
        Select-Object ProcessId, Name, CommandLine
}

function Stop-CocProcesses {
    $procs = Get-CocProcesses
    if (-not $procs) {
        Write-Host '  No CoC processes found.' -ForegroundColor DarkGray
        return
    }
    foreach ($p in $procs) {
        Write-Host "  Stopping PID $($p.ProcessId) ($($p.Name))" -ForegroundColor Yellow
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

# ── INSTALL ────────────────────────────────────────────────────────────────────

function Invoke-Install {
    Assert-Admin

    if (-not (Test-Path $Script:LoopScript)) {
        Write-Host "ERROR: Loop script not found: $Script:LoopScript" -ForegroundColor Red
        exit 1
    }

    # Ensure log directory exists
    if (-not (Test-Path $Script:LogDir)) {
        New-Item -ItemType Directory -Path $Script:LogDir -Force | Out-Null
        Write-Host "Created log dir: $Script:LogDir" -ForegroundColor Green
    }

    # Resolve powershell.exe (prefer SysNative to avoid WoW64 issues on 64-bit OS)
    $psExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    if (-not (Test-Path $psExe)) {
        $psExe = (Get-Command powershell.exe -ErrorAction Stop).Source
    }

    # Build argument string for the loop script
    $loopArgs = "-NonInteractive -ExecutionPolicy Bypass -File `"$Script:LoopScript`""
    if ([string]::IsNullOrWhiteSpace($TunnelId)) {
        $loopArgs += " -Port $Port"
    } else {
        $loopArgs += " -TunnelId `"$TunnelId`""
    }
    $loopArgs += " -LogFile `"$Script:LogFile`""
    $loopArgs += " -BindAddress `"$BindAddress`""
    if (-not $NoBuildSkip) { $loopArgs += ' -SkipInitialBuild' }

    # Optionally run initial build now (before registering the task)
    if (-not $NoBuildSkip) {
        Write-Host "`n=== Running initial build ===" -ForegroundColor Cyan
        Push-Location $Script:RepoRoot
        try {
            npm install
            if ($LASTEXITCODE -ne 0) {
                Write-Host 'npm install failed.' -ForegroundColor Red; exit 1
            }
            npm run coc:link
            if ($LASTEXITCODE -ne 0) {
                Write-Host 'Build (coc:link) failed.' -ForegroundColor Red; exit 1
            }
        } finally {
            Pop-Location
        }
        Write-Host 'Build succeeded.' -ForegroundColor Green
    }

    # Remove any existing task with the same name (search both paths)
    $existing = Find-CocTask
    if ($existing) {
        Write-Host "Removing existing task '$TaskName' (path: $($existing.TaskPath))..." -ForegroundColor Yellow
        Stop-ScheduledTask  -TaskName $TaskName -TaskPath $existing.TaskPath -ErrorAction SilentlyContinue
        Stop-CocProcesses
        Unregister-ScheduledTask -TaskName $TaskName -TaskPath $existing.TaskPath -Confirm:$false
    }

    $taskPath  = Get-TaskPath

    $action    = New-ScheduledTaskAction  -Execute $psExe -Argument $loopArgs -WorkingDirectory $Script:RepoRoot
    $settings  = New-ScheduledTaskSettingsSet `
                     -ExecutionTimeLimit ([TimeSpan]::Zero) `
                     -RestartCount 3 `
                     -RestartInterval (New-TimeSpan -Minutes 1) `
                     -StartWhenAvailable `
                     -MultipleInstances IgnoreNew

    if ($Mode -eq 'system') {
        $trigger   = New-ScheduledTaskTrigger -AtStartup
        $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest -LogonType ServiceAccount
        $modeLabel = 'SYSTEM, runs at startup'
    } else {
        $trigger   = New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
        $principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -RunLevel Limited -LogonType Interactive
        $modeLabel = "$([System.Security.Principal.WindowsIdentity]::GetCurrent().Name), runs at logon"
    }

    Register-ScheduledTask `
        -TaskName    $TaskName `
        -TaskPath    $taskPath `
        -Action      $action `
        -Trigger     $trigger `
        -Settings    $settings `
        -Principal   $principal `
        -Description 'CoC server loop — managed by Manage-CoCService.ps1' |
        Out-Null

    Write-Host "`n✓ Task '$TaskName' registered ($modeLabel)." -ForegroundColor Green
    Write-Host "  Log : $Script:LogFile"   -ForegroundColor DarkGray
    Write-Host "  Run : Manage-CoCService.ps1 start   (to start without rebooting)" -ForegroundColor DarkGray
}

# ── UNINSTALL ──────────────────────────────────────────────────────────────────

function Invoke-Uninstall {
    Assert-Admin

    $task = Find-CocTask
    if (-not $task) {
        Write-Host "Task '$TaskName' is not registered." -ForegroundColor Yellow
        return
    }

    $tp = $task.TaskPath
    Write-Host "Stopping task '$TaskName' (path: $tp) and killing CoC processes..." -ForegroundColor Cyan
    Stop-ScheduledTask -TaskName $TaskName -TaskPath $tp -ErrorAction SilentlyContinue
    Stop-CocProcesses

    Unregister-ScheduledTask -TaskName $TaskName -TaskPath $tp -Confirm:$false
    Write-Host "✓ Task '$TaskName' removed." -ForegroundColor Green
}

# ── START ──────────────────────────────────────────────────────────────────────

function Invoke-Start {
    $task = Find-CocTask
    if (-not $task) {
        Write-Host "Task '$TaskName' not found. Run 'install' first." -ForegroundColor Red
        exit 1
    }
    Start-ScheduledTask -TaskName $TaskName -TaskPath $task.TaskPath
    Write-Host "✓ Task '$TaskName' started." -ForegroundColor Green
}

# ── STOP ───────────────────────────────────────────────────────────────────────

function Invoke-Stop {
    $task = Find-CocTask
    if ($task) {
        Stop-ScheduledTask -TaskName $TaskName -TaskPath $task.TaskPath -ErrorAction SilentlyContinue
    }
    Stop-CocProcesses
    Write-Host '✓ CoC server stopped.' -ForegroundColor Green
}

# ── RESTART ────────────────────────────────────────────────────────────────────

function Invoke-Restart {
    Invoke-Stop
    Start-Sleep -Seconds 2
    Invoke-Start
}

# ── STATUS ─────────────────────────────────────────────────────────────────────

function Invoke-Status {
    $task = Find-CocTask
    if (-not $task) {
        Write-Host "Task '$TaskName' is not registered. Run 'install' first." -ForegroundColor Yellow
        return
    }

    $tp = $task.TaskPath
    $info  = Get-ScheduledTaskInfo -TaskName $TaskName -TaskPath $tp -ErrorAction SilentlyContinue
    $state = $task.State

    $stateColor = switch ($state) {
        'Running' { 'Green' }
        'Ready'   { 'Cyan'  }
        default   { 'Yellow' }
    }

    # Detect mode from the registered task principal
    $taskPrincipalId = $task.Principal.UserId
    $taskMode = if ($taskPrincipalId -eq 'SYSTEM') { 'system' } else { 'user' }

    Write-Host ''
    Write-Host "  Task      : $TaskName"
    Write-Host "  Mode      : $taskMode ($taskPrincipalId)" -ForegroundColor DarkCyan
    Write-Host "  State     : $state" -ForegroundColor $stateColor

    if ($info -and $info.LastRunTime -ne [datetime]::MinValue) {
        Write-Host "  Last run  : $($info.LastRunTime)"
    }
    if ($info -and $info.NextRunTime -ne [datetime]::MinValue) {
        Write-Host "  Next run  : $($info.NextRunTime)"
    }

    # PIDs
    $procs = Get-CocProcesses
    if ($procs) {
        $pidList = ($procs | ForEach-Object { "$($_.ProcessId) ($($_.Name))" }) -join ', '
        Write-Host "  PID(s)    : $pidList"
    } else {
        Write-Host '  PID(s)    : none'
    }

    # Log info
    Write-Host "  Log file  : $Script:LogFile"
    if (Test-Path $Script:LogFile) {
        $logSize = [math]::Round((Get-Item $Script:LogFile).Length / 1KB, 1)
        $lastLine = Get-Content $Script:LogFile -Tail 1 -ErrorAction SilentlyContinue
        Write-Host "  Log size  : ${logSize} KB"
        if ($lastLine) {
            Write-Host "  Last line : $lastLine" -ForegroundColor DarkGray
        }
    } else {
        Write-Host '  Log size  : (no log yet)'
    }

    Write-Host ''
}

# ── LOGS ───────────────────────────────────────────────────────────────────────

function Invoke-Logs {
    if (-not (Test-Path $Script:LogFile)) {
        Write-Host "Log file not found: $Script:LogFile" -ForegroundColor Yellow
        Write-Host "The server may not have started yet, or logging is not configured." -ForegroundColor DarkGray
        return
    }

    if ($Follow) {
        Write-Host "Tailing $Script:LogFile  (Ctrl+C to stop)" -ForegroundColor DarkGray
        Get-Content $Script:LogFile -Tail $LogLines -Wait
    } else {
        Get-Content $Script:LogFile -Tail $LogLines
    }
}

# ── DISPATCH ───────────────────────────────────────────────────────────────────

switch ($Command) {
    'install'   { Invoke-Install }
    'uninstall' { Invoke-Uninstall }
    'start'     { Invoke-Start }
    'stop'      { Invoke-Stop }
    'restart'   { Invoke-Restart }
    'status'    { Invoke-Status }
    'logs'      { Invoke-Logs }
}
