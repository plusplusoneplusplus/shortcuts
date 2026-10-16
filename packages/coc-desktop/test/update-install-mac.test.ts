import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { posix as path } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import {
    launchMacUpdate, macInstallHelper, prepareMacUpdate, validateMacInstallLocation,
    type MacInstallDependencies,
} from '../src/update-install-mac';

function fixture() {
    const deps: MacInstallDependencies = {
        fs: {
            realpath: vi.fn(async p => String(p)),
            access: vi.fn(async () => {}),
            mkdtemp: vi.fn(async prefix => `${prefix}stage`),
            mkdir: vi.fn(async () => undefined),
            writeFile: vi.fn(async () => {}),
            rm: vi.fn(async () => {}),
        },
        run: vi.fn(async () => ''),
    };
    const download = {
        installerPath: path.resolve('/temp/update.dmg'), tempDir: path.resolve('/temp/update'),
        cleanup: vi.fn(async () => {}),
    };
    const bundle = path.resolve('/Applications/CoC.app');
    return { deps, download, bundle, options: { deps, download, appBundle: bundle, oldPid: 1234 } };
}

describe('macOS install location', () => {
    it('resolves aliases and checks both bundle and parent writability', async () => {
        const { deps, bundle } = fixture();
        vi.mocked(deps.fs.realpath).mockResolvedValue(bundle);
        expect(await validateMacInstallLocation('/alias', deps)).toBe(bundle);
        expect(deps.fs.access).toHaveBeenCalledWith(bundle, 2);
        expect(deps.fs.access).toHaveBeenCalledWith(path.dirname(bundle), 2);
    });

    it('rejects translocation before any mount or write checks', async () => {
        const { deps } = fixture();
        await expect(validateMacInstallLocation('/private/var/AppTranslocation/id/d/CoC.app', deps))
            .rejects.toThrow('translocated');
        expect(deps.run).not.toHaveBeenCalled();
    });

    it.each(['bundle', 'parent'])('rejects an unwritable %s', async failing => {
        const { deps, bundle } = fixture();
        vi.mocked(deps.fs.access).mockImplementation(async p => {
            if (p === (failing === 'bundle' ? bundle : path.dirname(bundle))) throw new Error('EACCES');
        });
        await expect(validateMacInstallLocation(bundle, deps)).rejects.toThrow('not writable');
    });

    it('detects DMGs at arbitrary mount paths and decodes escaped names', async () => {
        const { deps } = fixture();
        vi.mocked(deps.run).mockResolvedValue('<key>mount-point</key>\n<string>/custom/A &amp; B</string>');
        await expect(validateMacInstallLocation('/custom/A & B/CoC.app', deps)).rejects.toThrow('disk image');
        await expect(validateMacInstallLocation('/custom/A & B-other/CoC.app', deps)).resolves.toBeDefined();
    });

    it('fails closed when disk-image inspection fails', async () => {
        const { deps, bundle } = fixture();
        vi.mocked(deps.run).mockRejectedValue(new Error('hdiutil failed'));
        await expect(validateMacInstallLocation(bundle, deps)).rejects.toThrow('hdiutil failed');
    });
});

describe('macOS staging', () => {
    it('mounts readonly, validates, stages beside target and detaches before returning', async () => {
        const { deps, download, bundle, options } = fixture();
        const prepared = await prepareMacUpdate(options);
        const stage = `${path.join(path.dirname(bundle), '.coc-update-')}stage`;
        const mount = path.join(stage, 'image');
        expect(deps.run).toHaveBeenNthCalledWith(2, '/usr/bin/hdiutil', [
            'attach', download.installerPath, '-readonly', '-nobrowse', '-mountpoint', mount,
        ]);
        expect(deps.run).toHaveBeenNthCalledWith(3, '/usr/bin/ditto', [
            path.join(mount, 'CoC.app'), path.join(stage, 'CoC.app'),
        ]);
        expect(deps.run).toHaveBeenNthCalledWith(4, '/usr/bin/hdiutil', ['detach', mount]);
        expect(deps.fs.writeFile).toHaveBeenCalledWith(prepared.helperPath, macInstallHelper, { mode: 0o700 });
        expect(prepared.helperArgs).toEqual(['1234', bundle, stage, download.tempDir]);
        expect(prepared.stageDir).toBe(stage);
        expect(deps.fs.rm).not.toHaveBeenCalled();
        await prepared.cleanup();
        expect(deps.fs.rm).toHaveBeenCalledWith(stage, { recursive: true, force: true });
        expect(download.cleanup).not.toHaveBeenCalled();
    });

    it.each(['attach', 'ditto', 'access', 'write'])('cleans staging after %s failure and retains download', async failure => {
        const { deps, options, download } = fixture();
        vi.mocked(deps.run).mockImplementation(async (file, args) => {
            if (args[0] === failure || (failure === 'ditto' && file.endsWith('/ditto'))) throw new Error(failure);
            return '';
        });
        if (failure === 'access') vi.mocked(deps.fs.access).mockImplementation(async p => {
            if (String(p).endsWith('Info.plist')) throw new Error('access');
        });
        if (failure === 'write') vi.mocked(deps.fs.writeFile).mockRejectedValue(new Error('write'));
        await expect(prepareMacUpdate(options)).rejects.toThrow(failure);
        if (failure === 'attach') {
            expect(deps.run).toHaveBeenLastCalledWith('/usr/bin/hdiutil', ['info', '-plist']);
        } else {
            expect(deps.run).toHaveBeenCalledWith('/usr/bin/hdiutil', ['detach', expect.any(String)]);
        }
        expect(deps.fs.rm).toHaveBeenCalled();
        expect(download.cleanup).not.toHaveBeenCalled();
    });

    it('detaches a partial mount after attach failure', async () => {
        const { deps, options } = fixture();
        const mount = path.join(path.dirname(options.appBundle), '.coc-update-stage', 'image');
        vi.mocked(deps.run).mockImplementation(async (_, args) => {
            if (args[0] === 'attach') throw new Error('attach failed');
            return `<key>mount-point</key><string>${mount}</string>`;
        });
        await expect(prepareMacUpdate(options)).rejects.toThrow('attach failed');
        expect(deps.run).toHaveBeenCalledWith('/usr/bin/hdiutil', ['detach', mount]);
        expect(deps.fs.rm).toHaveBeenCalled();
    });

    it('reports detach failure and preserves the mount directory', async () => {
        const { deps, options } = fixture();
        vi.mocked(deps.run).mockImplementation(async (_, args) => {
            if (args[0] === 'detach') throw new Error('busy');
            return '';
        });
        await expect(prepareMacUpdate(options)).rejects.toThrow('Could not detach');
        expect(deps.fs.rm).not.toHaveBeenCalled();
        expect(deps.fs.writeFile).not.toHaveBeenCalled();
    });

    it('rejects invalid PIDs before staging', async () => {
        const { options, deps } = fixture();
        await expect(prepareMacUpdate({ ...options, oldPid: 0 })).rejects.toThrow('PID');
        expect(deps.fs.mkdtemp).not.toHaveBeenCalled();
    });
});

describe('detached helper', () => {
    it('launches detached and resolves only when spawn succeeds', async () => {
        const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
        const spawnFn = vi.fn(() => child);
        const launch = launchMacUpdate({ helperPath: '/temp/helper', helperArgs: ['123'], stageDir: '/apps/stage', cleanup: vi.fn() }, spawnFn as never);
        expect(child.unref).not.toHaveBeenCalled();
        child.emit('spawn');
        await launch;
        expect(spawnFn).toHaveBeenCalledWith('/bin/sh', ['/temp/helper', '123'], {
            detached: true, stdio: 'ignore', cwd: '/',
        });
        expect(child.unref).toHaveBeenCalledOnce();
    });

    it('reports spawn failure so caller can keep the app running', async () => {
        const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
        const launch = launchMacUpdate({ helperPath: '/temp/helper', helperArgs: [], stageDir: '/apps/stage', cleanup: vi.fn() }, (() => child) as never);
        child.emit('error', new Error('spawn failed'));
        await expect(launch).rejects.toThrow('spawn failed');
        expect(child.unref).not.toHaveBeenCalled();
    });

    it('waits for the old PID and clears quarantine before relaunch', () => {
        expect(macInstallHelper).toContain('while kill -0 "$old_pid"');
        expect(macInstallHelper).toContain('waited" -ge 300');
        expect(macInstallHelper.indexOf('while kill')).toBeLessThan(macInstallHelper.indexOf('/bin/mv "$target"'));
        expect(macInstallHelper).toContain('/usr/bin/xattr -dr com.apple.quarantine "$target"');
        expect(macInstallHelper).toContain('/usr/bin/open "$target"');
    });

    // Execute the actual shell algorithm with only macOS commands replaced by fixtures.
    it.skipIf(process.platform === 'win32').each(['success', 'no-quarantine', 'swap', 'inspect', 'quarantine', 'relaunch'])(
        'executes %s with correct rollback and cleanup', async outcome => {
            const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mac-helper-'));
            try {
                // Apostrophes and shell substitutions must remain literal path characters.
                const target = path.join(root, "CoC ' $(literal).app");
                const stage = path.join(root, 'stage');
                const update = path.join(root, 'update');
                await fs.mkdir(target);
                await fs.writeFile(path.join(target, 'version'), 'old');
                await fs.mkdir(path.join(stage, 'CoC.app'), { recursive: true });
                await fs.writeFile(path.join(stage, 'CoC.app', 'version'), 'new');
                await fs.mkdir(update);
                let script = macInstallHelper
                    .replace('/usr/bin/xattr -r "$target"', outcome === 'inspect' ? 'false'
                        : outcome === 'no-quarantine' ? 'true' : "printf 'com.apple.quarantine\\n'")
                    .replace('/usr/bin/xattr -dr com.apple.quarantine "$target"', ['quarantine', 'no-quarantine'].includes(outcome) ? 'false' : 'true')
                    .replaceAll('/usr/bin/open "$target"', outcome === 'relaunch' ? 'false' : 'true');
                if (outcome === 'swap') script = script.replace('/bin/mv "$staged" "$target"', 'false');
                const helper = path.join(root, 'helper.sh');
                await fs.writeFile(helper, script);
                const result = promisify(execFile)('/bin/sh', [helper, '2147483647', target, stage, update]);
                if (outcome === 'success' || outcome === 'no-quarantine') {
                    await result;
                    expect(await fs.readFile(path.join(target, 'version'), 'utf8')).toBe('new');
                    await expect(fs.stat(stage)).rejects.toThrow();
                    await expect(fs.stat(update)).rejects.toThrow();
                } else {
                    await expect(result).rejects.toThrow();
                    expect(await fs.readFile(path.join(target, 'version'), 'utf8')).toBe('old');
                    expect(await fs.readFile(path.join(update, 'install-error.txt'), 'utf8')).toMatch(/Could not/);
                }
            } finally {
                await fs.rm(root, { recursive: true, force: true });
            }
        },
    );
});
