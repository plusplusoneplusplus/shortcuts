import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exec, execSync } from 'child_process';
import { ensureGitSafeDirectoryAsync, ensureGitSafeDirectorySync } from '../../src/git/safe-directory';
import { execGit, execGitAsync } from '../../src/git/exec';

vi.mock('child_process', () => ({
    execSync: vi.fn(),
    exec: vi.fn(),
}));

vi.mock('../../src/git/safe-directory', () => ({
    ensureGitSafeDirectorySync: vi.fn(),
    ensureGitSafeDirectoryAsync: vi.fn(),
}));

const mockedExecSync = vi.mocked(execSync);
const mockedExec = vi.mocked(exec);
const mockedEnsureGitSafeDirectorySync = vi.mocked(ensureGitSafeDirectorySync);
const mockedEnsureGitSafeDirectoryAsync = vi.mocked(ensureGitSafeDirectoryAsync);

describe('exec safe-directory integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('wraps sync safe-directory setup failures with the git error contract', () => {
        const error = new Error('lock failed') as Error & { stderr: string };
        error.stderr = 'fatal: could not lock config file';
        mockedEnsureGitSafeDirectorySync.mockImplementation(() => {
            throw error;
        });

        expect(() => execGit(['status'], '/repo')).toThrow(
            'git status failed: fatal: could not lock config file',
        );
        expect(mockedExecSync).not.toHaveBeenCalled();
    });

    it('wraps async safe-directory setup failures with the git error contract', async () => {
        const error = new Error('lock failed') as Error & { stderr: string };
        error.stderr = 'fatal: could not lock config file';
        mockedEnsureGitSafeDirectoryAsync.mockRejectedValue(error);

        await expect(execGitAsync(['status'], '/repo')).rejects.toThrow(
            'git status failed: fatal: could not lock config file',
        );
        expect(mockedExec).not.toHaveBeenCalled();
    });
});
