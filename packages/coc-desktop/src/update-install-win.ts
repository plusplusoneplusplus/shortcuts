/** Electron-free Windows install handoff; NSIS starts after the normal quit drain. */
import { spawn } from 'node:child_process';
import { win32 as path } from 'node:path';
import type { DownloadedUpdate } from './update-install';

export interface WindowsUpdateOptions {
    download: DownloadedUpdate;
    /** Current packaged executable, whose directory must be preserved. */
    execPath: string;
    oldPid: number;
    systemRoot?: string;
}

function windowsPath(value: string): string {
    if (!path.isAbsolute(value) || /["\r\n\0]/.test(value)) {
        throw new Error('Invalid Windows update path.');
    }
    return path.normalize(value);
}

// A single-quoted PowerShell literal treats $, backticks and shell operators as data.
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

export function windowsInstallScript(options: WindowsUpdateOptions): string {
    if (!Number.isSafeInteger(options.oldPid) || options.oldPid <= 0) {
        throw new Error('Invalid app PID.');
    }
    const installer = windowsPath(options.download.installerPath);
    const executable = windowsPath(options.execPath);
    const tempDir = windowsPath(options.download.tempDir);
    const installDir = path.dirname(executable);
    if (!installer.toLowerCase().endsWith('.exe') || !executable.toLowerCase().endsWith('.exe')) {
        throw new Error('Windows updates require an executable installer and app.');
    }
    // NSIS requires /D last and unquoted, including paths containing spaces.
    // ProcessStartInfo avoids cmd.exe and preserves that exact command line.
    return `$ErrorActionPreference = 'Stop'
$installer = ${literal(installer)}
$executable = ${literal(executable)}
$updateDir = ${literal(tempDir)}
$oldPid = ${options.oldPid}
try {
    $oldProcess = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
    if ($null -ne $oldProcess) {
        if (-not $oldProcess.WaitForExit(300000)) {
            throw 'Timed out waiting for CoC to quit.'
        }
    }
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $installer
    $start.Arguments = ${literal(`/S --force-run /D=${installDir}`)}
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.WorkingDirectory = $updateDir
    $setup = [System.Diagnostics.Process]::Start($start)
    $setup.WaitForExit()
    if ($setup.ExitCode -ne 0) {
        throw "Windows installer failed with exit code $($setup.ExitCode)."
    }
} catch {
    $_.Exception.Message | Set-Content -LiteralPath (Join-Path $updateDir 'install-error.txt') -Encoding UTF8
    Start-Process -FilePath $executable
    exit 1
}
# Installation and relaunch succeeded; cleanup must not relaunch a second instance.
Remove-Item -LiteralPath $updateDir -Recurse -Force -ErrorAction SilentlyContinue
`;
}

/** Await successful detached launcher spawn before calling app.quit(). */
export async function launchWindowsUpdate(
    options: WindowsUpdateOptions,
    spawnFn: typeof spawn = spawn,
): Promise<void> {
    const script = windowsInstallScript(options);
    const systemRoot = windowsPath(options.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows');
    const cmd = path.join(systemRoot, 'System32', 'cmd.exe');
    const powershellDir = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0');
    // Windows PowerShell can exit without executing its script under DETACHED_PROCESS.
    // Detach cmd instead; it starts PowerShell normally outside the app's lifetime.
    // Only fixed switches and base64 enter cmd's command line; paths stay in the script.
    await new Promise<void>((resolve, reject) => {
        const child = spawnFn(cmd, [
            '/d', '/s', '/c', '.\\powershell.exe',
            '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
            Buffer.from(script, 'utf16le').toString('base64'),
        ], {
            detached: true, stdio: 'ignore', windowsHide: true, cwd: powershellDir,
        });
        child.once('error', reject);
        child.once('spawn', () => { child.unref(); resolve(); });
    });
}
