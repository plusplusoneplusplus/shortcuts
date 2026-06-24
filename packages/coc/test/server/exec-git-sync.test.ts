/**
 * Tests for execGitShellAsync and execGitArgsAsync helpers in api-handler.ts.
 *
 * execGitShellAsync: string-based, uses child_process.exec (async) for non-WSL paths.
 * execGitArgsAsync: array-based, delegates to forge execGitAsync (WSL-aware).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock forge's execGitAsync for execGitArgsAsync (which now delegates to it)
const mockForgeExecGitAsync = vi.fn();
vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        execGitAsync: (...args: any[]) => mockForgeExecGitAsync(...args),
    };
});

// Mock child_process.exec (callback-style) for execGitShellAsync (non-WSL paths)
const mockExec = vi.fn();
const mockExecFile = vi.fn();
vi.mock('child_process', () => ({
    exec: (...args: any[]) => mockExec(...args),
    execFile: (...args: any[]) => mockExecFile(...args),
}));

import { execGitShellAsync, execGitArgsAsync } from '../../src/server/core/api-handler';

/** Configure the mocked exec to invoke its callback with the given stdout. */
function execReturns(stdout: string): void {
    mockExec.mockImplementation((_cmd: string, _opts: any, cb: (err: unknown, stdout: string) => void) => {
        cb(null, stdout);
    });
}

describe('execGitShellAsync', () => {
    beforeEach(() => {
        mockExec.mockReset();
        execReturns('');
    });

    it('should run git with args via exec and trim output', async () => {
        execReturns('output\n');
        const result = await execGitShellAsync('status', '/repo');
        expect(result).toBe('output');
        expect(mockExec).toHaveBeenCalledWith(
            expect.stringContaining('git status'),
            expect.objectContaining({ cwd: '/repo', encoding: 'utf-8' }),
            expect.any(Function),
        );
    });

    it('should double caret (^) on Windows to prevent cmd.exe stripping', async () => {
        const origPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        try {
            execReturns('');
            await execGitShellAsync('log abc123^!', '/repo');
            expect(mockExec).toHaveBeenCalledWith(
                'git log abc123^^!',
                expect.objectContaining({ cwd: '/repo' }),
                expect.any(Function),
            );
        } finally {
            Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
        }
    });

    it('should double multiple carets on Windows', async () => {
        const origPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        try {
            execReturns('');
            await execGitShellAsync('show abc^:path HEAD^', '/repo');
            expect(mockExec).toHaveBeenCalledWith(
                'git show abc^^:path HEAD^^',
                expect.objectContaining({ cwd: '/repo' }),
                expect.any(Function),
            );
        } finally {
            Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
        }
    });

    it('should not double caret on non-Windows platforms', async () => {
        const origPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
        try {
            execReturns('');
            await execGitShellAsync('log abc123^!', '/repo');
            expect(mockExec).toHaveBeenCalledWith(
                'git log abc123^!',
                expect.objectContaining({ cwd: '/repo' }),
                expect.any(Function),
            );
        } finally {
            Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
        }
    });

    it('should reject when exec reports an error', async () => {
        mockExec.mockImplementation((_cmd: string, _opts: any, cb: (err: unknown) => void) => {
            cb(new Error('git failed'));
        });
        await expect(execGitShellAsync('status', '/repo')).rejects.toThrow('git failed');
    });
});

describe('execGitArgsAsync', () => {
    beforeEach(() => {
        mockForgeExecGitAsync.mockReset();
        mockForgeExecGitAsync.mockResolvedValue('');
    });

    it('should delegate to forge execGitAsync with args and cwd', async () => {
        mockForgeExecGitAsync.mockResolvedValue('output');
        const result = await execGitArgsAsync(['log', '--oneline'], '/repo');
        expect(result).toBe('output');
        expect(mockForgeExecGitAsync).toHaveBeenCalledWith(
            ['log', '--oneline'],
            '/repo',
            expect.objectContaining({ timeout: 5000 }),
        );
    });

    it('should pass caret (^) through without modification', async () => {
        mockForgeExecGitAsync.mockResolvedValue('');
        await execGitArgsAsync(['log', '--format=%H', '-z', 'abc123^!'], '/repo');
        expect(mockForgeExecGitAsync).toHaveBeenCalledWith(
            ['log', '--format=%H', '-z', 'abc123^!'],
            '/repo',
            expect.anything(),
        );
    });

    it('should trim output', async () => {
        mockForgeExecGitAsync.mockResolvedValue('  result  ');
        expect(await execGitArgsAsync(['status'], '/repo')).toBe('result');
    });

    it('should propagate errors from forge execGitAsync', async () => {
        mockForgeExecGitAsync.mockRejectedValue(new Error('fatal: bad revision'));
        await expect(execGitArgsAsync(['log', 'bad^!'], '/repo')).rejects.toThrow('fatal: bad revision');
    });

    it('is WSL-aware: routes to forge execGitAsync which handles WSL paths', async () => {
        const wslPath = '\\\\wsl$\\Ubuntu\\home\\user\\repo';
        mockForgeExecGitAsync.mockResolvedValue('main');
        const result = await execGitArgsAsync(['branch', '--show-current'], wslPath);
        expect(result).toBe('main');
        expect(mockForgeExecGitAsync).toHaveBeenCalledWith(
            ['branch', '--show-current'],
            wslPath,
            expect.objectContaining({ timeout: 5000 }),
        );
    });
});
