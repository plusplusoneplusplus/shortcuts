/**
 * Tests for execGitAsync — the async counterpart to execGit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exec } from 'child_process';
import { execGitAsync } from '../../src/git/exec';

vi.mock('child_process', () => ({
    execSync: vi.fn(),
    exec: vi.fn(),
}));

const mockedExec = exec as unknown as ReturnType<typeof vi.fn>;

describe('execGitAsync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('resolves with trimmed stdout on success', async () => {
        mockedExec.mockImplementation((_cmd: string, _opts: any, cb: any) => {
            cb(null, 'main\n', '');
        });

        const result = await execGitAsync(['rev-parse', '--abbrev-ref', 'HEAD'], '/repo');
        expect(result).toBe('main');
    });

    it('strips \\r\\n from stdout', async () => {
        mockedExec.mockImplementation((_cmd: string, _opts: any, cb: any) => {
            cb(null, 'main\r\n', '');
        });

        const result = await execGitAsync(['rev-parse', 'HEAD'], '/repo');
        expect(result).toBe('main');
    });

    it('passes git -C <repoRoot> with the provided args', async () => {
        mockedExec.mockImplementation((_cmd: string, _opts: any, cb: any) => {
            cb(null, '', '');
        });

        await execGitAsync(['log', '--oneline'], '/my/repo');

        const cmd = mockedExec.mock.calls[0][0] as string;
        expect(cmd).toContain('git');
        expect(cmd).toContain('-C');
        expect(cmd).toContain('/my/repo');
        expect(cmd).toContain('log');
        expect(cmd).toContain('--oneline');
    });

    it('rejects with stderr message on failure', async () => {
        mockedExec.mockImplementation((_cmd: string, _opts: any, cb: any) => {
            cb(new Error('fail'), '', 'fatal: not a git repository');
        });

        await expect(execGitAsync(['status'], '/bad'))
            .rejects.toThrow('git status failed: fatal: not a git repository');
    });

    it('rejects with empty stderr when stderr is blank', async () => {
        mockedExec.mockImplementation((_cmd: string, _opts: any, cb: any) => {
            cb(new Error('fail'), '', '');
        });

        await expect(execGitAsync(['status'], '/bad'))
            .rejects.toThrow('git status failed:');
    });

    it('applies custom options (maxBuffer, timeout)', async () => {
        mockedExec.mockImplementation((_cmd: string, opts: any, cb: any) => {
            expect(opts.maxBuffer).toBe(1024);
            expect(opts.timeout).toBe(5000);
            cb(null, '', '');
        });

        await execGitAsync(['status'], '/repo', { maxBuffer: 1024, timeout: 5000 });
    });

    it('uses default maxBuffer and timeout when no options given', async () => {
        mockedExec.mockImplementation((_cmd: string, opts: any, cb: any) => {
            expect(opts.maxBuffer).toBe(10 * 1024 * 1024); // 10 MB
            expect(opts.timeout).toBe(30_000);
            cb(null, '', '');
        });

        await execGitAsync(['status'], '/repo');
    });
});
