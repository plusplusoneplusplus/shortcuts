# CoC Service Management (Windows)

`scripts/Manage-CoCService.ps1` manages `coc-serve-loop.ps1` as a Windows Task Scheduler task running under the SYSTEM account at startup.

## Usage

```
.\scripts\Manage-CoCService.ps1 <Command> [options]
```

| Command      | Description |
|--------------|-------------|
| `install`    | Register the startup task (requires elevation). Runs an initial build by default. Use `-TunnelId` to host a configured Microsoft Dev Tunnel alongside the server. |
| `uninstall`  | Stop and remove the task (requires elevation). |
| `start`      | Start the task immediately (no reboot required). |
| `stop`       | Stop the task and kill all CoC-related processes. |
| `restart`    | `stop` then `start`. |
| `status`     | Show task state, running PIDs, log file size, and last log line. |
| `logs`       | Print the last N log lines. Use `-Follow` for continuous tail. |

## Options

| Option | Default | Notes |
|--------|---------|-------|
| `-Port` | `4000` | Non-tunnel mode only. |
| `-BindAddress` | `127.0.0.1` | Use `0.0.0.0` to expose on all interfaces. Named `-BindAddress` to avoid PowerShell's `$Host` automatic variable. |
| `-TunnelId` | — | Host the configured Microsoft Dev Tunnel and use its persisted HTTP port binding. |
| `-NoBuildSkip` | off | Build on every start, not just install. |
| `-LogLines` | `50` | Tail size for `logs`. |
| `-Follow` | off | Follow log output. |
| `-TaskName` | `CoCServer` | Task Scheduler entry name. |

## Tunnel Setup

Configure the tunnel first with:

```
.\scripts\config-devtunnel.ps1 [-TunnelId <id>] [-Port <port>]
```

The service loop reads the configured tunnel port and only starts/stops `devtunnel host`.

## Logs

- **Log file:** `~/.coc/logs/coc-service.log`
- Rotated automatically at 10 MB.
