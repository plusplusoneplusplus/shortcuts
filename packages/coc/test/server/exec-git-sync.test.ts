/**
 * Tests for execGitSync and execGitArgsSync helpers in api-handler.ts.
 *
 * Verifies Windows caret (^) escaping and shell-safe array-form execution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
        mockExecFileSync.mockReset();
        mockExecFileSync.mockReturnValue('');
    });

    it('should call execFileSync with args array (bypasses shell)', () => {
        mockExecFileSync.mockReturnValue('output\n');
        const result = execGitArgsSync(['log', '--oneline'], '/repo');
        expect(result).toBe('output');
        expect(mockExecFileSync).toHaveBeenCalledWith(
            'git',
            ['log', '--oneline'],
            expect.objectContaining({ cwd: '/repo', encoding: 'utf-8' }),
        );
    });

    it('should pass caret (^) through without modification', () => {
        mockExecFileSync.mockReturnValue('');
        execGitArgsSync(['log', '--format=%H', '-z', 'abc123^!'], '/repo');
        expect(mockExecFileSync).toHaveBeenCalledWith(
            'git',
            ['log', '--format=%H', '-z', 'abc123^!'],
            expect.objectContaining({ cwd: '/repo' }),
        );
    });

    it('should trim output', () => {
        mockExecFileSync.mockReturnValue('  result  ');
        expect(execGitArgsSync(['status'], '/repo')).toBe('result');
    });

    it('should propagate errors from execFileSync', () => {
        mockExecFileSync.mockImplementation(() => {
            throw new Error('fatal: bad revision');
        });
        expect(() => execGitArgsSync(['log', 'bad^!'], '/repo')).toThrow('fatal: bad revision');
    });
});
