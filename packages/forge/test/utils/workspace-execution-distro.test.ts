/**
 * The default-distro lookup: async, deduplicated, and careful about what it
 * caches.
 *
 * The lookup spawns `wsl.exe`, which on a cold WSL can take seconds, so these
 * tests pin the three properties that made it worth converting from
 * `execFileSync`: it never blocks, concurrent callers share one spawn, and a
 * transient failure stays retryable instead of disabling host-path translation
 * for the rest of the process.
 *
 * Platform is forced rather than gated on, so the win32-only behaviour is
 * covered on Linux and macOS CI too.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('child_process', async () => {
    const actual = await vi.importActual<typeof import('child_process')>('child_process');
    return { ...actual, execFile: vi.fn() };
});

import * as childProcess from 'child_process';
import {
    clearWorkspaceExecutionCaches,
    getDefaultWslDistro,
    getDefaultWslDistroAsync,
    normalizeExecutionPath,
    normalizeExecutionPathAsync,
    resolveWorkspaceExecutionContextAsync,
    translatePathForHostFilesystemAsync,
    warmWslDistroCache,
} from '../../src/utils/workspace-execution';

const WSL_LIST_OUTPUT = `
  NAME            STATE           VERSION
* Ubuntu-24.04    Running         2
  Debian          Stopped         2
`;

const originalPlatform = process.platform;
const originalSystemRoot = process.env['SystemRoot'];

function setPlatform(value: string): void {
    Object.defineProperty(process, 'platform', { value, configurable: true });
}

/** Make the mocked `execFile` answer with `stdout`, after `delayMs` ticks. */
function mockExecFileSuccess(stdout: string, delayMs = 0) {
    return vi.mocked(childProcess.execFile).mockImplementation(((
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
        setTimeout(() => callback(null, stdout, ''), delayMs);
        return {} as never;
    }) as never);
}

function mockExecFileFailure(error: NodeJS.ErrnoException) {
    return vi.mocked(childProcess.execFile).mockImplementation(((
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
        setTimeout(() => callback(error, '', ''), 0);
        return {} as never;
    }) as never);
}

describe('default WSL distro lookup', () => {
    beforeEach(() => {
        vi.mocked(childProcess.execFile).mockReset();
        clearWorkspaceExecutionCaches();
        process.env['SystemRoot'] = 'C:\\Windows';
    });

    afterEach(() => {
        setPlatform(originalPlatform);
        clearWorkspaceExecutionCaches();
        if (originalSystemRoot === undefined) {
            delete process.env['SystemRoot'];
        } else {
            process.env['SystemRoot'] = originalSystemRoot;
        }
    });

    it('never spawns on a non-Windows host', async () => {
        setPlatform('linux');
        await expect(getDefaultWslDistroAsync()).resolves.toBeUndefined();
        expect(childProcess.execFile).not.toHaveBeenCalled();
    });

    it('reads the default distro from `wsl -l -v`', async () => {
        setPlatform('win32');
        mockExecFileSuccess(WSL_LIST_OUTPUT);

        await expect(getDefaultWslDistroAsync()).resolves.toBe('Ubuntu-24.04');
        expect(childProcess.execFile).toHaveBeenCalledTimes(1);
        expect(vi.mocked(childProcess.execFile).mock.calls[0]?.[1]).toEqual(['-l', '-v']);
    });

    it('reads NUL-padded UTF-16 output the way Windows emits it', async () => {
        setPlatform('win32');
        mockExecFileSuccess(
            '\u0000*\u0000 \u0000U\u0000b\u0000u\u0000n\u0000t\u0000u\u0000-\u00002\u00004\u0000.\u00000\u00004\u0000 \u0000 \u0000 \u0000 \u0000R\u0000u\u0000n\u0000n\u0000i\u0000n\u0000g\u0000 \u0000 \u0000 \u00002\u0000\r\u0000\n\u0000',
        );

        await expect(getDefaultWslDistroAsync()).resolves.toBe('Ubuntu-24.04');
    });

    it('spawns once for concurrent callers on a cold cache', async () => {
        setPlatform('win32');
        mockExecFileSuccess(WSL_LIST_OUTPUT, 5);

        const results = await Promise.all([
            getDefaultWslDistroAsync(),
            getDefaultWslDistroAsync(),
            getDefaultWslDistroAsync(),
            getDefaultWslDistroAsync(),
        ]);

        expect(results).toEqual(['Ubuntu-24.04', 'Ubuntu-24.04', 'Ubuntu-24.04', 'Ubuntu-24.04']);
        expect(childProcess.execFile).toHaveBeenCalledTimes(1);
    });

    it('caches a resolved distro instead of spawning again', async () => {
        setPlatform('win32');
        mockExecFileSuccess(WSL_LIST_OUTPUT);

        await getDefaultWslDistroAsync();
        await getDefaultWslDistroAsync();

        expect(childProcess.execFile).toHaveBeenCalledTimes(1);
    });

    it('retries after a transient failure and resolves on the second call', async () => {
        setPlatform('win32');
        const transient = Object.assign(new Error('The Windows Subsystem for Linux is starting'), { code: 1 });
        mockExecFileFailure(transient as NodeJS.ErrnoException);

        await expect(getDefaultWslDistroAsync()).resolves.toBeUndefined();

        mockExecFileSuccess(WSL_LIST_OUTPUT);
        await expect(getDefaultWslDistroAsync()).resolves.toBe('Ubuntu-24.04');
        // Two spawns: the failure was not cached, so the second call retried.
        expect(childProcess.execFile).toHaveBeenCalledTimes(2);
    });

    it('caches a missing wsl.exe so repeated callers do not spawn again', async () => {
        setPlatform('win32');
        mockExecFileFailure(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));

        await expect(getDefaultWslDistroAsync()).resolves.toBeUndefined();
        await expect(getDefaultWslDistroAsync()).resolves.toBeUndefined();
        await expect(getDefaultWslDistroAsync()).resolves.toBeUndefined();

        expect(childProcess.execFile).toHaveBeenCalledTimes(1);
    });

    it('caches "no distros installed" without retrying', async () => {
        setPlatform('win32');
        mockExecFileSuccess('  NAME    STATE    VERSION\n');

        await expect(getDefaultWslDistroAsync()).resolves.toBeUndefined();
        await expect(getDefaultWslDistroAsync()).resolves.toBeUndefined();

        expect(childProcess.execFile).toHaveBeenCalledTimes(1);
    });

    it('treats a missing SystemRoot as a definitive absence', async () => {
        setPlatform('win32');
        delete process.env['SystemRoot'];

        await expect(getDefaultWslDistroAsync()).resolves.toBeUndefined();
        await expect(getDefaultWslDistroAsync()).resolves.toBeUndefined();

        expect(childProcess.execFile).not.toHaveBeenCalled();
    });

    it('leaves the synchronous reader as a pure cache read', async () => {
        setPlatform('win32');
        mockExecFileSuccess(WSL_LIST_OUTPUT);

        expect(getDefaultWslDistro()).toBeUndefined();
        expect(childProcess.execFile).not.toHaveBeenCalled();

        await warmWslDistroCache();
        expect(getDefaultWslDistro()).toBe('Ubuntu-24.04');
    });

    it('clears the in-flight lookup along with the value', async () => {
        setPlatform('win32');
        mockExecFileSuccess(WSL_LIST_OUTPUT);

        await warmWslDistroCache();
        clearWorkspaceExecutionCaches();
        await warmWslDistroCache();

        expect(childProcess.execFile).toHaveBeenCalledTimes(2);
    });
});

describe('async path resolution', () => {
    beforeEach(() => {
        vi.mocked(childProcess.execFile).mockReset();
        clearWorkspaceExecutionCaches();
        process.env['SystemRoot'] = 'C:\\Windows';
        mockExecFileSuccess(WSL_LIST_OUTPUT);
    });

    afterEach(() => {
        setPlatform(originalPlatform);
        clearWorkspaceExecutionCaches();
        if (originalSystemRoot === undefined) {
            delete process.env['SystemRoot'];
        } else {
            process.env['SystemRoot'] = originalSystemRoot;
        }
    });

    it('takes the distro from a UNC path without looking one up', async () => {
        setPlatform('win32');
        const context = await resolveWorkspaceExecutionContextAsync('\\\\wsl$\\Debian\\home\\me\\repo');

        expect(context).toMatchObject({ kind: 'wsl', distro: 'Debian', linuxWorkingDirectory: '/home/me/repo' });
        expect(childProcess.execFile).not.toHaveBeenCalled();
    });

    it('looks the distro up once for a bare Linux path on win32', async () => {
        setPlatform('win32');
        const context = await resolveWorkspaceExecutionContextAsync('/home/me/repo');

        expect(context).toMatchObject({ kind: 'wsl', distro: 'Ubuntu-24.04' });
        expect(childProcess.execFile).toHaveBeenCalledTimes(1);
    });

    it('does not look anything up off win32', async () => {
        setPlatform('linux');
        const context = await resolveWorkspaceExecutionContextAsync('/home/me/repo');

        expect(context.kind).toBe('windows');
        expect(childProcess.execFile).not.toHaveBeenCalled();
    });

    it('translates a bare Linux path to the UNC share for the default distro', async () => {
        setPlatform('win32');
        await expect(translatePathForHostFilesystemAsync('/home/me/repo')).resolves
            .toBe('\\\\wsl$\\Ubuntu-24.04\\home\\me\\repo');
    });

    it('throws only when the distro is genuinely absent', async () => {
        setPlatform('win32');
        mockExecFileSuccess('  NAME    STATE    VERSION\n');

        await expect(translatePathForHostFilesystemAsync('/home/me/repo')).rejects
            .toThrow('without a WSL distro');
    });

    it('gives one bare Linux path one identity across a warm-up', async () => {
        setPlatform('win32');

        const cold = normalizeExecutionPath('/home/me/repo');
        const resolved = await normalizeExecutionPathAsync('/home/me/repo');
        await warmWslDistroCache();
        const warm = normalizeExecutionPath('/home/me/repo');

        expect(resolved).toBe('wsl://ubuntu-24.04/home/me/repo');
        expect(warm).toBe(resolved);
        // The synchronous reader is the reason startup warms the cache: before
        // it is warm the same path keys under the placeholder distro.
        expect(cold).toBe('wsl://default/home/me/repo');
    });
});
