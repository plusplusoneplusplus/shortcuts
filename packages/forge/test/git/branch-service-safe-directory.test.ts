import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'child_process';
import { execAsync, execFileAsync } from '../../src/utils/exec-utils';
import { ensureGitSafeDirectoryAsync } from '../../src/git/safe-directory';
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
const mockedExecAsync = vi.mocked(execAsync);
const mockedExecFileAsync = vi.mocked(execFileAsync);
const mockedEnsureGitSafeDirectoryAsync = vi.mocked(ensureGitSafeDirectoryAsync);

describe('BranchService safe-directory integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('ensures trust before async git commands', async () => {
        mockedEnsureGitSafeDirectoryAsync.mockResolvedValue();
        mockedExecAsync.mockResolvedValue({ stdout: ' M file.ts\n', stderr: '' });

        const service = new BranchService();
        await service.hasUncommittedChanges(process.platform === 'win32' ? 'C:\\repo' : '/repo');

        expect(mockedEnsureGitSafeDirectoryAsync).toHaveBeenCalledWith(process.platform === 'win32' ? 'C:\\repo' : '/repo');
    });

    // The branch reads reach git through the addon rather than through a child
    // process, so they never touch `execGitFileAsync` — the trust call has to
    // stay on their own path or a WSL-hosted repository loses it.
    it('ensures trust before native branch reads', async () => {
        mockedEnsureGitSafeDirectoryAsync.mockResolvedValue();

        const service = new BranchService();
        await service.getLocalBranches(process.platform === 'win32' ? 'C:\\repo' : '/repo');

        expect(mockedEnsureGitSafeDirectoryAsync).toHaveBeenCalledWith(process.platform === 'win32' ? 'C:\\repo' : '/repo');
        expect(mockedExecSync).not.toHaveBeenCalled();
    });

    it.runIf(process.platform === 'win32')('uses wsl.exe for the WSL branch list after trust is ensured', async () => {
        mockedEnsureGitSafeDirectoryAsync.mockResolvedValue();
        mockedExecFileAsync.mockResolvedValue({ stdout: '  main\n', stderr: '' });

        const service = new BranchService();
        await service.getLocalBranches('\\\\wsl$\\Ubuntu-24.04\\home\\georgeqiao\\repo');

        expect(mockedEnsureGitSafeDirectoryAsync).toHaveBeenCalledWith('\\\\wsl$\\Ubuntu-24.04\\home\\georgeqiao\\repo');
        expect(mockedExecFileAsync).toHaveBeenCalledWith(
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
            // An argv, not `sh -lc '<string>'`: the migration took the shell out
            // of every git call, so the distro gets the arguments as written and
            // nothing in them needs quoting.
            ['-d', 'Ubuntu-24.04', '--cd', '/home/georgeqiao/repo', '--', 'git', 'status', '--porcelain'],
            expect.objectContaining({ windowsHide: true }),
        );
        expect(mockedExecAsync).not.toHaveBeenCalled();
    });
});
