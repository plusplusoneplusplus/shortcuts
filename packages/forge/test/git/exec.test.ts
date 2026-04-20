/**
 * Tests for execGit — the synchronous git command executor.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';
import { execGit } from '../../src/git/exec';

vi.mock('child_process', () => ({
    execFileSync: vi.fn(),
    execSync: vi.fn(),
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

const mockedExecFileSync = vi.mocked(execFileSync);

describe('execGit', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns trimmed stdout on success', () => {
        mockedExecFileSync.mockReturnValue('main\n');

        const result = execGit(['rev-parse', '--abbrev-ref', 'HEAD'], '/repo');
        expect(result).toBe('main');
    });

    it('strips \\r\\n from stdout', () => {
        mockedExecFileSync.mockReturnValue('main\r\n');

        const result = execGit(['rev-parse', 'HEAD'], '/repo');
        expect(result).toBe('main');
    });

    it('passes git -C <repoRoot> with args as a discrete array', () => {
        mockedExecFileSync.mockReturnValue('');

        execGit(['log', '--oneline'], '/my/repo');

        expect(mockedExecFileSync).toHaveBeenCalledWith(
            'git',
            ['-C', '/my/repo', 'log', '--oneline'],
            expect.objectContaining({ windowsHide: true }),
        );
    });

    it('handles paths with spaces on Linux/macOS without shell-splitting', () => {
        mockedExecFileSync.mockReturnValue('main\n');

        execGit(['rev-parse', '--abbrev-ref', 'HEAD'], '/Users/John Doe/my repo');

        expect(mockedExecFileSync).toHaveBeenCalledWith(
            'git',
            ['-C', '/Users/John Doe/my repo', 'rev-parse', '--abbrev-ref', 'HEAD'],
            expect.objectContaining({ windowsHide: true }),
        );
    });

    it('handles Windows paths with spaces without shell-splitting', () => {
        mockedExecFileSync.mockReturnValue('main\n');

        execGit(['status'], 'C:\\My Projects\\my repo');

        expect(mockedExecFileSync).toHaveBeenCalledWith(
            'git',
            ['-C', 'C:\\My Projects\\my repo', 'status'],
            expect.objectContaining({ windowsHide: true }),
        );
    });

    it('throws a descriptive error on failure', () => {
        mockedExecFileSync.mockImplementation(() => {
            throw Object.assign(new Error('fail'), { stderr: 'fatal: not a git repository' });
        });

        expect(() => execGit(['status'], '/bad'))
            .toThrow('git status failed: fatal: not a git repository');
    });

    it('applies custom maxBuffer and timeout', () => {
        mockedExecFileSync.mockReturnValue('');

        execGit(['status'], '/repo', { maxBuffer: 2048, timeout: 10_000 });

        expect(mockedExecFileSync).toHaveBeenCalledWith(
            'git',
            expect.any(Array),
            expect.objectContaining({ maxBuffer: 2048, timeout: 10_000 }),
        );
    });

    it('uses default maxBuffer and timeout when no options given', () => {
        mockedExecFileSync.mockReturnValue('');

        execGit(['status'], '/repo');

        expect(mockedExecFileSync).toHaveBeenCalledWith(
            'git',
            expect.any(Array),
            expect.objectContaining({ maxBuffer: 50 * 1024 * 1024, timeout: 30_000 }),
        );
    });

    it.runIf(process.platform === 'win32')('routes WSL repos through wsl.exe', () => {
        mockedExecFileSync.mockReturnValue('main\n');

        const repoRoot = String.raw`\\wsl$\Ubuntu\home\tester\repo`;
        const result = execGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);

        expect(result).toBe('main');
        expect(mockedExecFileSync).toHaveBeenCalledWith(
            expect.stringContaining('wsl.exe'),
            ['-d', 'Ubuntu', '--cd', '/home/tester/repo', '--', 'git', '-C', '/home/tester/repo', 'rev-parse', '--abbrev-ref', 'HEAD'],
            expect.objectContaining({ windowsHide: true }),
        );
    });
});
