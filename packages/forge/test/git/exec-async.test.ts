/**
 * Tests for execGitAsync — the async counterpart to execGit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execGitAsync } from '../../src/git/exec';
import { execFileAsync } from '../../src/utils/exec-utils';

vi.mock('child_process', () => ({
    execSync: vi.fn(),
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

    it('passes git -C <repoRoot> with the provided args as an array', async () => {
        mockedExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

        await execGitAsync(['log', '--oneline'], '/my/repo');

        expect(mockedExecFileAsync).toHaveBeenCalledWith(
            'git',
            ['-C', '/my/repo', 'log', '--oneline'],
            expect.objectContaining({ windowsHide: true }),
        );
    });

    it('passes paths with spaces as a single discrete argument (not shell-split)', async () => {
        mockedExecFileAsync.mockResolvedValue({ stdout: 'main\n', stderr: '' });

        await execGitAsync(['rev-parse', '--abbrev-ref', 'HEAD'], '/Users/John Doe/my repo');

        expect(mockedExecFileAsync).toHaveBeenCalledWith(
            'git',
            ['-C', '/Users/John Doe/my repo', 'rev-parse', '--abbrev-ref', 'HEAD'],
            expect.objectContaining({ windowsHide: true }),
        );
    });

    it('passes Windows paths with spaces as a single discrete argument', async () => {
        mockedExecFileAsync.mockResolvedValue({ stdout: 'main\n', stderr: '' });

        await execGitAsync(['status'], 'C:\\My Projects\\my repo');

        expect(mockedExecFileAsync).toHaveBeenCalledWith(
            'git',
            ['-C', 'C:\\My Projects\\my repo', 'status'],
            expect.objectContaining({ windowsHide: true }),
        );
    });

    it('rejects with stderr message on failure', async () => {
        mockedExecFileAsync.mockRejectedValue(
            Object.assign(new Error('fail'), { stderr: 'fatal: not a git repository' }),
        );

        await expect(execGitAsync(['status'], '/bad'))
            .rejects.toThrow('git status failed: fatal: not a git repository');
    });

    it('rejects with empty error when stderr is blank', async () => {
        mockedExecFileAsync.mockRejectedValue(new Error('fail'));

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
