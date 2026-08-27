/**
 * Resolving the `safe.directory` entry, and the sync ensure that still spawns.
 *
 * The async ensure moved to the native addon, so its tests moved too — to
 * `safe-directory-native.test.ts`, where they drive a real `git config` against
 * a temp global config file instead of asserting which child process Node was
 * asked to start. What is left here is the win32-only path arithmetic and the
 * sync ensure, which keeps its `execFileSync` until AC-08 deletes `execGit`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'child_process';
import {
    clearGitSafeDirectoryCache,
    ensureGitSafeDirectorySync,
    resolveGitSafeDirectory,
} from '../../src/git/safe-directory';
import { getDefaultWslDistro } from '../../src/utils/workspace-execution';

vi.mock('child_process', () => ({
    execFileSync: vi.fn(),
}));

vi.mock('../../src/utils/workspace-execution', () => ({
    getDefaultWslDistro: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);
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
});
