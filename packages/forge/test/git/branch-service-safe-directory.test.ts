import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync, execSync } from 'child_process';
import { execAsync, execFileAsync } from '../../src/utils/exec-utils';
import { ensureGitSafeDirectoryAsync, ensureGitSafeDirectorySync } from '../../src/git/safe-directory';
import { BranchService } from '../../src/git/branch-service';

vi.mock('child_process', () => ({
    execSync: vi.fn(),
    execFileSync: vi.fn(),
}));

vi.mock('../../src/utils/exec-utils', () => ({
    execAsync: vi.fn(),
    execFileAsync: vi.fn(),
}));

vi.mock('../../src/git/safe-directory', () => ({
    ensureGitSafeDirectorySync: vi.fn(),
    ensureGitSafeDirectoryAsync: vi.fn(),
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
const mockedExecFileSync = vi.mocked(execFileSync);
const mockedExecAsync = vi.mocked(execAsync);
const mockedExecFileAsync = vi.mocked(execFileAsync);
const mockedEnsureGitSafeDirectorySync = vi.mocked(ensureGitSafeDirectorySync);
const mockedEnsureGitSafeDirectoryAsync = vi.mocked(ensureGitSafeDirectoryAsync);

describe('BranchService safe-directory integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('ensures trust before sync git commands', () => {
        mockedExecSync.mockReturnValue('*|main|init|2 hours ago\n');

        const service = new BranchService();
        service.getLocalBranches(process.platform === 'win32' ? 'C:\\repo' : '/repo');

        expect(mockedEnsureGitSafeDirectorySync).toHaveBeenCalledWith(process.platform === 'win32' ? 'C:\\repo' : '/repo');
    });

    it('ensures trust before async git commands', async () => {
        mockedEnsureGitSafeDirectoryAsync.mockResolvedValue();
        mockedExecAsync.mockResolvedValue({ stdout: 'abc123\n', stderr: '' });

        const service = new BranchService();
        await service.getBranchStatus(process.platform === 'win32' ? 'C:\\repo' : '/repo', false);

        expect(mockedEnsureGitSafeDirectoryAsync).toHaveBeenCalledWith(process.platform === 'win32' ? 'C:\\repo' : '/repo');
    });

    it.runIf(process.platform === 'win32')('uses wsl.exe for sync WSL git commands after trust is ensured', () => {
        mockedExecFileSync.mockReturnValue('*|main|init|2 hours ago\n');

        const service = new BranchService();
        service.getLocalBranches('\\\\wsl$\\Ubuntu-24.04\\home\\georgeqiao\\repo');

        expect(mockedEnsureGitSafeDirectorySync).toHaveBeenCalledWith('\\\\wsl$\\Ubuntu-24.04\\home\\georgeqiao\\repo');
        expect(mockedExecFileSync).toHaveBeenCalledWith(
            expect.stringContaining('wsl.exe'),
            ['-d', 'Ubuntu-24.04', '--cd', '/home/georgeqiao/repo', '--', 'sh', '-lc', expect.stringContaining('git branch --format=')],
            expect.objectContaining({ windowsHide: true }),
        );
        expect(mockedExecSync).not.toHaveBeenCalled();
    });

    it.runIf(process.platform === 'win32')('uses wsl.exe for async WSL git commands after trust is ensured', async () => {
        mockedEnsureGitSafeDirectoryAsync.mockResolvedValue();
        mockedExecFileAsync.mockResolvedValue({ stdout: ' M file.ts\n', stderr: '' });

        const service = new BranchService();
        const dirty = await service.hasUncommittedChanges('\\\\wsl$\\Ubuntu-24.04\\home\\georgeqiao\\repo');

        expect(dirty).toBe(true);
        expect(mockedEnsureGitSafeDirectoryAsync).toHaveBeenCalledWith('\\\\wsl$\\Ubuntu-24.04\\home\\georgeqiao\\repo');
        expect(mockedExecFileAsync).toHaveBeenCalledWith(
            expect.stringContaining('wsl.exe'),
            ['-d', 'Ubuntu-24.04', '--cd', '/home/georgeqiao/repo', '--', 'sh', '-lc', 'git status --porcelain'],
            expect.objectContaining({ windowsHide: true }),
        );
        expect(mockedExecAsync).not.toHaveBeenCalled();
    });
});
