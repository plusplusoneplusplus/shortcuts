import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exec, execSync } from 'child_process';
import { ensureGitSafeDirectoryAsync, ensureGitSafeDirectorySync } from '../../src/git/safe-directory';
import { execGit, execGitAsync } from '../../src/git/exec';

vi.mock('child_process', () => ({
    execSync: vi.fn(),
    exec: vi.fn(),
    execFileSync: vi.fn(),
}));

vi.mock('../../src/git/safe-directory', () => ({
    ensureGitSafeDirectorySync: vi.fn(),
    ensureGitSafeDirectoryAsync: vi.fn(),
}));

vi.mock('../../src/utils/exec-utils', () => ({
    execFileAsync: vi.fn(),
}));

vi.mock('../../src/utils/workspace-execution', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/utils/workspace-execution')>();
    return {
        ...actual,
        getWslExecutablePath: vi.fn().mockReturnValue('C:\\Windows\\System32\\wsl.exe'),
        resolveWorkspaceExecutionContext: vi.fn((workingDirectory?: string) => {
            if (workingDirectory?.startsWith('\\\\wsl$')) {
                return actual.resolveWorkspaceExecutionContext(workingDirectory);
            }
            return { kind: 'windows', workingDirectory };
        }),
    };
});

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
