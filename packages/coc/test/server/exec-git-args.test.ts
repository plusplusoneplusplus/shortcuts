/**
 * Tests for the `execGitArgsAsync` helper in api-handler.ts.
 *
 * It is the only git runner left in that module: `execGitShellAsync` — the last
 * git command in the server built as a *shell string*, complete with a win32
 * caret-doubling hack to survive `cmd.exe` — was deleted once native git landed
 * and nothing in `src/` called it any more.
 *
 * `execGitArgsAsync` takes an args array and delegates to forge's
 * `execGitAsync`, which routes a WSL repo through `wsl.exe` and everything else
 * into the native addon.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockForgeExecGitAsync = vi.fn();
vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        execGitAsync: (...args: any[]) => mockForgeExecGitAsync(...args),
    };
});

import * as apiHandler from '../../src/server/core/api-handler';
import { execGitArgsAsync } from '../../src/server/core/api-handler';

describe('execGitShellAsync', () => {
    it('is gone: the shell-string runner has no callers and no caret hack to keep', () => {
        expect('execGitShellAsync' in apiHandler).toBe(false);
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
