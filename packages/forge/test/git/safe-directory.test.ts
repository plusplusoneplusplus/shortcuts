/**
 * Resolving the `safe.directory` entry — the win32-only path arithmetic that
 * stays in TypeScript because Rust is decided never to learn about WSL.
 *
 * The ensure itself runs its two `git config --global` calls in the native
 * addon, so its tests live in `safe-directory-native.test.ts`, where they drive
 * a real `git config` against a temp global config file instead of asserting
 * which child process Node was asked to start. Since AC-08 deleted the sync
 * ensure, this module spawns nothing at all.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearGitSafeDirectoryCache,
    resolveGitSafeDirectory,
} from '../../src/git/safe-directory';
import { getDefaultWslDistro } from '../../src/utils/workspace-execution';

vi.mock('../../src/utils/workspace-execution', () => ({
    getDefaultWslDistro: vi.fn(),
}));

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
});
