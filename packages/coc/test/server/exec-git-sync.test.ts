/**
 * Tests for execGitSync and execGitArgsSync helpers in api-handler.ts.
 *
 * execGitSync: string-based, uses child_process.execSync for non-WSL paths.
 * execGitArgsSync: array-based, delegates to forge execGit (WSL-aware).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock forge's execGit for execGitArgsSync (which now delegates to it)
const mockForgeExecGit = vi.fn();
vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        execGit: (...args: any[]) => mockForgeExecGit(...args),
    };
});

// Keep child_process mock for execGitSync (still uses execSync for non-WSL paths)
const mockExecSync = vi.fn();
const mockExecFileSync = vi.fn();
vi.mock('child_process', () => ({
    execSync: (...args: any[]) => mockExecSync(...args),
    execFileSync: (...args: any[]) => mockExecFileSync(...args),
}));

import { execGitSync, execGitArgsSync } from '../../src/server/api-handler';

describe('execGitSync', () => {
    beforeEach(() => {
        mockExecSync.mockReset();
        mockExecSync.mockReturnValue('');
    });

    it('should run git with args via execSync', () => {
        mockExecSync.mockReturnValue('output\n');
        const result = execGitSync('status', '/repo');
        expect(result).toBe('output');
        expect(mockExecSync).toHaveBeenCalledWith(
            expect.stringContaining('git status'),
            expect.objectContaining({ cwd: '/repo', encoding: 'utf-8' }),
        );
    });

    it('should double caret (^) on Windows to prevent cmd.exe stripping', () => {
        const origPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        try {
            mockExecSync.mockReturnValue('');
            execGitSync('log abc123^!', '/repo');
            expect(mockExecSync).toHaveBeenCalledWith(
                'git log abc123^^!',
                expect.objectContaining({ cwd: '/repo' }),
            );
        } finally {
            Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
        }
    });

    it('should double multiple carets on Windows', () => {
        const origPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        try {
            mockExecSync.mockReturnValue('');
            execGitSync('show abc^:path HEAD^', '/repo');
            expect(mockExecSync).toHaveBeenCalledWith(
                'git show abc^^:path HEAD^^',
                expect.objectContaining({ cwd: '/repo' }),
            );
        } finally {
            Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
        }
    });

    it('should not double caret on non-Windows platforms', () => {
        const origPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
        try {
            mockExecSync.mockReturnValue('');
            execGitSync('log abc123^!', '/repo');
            expect(mockExecSync).toHaveBeenCalledWith(
                'git log abc123^!',
                expect.objectContaining({ cwd: '/repo' }),
            );
        } finally {
            Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
        }
    });
});

describe('execGitArgsSync', () => {
    beforeEach(() => {
        mockForgeExecGit.mockReset();
        mockForgeExecGit.mockReturnValue('');
    });

    it('should delegate to forge execGit with args and cwd', () => {
        mockForgeExecGit.mockReturnValue('output');
        const result = execGitArgsSync(['log', '--oneline'], '/repo');
        expect(result).toBe('output');
        expect(mockForgeExecGit).toHaveBeenCalledWith(
            ['log', '--oneline'],
            '/repo',
            expect.objectContaining({ timeout: 5000 }),
        );
    });

    it('should pass caret (^) through without modification', () => {
        mockForgeExecGit.mockReturnValue('');
        execGitArgsSync(['log', '--format=%H', '-z', 'abc123^!'], '/repo');
        expect(mockForgeExecGit).toHaveBeenCalledWith(
            ['log', '--format=%H', '-z', 'abc123^!'],
            '/repo',
            expect.anything(),
        );
    });

    it('should trim output', () => {
        mockForgeExecGit.mockReturnValue('  result  ');
        expect(execGitArgsSync(['status'], '/repo')).toBe('result');
    });

    it('should propagate errors from forge execGit', () => {
        mockForgeExecGit.mockImplementation(() => {
            throw new Error('fatal: bad revision');
        });
        expect(() => execGitArgsSync(['log', 'bad^!'], '/repo')).toThrow('fatal: bad revision');
    });

    it('is WSL-aware: routes to forge execGit which handles WSL paths', () => {
        const wslPath = '\\\\wsl$\\Ubuntu\\home\\user\\repo';
        mockForgeExecGit.mockReturnValue('main');
        const result = execGitArgsSync(['branch', '--show-current'], wslPath);
        expect(result).toBe('main');
        expect(mockForgeExecGit).toHaveBeenCalledWith(
            ['branch', '--show-current'],
            wslPath,
            expect.objectContaining({ timeout: 5000 }),
        );
    });
});
