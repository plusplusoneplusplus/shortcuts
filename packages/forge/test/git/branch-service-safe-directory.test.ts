import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'child_process';
import { execAsync } from '../../src/utils/exec-utils';
import { ensureGitSafeDirectoryAsync, ensureGitSafeDirectorySync } from '../../src/git/safe-directory';
import { BranchService } from '../../src/git/branch-service';

vi.mock('child_process', () => ({
    execSync: vi.fn(),
}));

vi.mock('../../src/utils/exec-utils', () => ({
    execAsync: vi.fn(),
}));

vi.mock('../../src/git/safe-directory', () => ({
    ensureGitSafeDirectorySync: vi.fn(),
    ensureGitSafeDirectoryAsync: vi.fn(),
}));

const mockedExecSync = vi.mocked(execSync);
const mockedExecAsync = vi.mocked(execAsync);
const mockedEnsureGitSafeDirectorySync = vi.mocked(ensureGitSafeDirectorySync);
const mockedEnsureGitSafeDirectoryAsync = vi.mocked(ensureGitSafeDirectoryAsync);

describe('BranchService safe-directory integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('ensures trust before sync git commands', () => {
        mockedExecSync.mockReturnValue('*|main|init|2 hours ago\n');

        const service = new BranchService();
        service.getLocalBranches('\\\\wsl$\\Ubuntu-24.04\\home\\georgeqiao\\repo');

        expect(mockedEnsureGitSafeDirectorySync).toHaveBeenCalledWith('\\\\wsl$\\Ubuntu-24.04\\home\\georgeqiao\\repo');
    });

    it('ensures trust before async git commands', async () => {
        mockedEnsureGitSafeDirectoryAsync.mockResolvedValue();
        mockedExecAsync.mockResolvedValue({ stdout: 'abc123\n', stderr: '' });

        const service = new BranchService();
        await service.getBranchStatus('\\\\wsl$\\Ubuntu-24.04\\home\\georgeqiao\\repo', false);

        expect(mockedEnsureGitSafeDirectoryAsync).toHaveBeenCalledWith('\\\\wsl$\\Ubuntu-24.04\\home\\georgeqiao\\repo');
    });
});
