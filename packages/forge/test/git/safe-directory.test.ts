import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { execFileAsync } from '../../src/utils/exec-utils';
import {
    clearGitSafeDirectoryCache,
    ensureGitSafeDirectoryAsync,
    ensureGitSafeDirectorySync,
    resolveGitSafeDirectory,
} from '../../src/git/safe-directory';
import { getDefaultWslDistro } from '../../src/utils/workspace-execution';

vi.mock('child_process', () => ({
    execFileSync: vi.fn(),
}));

vi.mock('../../src/utils/exec-utils', () => ({
    execFileAsync: vi.fn(),
}));

vi.mock('../../src/utils/workspace-execution', () => ({
    getDefaultWslDistro: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);
const mockedExecFileAsync = vi.mocked(execFileAsync);
const mockedGetDefaultWslDistro = vi.mocked(getDefaultWslDistro);

describe('safe-directory', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearGitSafeDirectoryCache();
        mockedGetDefaultWslDistro.mockReturnValue(undefined);
    });

    it('resolves Git for Windows safe.directory entries for WSL UNC paths', () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        try {
            expect(resolveGitSafeDirectory('\\\\wsl$\\Ubuntu-24.04\\home\\georgeqiao\\repo')).toBe(
                '%(prefix)///wsl$/Ubuntu-24.04/home/georgeqiao/repo',
            );
            expect(resolveGitSafeDirectory('\\\\wsl.localhost\\Ubuntu\\home\\me\\repo\\')).toBe(
                '%(prefix)///wsl.localhost/Ubuntu/home/me/repo',
            );
        } finally {
            Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
        }
    });

    it('resolves Linux-style WSL paths using the default distro on Windows', () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        mockedGetDefaultWslDistro.mockReturnValue('Ubuntu-24.04');
        try {
            expect(resolveGitSafeDirectory('/home/georgeqiao/repo')).toBe(
                '%(prefix)///wsl$/Ubuntu-24.04/home/georgeqiao/repo',
            );
        } finally {
            Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
        }
    });

    it('skips non-WSL paths and non-Windows hosts', () => {
        expect(resolveGitSafeDirectory('C:\\src\\repo')).toBeUndefined();

        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
        try {
            expect(resolveGitSafeDirectory('\\\\wsl$\\Ubuntu\\home\\me\\repo')).toBeUndefined();
        } finally {
            Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
        }
    });

    it('adds a missing safe.directory entry once in sync mode', () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        mockedExecFileSync
            .mockReturnValueOnce('')
            .mockReturnValueOnce('');
        try {
            const repoRoot = '\\\\wsl$\\Ubuntu-24.04\\home\\georgeqiao\\repo';
            ensureGitSafeDirectorySync(repoRoot);
            ensureGitSafeDirectorySync(repoRoot);

            expect(mockedExecFileSync).toHaveBeenCalledTimes(2);
            expect(mockedExecFileSync).toHaveBeenNthCalledWith(
                1,
                'git',
                ['config', '--global', '--get-all', 'safe.directory'],
                expect.objectContaining({ encoding: 'utf-8', windowsHide: true }),
            );
            expect(mockedExecFileSync).toHaveBeenNthCalledWith(
                2,
                'git',
                ['config', '--global', '--add', 'safe.directory', '%(prefix)///wsl$/Ubuntu-24.04/home/georgeqiao/repo'],
                expect.objectContaining({ encoding: 'utf-8', windowsHide: true }),
            );
        } finally {
            Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
        }
    });

    it('does not add an entry that is already configured in async mode', async () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        mockedExecFileAsync.mockResolvedValueOnce({
            stdout: '%(prefix)///wsl$/Ubuntu-24.04/home/georgeqiao/repo\n',
            stderr: '',
        });
        try {
            await ensureGitSafeDirectoryAsync('\\\\wsl$\\Ubuntu-24.04\\home\\georgeqiao\\repo');

            expect(mockedExecFileAsync).toHaveBeenCalledTimes(1);
            expect(mockedExecFileAsync).toHaveBeenCalledWith(
                'git',
                ['config', '--global', '--get-all', 'safe.directory'],
                expect.objectContaining({ windowsHide: true }),
            );
        } finally {
            Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
        }
    });

    it('deduplicates concurrent async ensure operations for the same repo', async () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

        let resolveConfigured: ((value: { stdout: string; stderr: string }) => void) | undefined;
        const configuredPromise = new Promise<{ stdout: string; stderr: string }>(resolve => {
            resolveConfigured = resolve;
        });
        let resolveAdd: ((value: { stdout: string; stderr: string }) => void) | undefined;
        const addPromise = new Promise<{ stdout: string; stderr: string }>(resolve => {
            resolveAdd = resolve;
        });

        mockedExecFileAsync
            .mockImplementationOnce(() => configuredPromise)
            .mockImplementationOnce(() => addPromise);

        try {
            const repoRoot = '\\\\wsl$\\Ubuntu-24.04\\home\\georgeqiao\\repo';
            const first = ensureGitSafeDirectoryAsync(repoRoot);
            const second = ensureGitSafeDirectoryAsync(repoRoot);

            expect(mockedExecFileAsync).toHaveBeenCalledTimes(1);

            resolveConfigured?.({ stdout: '', stderr: '' });
            await Promise.resolve();
            resolveAdd?.({ stdout: '', stderr: '' });
            await Promise.all([first, second]);
            await ensureGitSafeDirectoryAsync(repoRoot);

            expect(mockedExecFileAsync).toHaveBeenCalledTimes(2);
            expect(mockedExecFileAsync).toHaveBeenNthCalledWith(
                1,
                'git',
                ['config', '--global', '--get-all', 'safe.directory'],
                expect.objectContaining({ windowsHide: true }),
            );
            expect(mockedExecFileAsync).toHaveBeenNthCalledWith(
                2,
                'git',
                ['config', '--global', '--add', 'safe.directory', '%(prefix)///wsl$/Ubuntu-24.04/home/georgeqiao/repo'],
                expect.objectContaining({ windowsHide: true }),
            );
        } finally {
            Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
        }
    });
});
