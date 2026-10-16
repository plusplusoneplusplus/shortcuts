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
        expect(script.indexOf('$oldProcess.WaitForExit')).toBeLessThan(script.indexOf('[System.Diagnostics.Process]::Start'));
        expect(script).toContain(String.raw`$start.Arguments = '/S --force-run /D=D:\My Programs\CoC'`);
        expect(script).toContain('$start.UseShellExecute = $false');
        expect(script).toContain('$setup.WaitForExit()');
        expect(script).toContain('$setup.ExitCode -ne 0');
        expect(script).toContain('install-error.txt');
        expect(script).toContain('Start-Process -FilePath $executable');
        expect(script.indexOf('$setup.WaitForExit()')).toBeLessThan(script.indexOf('Remove-Item'));
        expect(script).not.toMatch(/Stop-Process|taskkill/);
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
    it.skipIf(process.platform !== 'win32').each(['success', 'start-error', 'exit-code', 'timeout'])(
        'executes %s with diagnostics, relaunch and cleanup', async outcome => {
            const root = await fs.mkdtemp(path.join(os.tmpdir(), 'win-update-'));
            const updateDir = path.join(root, "O'Brien $literal");
            const marker = path.join(root, 'relaunched');
            const psLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;
            try {
                await fs.mkdir(updateDir);
                const options = fixture();
                options.download.tempDir = updateDir;
                let script = windowsInstallScript(options)
                    .replace('Get-Process -Id $oldPid -ErrorAction SilentlyContinue', outcome === 'timeout'
                        ? "(New-Object PSObject | Add-Member ScriptMethod WaitForExit { param($ms) return $false } -PassThru)"
                        : '$null')
                    .replace('[System.Diagnostics.Process]::Start($start)', outcome === 'start-error'
                        ? "$(throw 'Cannot start installer.')"
                        : `(New-Object PSObject | Add-Member NoteProperty ExitCode ${outcome === 'exit-code' ? 7 : 0} -PassThru | Add-Member ScriptMethod WaitForExit {} -PassThru)`)
                    .replace('Start-Process -FilePath $executable', `Set-Content -LiteralPath ${psLiteral(marker)} -Value 'reopened'`);
                // Check the actual .NET ProcessStartInfo construction on the host.
                script = script.replace('$setup = ', `if ($start.Arguments -ne '/S --force-run /D=D:\\My Programs\\CoC') { throw 'Wrong installer arguments.' }\n    $setup = `);
                const command = Buffer.from(script, 'utf16le').toString('base64');
                const result = promisify(execFile)(path.win32.join(process.env.SystemRoot ?? 'C:\\Windows',
                    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
                ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', command]);
                if (outcome === 'success') {
                    await result;
                    await expect(fs.stat(updateDir)).rejects.toThrow();
                    await expect(fs.stat(marker)).rejects.toThrow();
                } else {
                    await expect(result).rejects.toThrow();
                    const reason = await fs.readFile(path.join(updateDir, 'install-error.txt'), 'utf8');
                    expect(reason).toContain(outcome === 'timeout' ? 'Timed out' : outcome === 'exit-code' ? 'exit code 7' : 'Cannot start');
                    expect(await fs.readFile(marker, 'utf8')).toContain('reopened');
                }
            } finally {
                await fs.rm(root, { recursive: true, force: true });
            }
        },
        30_000,
    );
});

describe('Windows detached launch', () => {
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
        expect(file).toBe(String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`);
        expect(args.slice(0, -1)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand']);
        expect(Buffer.from(args.at(-1)!, 'base64').toString('utf16le')).toBe(windowsInstallScript(options));
        expect(config).toEqual({ detached: true, stdio: 'ignore', windowsHide: true, cwd: options.systemRoot });
        expect(options.download.cleanup).not.toHaveBeenCalled();
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
