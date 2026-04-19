/**
 * Tests for execGitAsync — the async counterpart to execGit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execGitAsync } from '../../src/git/exec';
import { execFileAsync } from '../../src/utils/exec-utils';

vi.mock('child_process', () => ({
    execFileSync: vi.fn(),
}));

vi.mock('../../src/utils/exec-utils', () => ({
    execFileAsync: vi.fn(),
}));

vi.mock('../../src/git/safe-directory', () => ({
    ensureGitSafeDirectorySync: vi.fn(),
    ensureGitSafeDirectoryAsync: vi.fn().mockResolvedValue(undefined),
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

const mockedExecFileAsync = vi.mocked(execFileAsync);

describe('execGitAsync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('resolves with trimmed stdout on success', async () => {
        mockedExecFileAsync.mockResolvedValue({ stdout: 'main\n', stderr: '' });

        const result = await execGitAsync(['rev-parse', '--abbrev-ref', 'HEAD'], '/repo');
        expect(result).toBe('main');
    });

    it('strips \\r\\n from stdout', async () => {
        mockedExecFileAsync.mockResolvedValue({ stdout: 'main\r\n', stderr: '' });

        const result = await execGitAsync(['rev-parse', 'HEAD'], '/repo');
        expect(result).toBe('main');
    });

    it('passes git -C <repoRoot> with the provided args', async () => {
        mockedExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

        await execGitAsync(['log', '--oneline'], '/my/repo');

        expect(mockedExecFileAsync).toHaveBeenCalledWith(
            'git',
            ['-C', '/my/repo', 'log', '--oneline'],
            expect.objectContaining({ windowsHide: true }),
        );
    });

    it('handles repo paths with spaces correctly', async () => {
        mockedExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

        await execGitAsync(['status'], '/my/repo with spaces');

        expect(mockedExecFileAsync).toHaveBeenCalledWith(
            'git',
            ['-C', '/my/repo with spaces', 'status'],
            expect.any(Object),
        );
    });

    it('rejects with stderr message on failure', async () => {
        mockedExecFileAsync.mockRejectedValue(
            Object.assign(new Error('fail'), { message: 'fail\nfatal: not a git repository' }),
        );

        await expect(execGitAsync(['status'], '/bad'))
            .rejects.toThrow('git status failed:');
    });

    it('rejects with empty stderr when stderr is blank', async () => {
        mockedExecFileAsync.mockRejectedValue(
            Object.assign(new Error('fail'), { stderr: '' }),
        );

        await expect(execGitAsync(['status'], '/bad'))
            .rejects.toThrow('git status failed:');
    });

    it('applies custom options (maxBuffer, timeout)', async () => {
        mockedExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

        await execGitAsync(['status'], '/repo', { maxBuffer: 1024, timeout: 5000 });

        expect(mockedExecFileAsync).toHaveBeenCalledWith(
            'git',
            expect.any(Array),
            expect.objectContaining({ maxBuffer: 1024, timeout: 5000 }),
        );
    });

    it('uses default maxBuffer and timeout when no options given', async () => {
        mockedExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

        await execGitAsync(['status'], '/repo');

        expect(mockedExecFileAsync).toHaveBeenCalledWith(
            'git',
            expect.any(Array),
            expect.objectContaining({ maxBuffer: 50 * 1024 * 1024, timeout: 30_000 }),
        );
    });

    it.runIf(process.platform === 'win32')('routes WSL repos through wsl.exe', async () => {
        mockedExecFileAsync.mockResolvedValue({ stdout: 'main\n', stderr: '' });

        const repoRoot = String.raw`\\wsl$\Ubuntu\home\tester\repo`;
        const result = await execGitAsync(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);

        expect(result).toBe('main');
        expect(mockedExecFileAsync).toHaveBeenCalledWith(
            expect.stringContaining('wsl.exe'),
            ['-d', 'Ubuntu', '--cd', '/home/tester/repo', '--', 'git', '-C', '/home/tester/repo', 'rev-parse', '--abbrev-ref', 'HEAD'],
            expect.objectContaining({ windowsHide: true }),
        );
    });
});
