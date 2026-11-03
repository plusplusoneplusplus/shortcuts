import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { launchWindowsUpdate, windowsInstallScript } from '../src/update-install-win';

function fixture() {
    return {
        download: {
            installerPath: String.raw`C:\Temp\coc-update-123\CoC Setup.exe`,
            tempDir: String.raw`C:\Temp\coc-update-123`,
            cleanup: vi.fn(async () => {}),
        },
        execPath: String.raw`D:\My Programs\CoC\CoC.exe`,
        oldPid: 1234,
        systemRoot: String.raw`C:\Windows`,
    };
}

describe('Windows update helper', () => {
    it('waits for normal app exit before starting silent NSIS with relaunch and the current directory', () => {
        const script = windowsInstallScript(fixture());
        expect(script).toContain('$oldPid = 1234');
        expect(script).toContain('Get-Process -Id $oldPid -ErrorAction SilentlyContinue');
        expect(script).toContain('$oldProcess.WaitForExit(300000)');
        expect(script.indexOf('$oldProcess.WaitForExit')).toBeLessThan(script.indexOf('[System.Diagnostics.Process]::Start($start)'));
        expect(script).toContain(String.raw`$start.Arguments = '/S --force-run /D=D:\My Programs\CoC'`);
        expect(script).toContain('$start.UseShellExecute = $false');
        expect(script).toContain('$setup.WaitForExit()');
        expect(script).toContain('$setup.ExitCode -ne 0');
        expect(script).toContain('install-error.txt');
        expect(script).toContain('Start-CoC');
        expect(script.indexOf('$setup.WaitForExit()')).toBeLessThan(script.indexOf('Remove-Item'));
        expect(script).not.toMatch(/Stop-Process|taskkill/);
    });

    it('uses the inherited effective token and relaunches elevated only after setup succeeds', () => {
        const script = windowsInstallScript(fixture());
        expect(script).toContain('[System.Security.Principal.WindowsIdentity]::GetCurrent()');
        expect(script).toContain('$principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)');
        expect(script).toContain('$identity.Dispose()');
        expect(script).toContain(`if ($elevated) {
        $start.Arguments = '/S /D=D:\\My Programs\\CoC'
    } else {
        $start.Arguments = '/S --force-run /D=D:\\My Programs\\CoC'
    }`);
        expect(script).toContain(`if ($elevated) {
        Start-CoC '--updated'
    }`);
        expect(script.indexOf("Start-CoC '--updated'")).toBeGreaterThan(script.indexOf('$setup.ExitCode -ne 0'));
        expect(script).toContain('$app.FileName = $executable');
        expect(script).toContain('$app.UseShellExecute = $false');
        expect(script).toContain(String.raw`$app.WorkingDirectory = 'D:\My Programs\CoC'`);
        expect(script).toContain('[System.Diagnostics.Process]::Start($app) | Out-Null');
        expect(script.replace(/^#.*$|^\s+#.*$/gm, '')).not.toMatch(/-Verb|requireAdministrator|runas/i);
    });

    it('passes paths with apostrophes and PowerShell metacharacters as literal data', () => {
        const options = fixture();
        options.execPath = String.raw`D:\O'Brien $HOME & tools\CoC.exe`;
        options.download.installerPath = String.raw`C:\Temp\O'Brien $(calc)\setup.exe`;
        const script = windowsInstallScript(options);
        expect(script).toContain(String.raw`$installer = 'C:\Temp\O''Brien $(calc)\setup.exe'`);
        expect(script).toContain(String.raw`$start.Arguments = '/S --force-run /D=D:\O''Brien $HOME & tools'`);
    });

    it.each([0, -1, 1.5, NaN])('rejects invalid PID %s', oldPid => {
        expect(() => windowsInstallScript({ ...fixture(), oldPid })).toThrow('PID');
    });

    it.each(['relative.exe', 'C:\\bad"path\\CoC.exe', 'C:\\bad\npath\\CoC.exe'])('rejects unsafe app path %s', execPath => {
        expect(() => windowsInstallScript({ ...fixture(), execPath })).toThrow('path');
    });

    it('rejects invalid installer and temp paths and non-executable files', () => {
        const options = fixture();
        expect(() => windowsInstallScript({ ...options, download: { ...options.download, installerPath: 'relative.exe' } })).toThrow('path');
        expect(() => windowsInstallScript({ ...options, download: { ...options.download, tempDir: 'relative' } })).toThrow('path');
        expect(() => windowsInstallScript({ ...options, execPath: 'C:\\CoC.app' })).toThrow('executable');
        expect(() => windowsInstallScript({ ...options, download: { ...options.download, installerPath: 'C:\\update.dmg' } })).toThrow('executable');
    });

    // Execute the generated helper on Windows with only process operations stubbed.
    // The first powershell.exe spawn pays a multi-second cold start on CI runners,
    // which exceeded Vitest's 5s default.
    it.skipIf(process.platform !== 'win32').each(
        [false, true].flatMap(elevated => ['success', 'start-error', 'exit-code', 'timeout', 'relaunch-error', 'recovery-error']
            .filter(outcome => elevated || outcome !== 'relaunch-error')
            .map(outcome => ({ elevated, outcome }))),
    )(
        'executes $outcome (elevated=$elevated) with diagnostics, relaunch and cleanup', async ({ elevated, outcome }) => {
            const root = await fs.mkdtemp(path.join(os.tmpdir(), 'win-update-'));
            const updateDir = path.join(root, "O'Brien $literal");
            const marker = path.join(root, 'relaunched');
            const psLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;
            try {
                await fs.mkdir(updateDir);
                const options = fixture();
                options.download.tempDir = updateDir;
                let script = windowsInstallScript(options)
                    .replace('$principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)', elevated ? '$true' : '$false')
                    .replace('Get-Process -Id $oldPid -ErrorAction SilentlyContinue', outcome === 'timeout'
                        ? "(New-Object PSObject | Add-Member ScriptMethod WaitForExit { param($ms) return $false } -PassThru)"
                        : '$null')
                    .replace('[System.Diagnostics.Process]::Start($start)', outcome === 'start-error'
                        ? "$(throw 'Cannot start installer.')"
                        : `(New-Object PSObject | Add-Member NoteProperty ExitCode ${outcome === 'exit-code' || outcome === 'recovery-error' ? 7 : 0} -PassThru | Add-Member ScriptMethod WaitForExit {} -PassThru)`)
                    .replace('[System.Diagnostics.Process]::Start($app) | Out-Null',
                        outcome === 'recovery-error' ? "throw 'Cannot reopen app.'"
                            : outcome === 'relaunch-error'
                                ? `if ($arguments) { throw 'Cannot relaunch updated app.' }; Set-Content -LiteralPath ${psLiteral(marker)} -Value ''`
                                : `Set-Content -LiteralPath ${psLiteral(marker)} -Value $arguments`);
                // Check the actual .NET ProcessStartInfo construction on the host.
                script = script.replace('$setup = ', `if ($start.Arguments -ne '/S ${elevated ? '' : '--force-run '}/D=D:\\My Programs\\CoC') { throw 'Wrong installer arguments.' }\n    $setup = `);
                const command = Buffer.from(script, 'utf16le').toString('base64');
                const result = promisify(execFile)(path.win32.join(process.env.SystemRoot ?? 'C:\\Windows',
                    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
                ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', command]);
                if (outcome === 'success') {
                    await result;
                    await expect(fs.stat(updateDir)).rejects.toThrow();
                    if (elevated) {
                        expect(await fs.readFile(marker, 'utf8')).toContain('--updated');
                    } else {
                        await expect(fs.stat(marker)).rejects.toThrow();
                    }
                } else {
                    await expect(result).rejects.toThrow();
                    const reason = await fs.readFile(path.join(updateDir, 'install-error.txt'), 'utf8');
                    expect(reason).toContain(outcome === 'timeout' ? 'Timed out'
                        : outcome === 'exit-code' || outcome === 'recovery-error' ? 'exit code 7'
                            : outcome === 'relaunch-error' ? 'Cannot relaunch' : 'Cannot start');
                    if (outcome === 'recovery-error') {
                        expect(reason).toContain('Cannot reopen app.');
                        await expect(fs.stat(marker)).rejects.toThrow();
                    } else {
                        // Recovery has no --updated argument and retains the helper token.
                        expect((await fs.readFile(marker, 'utf8')).trim()).toBe('');
                    }
                }
            } finally {
                await fs.rm(root, { recursive: true, force: true });
            }
        },
        30_000,
    );
});

describe('Windows detached launch', () => {
    it.skipIf(process.platform !== 'win32')('executes the helper rather than silently exiting before the script starts', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'win-update-launch-'));
        try {
            await launchWindowsUpdate({
                download: {
                    installerPath: path.join(root, 'missing-installer.exe'),
                    tempDir: root,
                    cleanup: async () => {},
                },
                execPath: path.join(root, 'missing-app.exe'),
                // Windows process IDs are multiples of four, so this PID cannot exist.
                oldPid: 2147483647,
            });
            // A failed installer must reach the helper's catch, not disappear at startup.
            await vi.waitFor(async () => {
                expect((await fs.readFile(path.join(root, 'install-error.txt'), 'utf8')).trim()).not.toBe('');
            }, { timeout: 20_000 });
        } finally {
            await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
    }, 30_000);

    // Harmless PowerShell children replace setup/app, but process creation, token
    // inheritance, parent exit, detached cmd and the generated helper are real.
    // Exercise the direct launch on either kind of runner; this cannot grant elevation.
    it.skipIf(process.platform !== 'win32').each([0, 7])(
        'retains the helper token after parent exit and setup code %s', async exitCode => {
            const root = await fs.mkdtemp(path.join(os.tmpdir(), 'win-update-token-'));
            const updateDir = path.join(root, "O'Brien $literal");
            const marker = path.join(root, 'app-token');
            const helperMarker = path.join(root, 'helper-token');
            const psLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;
            const encode = (script: string) => Buffer.from(script, 'utf16le').toString('base64');
            const powershell = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows',
                'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
            try {
                await fs.mkdir(updateDir);
                const options = { ...fixture(), execPath: powershell, systemRoot: process.env.SystemRoot ?? 'C:\\Windows' };
                options.download.tempDir = updateDir;
                options.download.installerPath = powershell;
                const probe = '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)';
                const { stdout } = await promisify(execFile)(powershell,
                    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encode(probe)]);
                const childScript = `${probe} | Set-Content -LiteralPath ${psLiteral(marker)}`;
                const script = windowsInstallScript(options)
                    .replace('    $app.Arguments = $arguments',
                        `    $app.Arguments = '-NoProfile -NonInteractive -EncodedCommand ${encode(childScript)}'`)
                    .replace('    $setup = ', `    $elevated | Set-Content -LiteralPath ${psLiteral(helperMarker)}
    $start.Arguments = '-NoProfile -NonInteractive -Command "exit ${exitCode}"'
    $setup = `)
                    // Select the helper-owned success launch even on standard CI.
                    .replaceAll('if ($elevated)', 'if ($true)')
                    // Extra probe code must also fit cmd's encoded command line.
                    .replace(/^[ \t]+/gm, '').replace(/^#.*\r?\n/gm, '');
                // Use the production launcher arguments, then let a short-lived Node
                // parent supply its real PID and exit, leaving cmd/PowerShell alive.
                const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
                const spawn = vi.fn(() => child);
                const launch = launchWindowsUpdate(options, spawn as never);
                child.emit('spawn');
                await launch;
                const [file, args, config] = spawn.mock.calls[0] as unknown as [string, string[], object];
                expect(encode(script).length + args.slice(0, -1).join(' ').length).toBeLessThan(8191);
                const parent = `const { spawn } = require('node:child_process');
const [file, args, config, script] = JSON.parse(process.argv[1]);
args[args.length - 1] = Buffer.from(script.replace('$oldPid = 1234', '$oldPid = ' + process.pid), 'utf16le').toString('base64');
const child = spawn(file, args, config);
child.on('error', () => process.exit(1));
child.on('spawn', () => child.unref());`;
                await promisify(execFile)(process.execPath, ['-e', parent, JSON.stringify([file, args, config, script])]);
                await vi.waitFor(async () => {
                    expect((await fs.readFile(marker, 'utf8')).trim())
                        .toBe(stdout.trim());
                    expect((await fs.readFile(helperMarker, 'utf8')).trim()).toBe(stdout.trim());
                    if (exitCode === 0) {
                        await expect(fs.stat(updateDir)).rejects.toThrow();
                    } else {
                        expect(await fs.readFile(path.join(updateDir, 'install-error.txt'), 'utf8')).toContain('exit code 7');
                    }
                }, { timeout: 25_000 });
            } finally {
                await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
            }
        }, 40_000,
    );

    it('allows quit only after helper spawn succeeds, preserves installer until helper completion', async () => {
        const options = fixture();
        const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
        const spawn = vi.fn(() => child);
        const quit = vi.fn();
        const launch = launchWindowsUpdate(options, spawn as never).then(quit);
        expect(quit).not.toHaveBeenCalled();
        expect(child.unref).not.toHaveBeenCalled();
        child.emit('spawn');
        await launch;
        expect(child.unref).toHaveBeenCalledOnce();
        expect(quit).toHaveBeenCalledOnce();
        const [file, args, config] = spawn.mock.calls[0] as unknown as [string, string[], object];
        expect(file).toBe(String.raw`C:\Windows\System32\cmd.exe`);
        expect(args.slice(0, -1)).toEqual([
            '/d', '/s', '/c', '.\\powershell.exe',
            '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
        ]);
        expect(Buffer.from(args.at(-1)!, 'base64').toString('utf16le')).toBe(windowsInstallScript(options));
        expect(config).toEqual({
            detached: true, stdio: 'ignore', windowsHide: true,
            cwd: String.raw`C:\Windows\System32\WindowsPowerShell\v1.0`,
        });
        expect(options.download.cleanup).not.toHaveBeenCalled();
    });

    it('keeps paths and shell metacharacters out of the command launcher arguments', async () => {
        const options = fixture();
        options.systemRoot = String.raw`D:\Windows & %tools%`;
        options.download.tempDir = String.raw`D:\O'Brien $HOME & %temp%`;
        const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
        const spawn = vi.fn(() => child);
        const launch = launchWindowsUpdate(options, spawn as never);
        child.emit('spawn');
        await launch;
        const [file, args, config] = spawn.mock.calls[0] as unknown as [string, string[], { cwd: string }];
        expect(file).toBe(path.win32.join(options.systemRoot, 'System32', 'cmd.exe'));
        expect(config.cwd).toBe(path.win32.join(options.systemRoot, 'System32', 'WindowsPowerShell', 'v1.0'));
        expect(args.join(' ')).not.toContain(options.systemRoot);
        expect(args.join(' ')).not.toContain(options.download.tempDir);
        expect(Buffer.from(args.at(-1)!, 'base64').toString('utf16le')).toBe(windowsInstallScript(options));
    });

    it('propagates spawn errors without quitting or deleting the verified update', async () => {
        const options = fixture();
        const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
        const quit = vi.fn();
        const launch = launchWindowsUpdate(options, (() => child) as never).then(quit);
        child.emit('error', new Error('PowerShell unavailable'));
        await expect(launch).rejects.toThrow('PowerShell unavailable');
        expect(quit).not.toHaveBeenCalled();
        expect(child.unref).not.toHaveBeenCalled();
        expect(options.download.cleanup).not.toHaveBeenCalled();
    });

    it('propagates synchronous spawn errors', async () => {
        await expect(launchWindowsUpdate(fixture(), (() => { throw new Error('spawn failed'); }) as never))
            .rejects.toThrow('spawn failed');
    });

    it('validates before starting any process', async () => {
        const spawn = vi.fn();
        await expect(launchWindowsUpdate({ ...fixture(), systemRoot: 'relative' }, spawn)).rejects.toThrow('path');
        expect(spawn).not.toHaveBeenCalled();
    });
});
