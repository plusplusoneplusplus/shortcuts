/**
 * `gitHeadSha` reads HEAD two different ways, and which one it picks is not a
 * detail the caller can see.
 *
 * A host checkout resolves the ref out of the object database — no child, and
 * `null` where `rev-parse HEAD` exited non-zero. A checkout inside a WSL distro
 * keeps `rev-parse HEAD`, because the addon runs git on the host and cannot
 * open the UNC spelling that reaches here. The real-repository behaviour lives
 * in `capture-baseline-sha.test.ts`; this file exists to pin the branch, which
 * a test against a host repository cannot reach.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

const mockExecGitAsync = vi.fn();
vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return { ...actual, execGitAsync: (...args: unknown[]) => mockExecGitAsync(...args) };
});

const mockGitValidateRef = vi.fn();
vi.mock('@plusplusoneplusplus/coc-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/coc-native')>();
    return {
        ...actual,
        loadNativeGit: () => ({ gitValidateRef: (...args: unknown[]) => mockGitValidateRef(...args) }),
    };
});

import { gitHeadSha } from '../../../src/server/ralph/capture-baseline-sha';

const SHA = 'a'.repeat(40);
const WSL_ROOT = '\\\\wsl$\\Ubuntu\\home\\user\\repo';
const HOST_ROOT = '/home/user/repo';

describe('gitHeadSha dispatch', () => {
    beforeEach(() => {
        mockExecGitAsync.mockReset();
        mockGitValidateRef.mockReset();
    });

    it('reads a host checkout through the addon and spawns nothing', async () => {
        mockGitValidateRef.mockResolvedValue(SHA);

        await expect(gitHeadSha(HOST_ROOT)).resolves.toBe(SHA);
        expect(mockGitValidateRef).toHaveBeenCalledWith(HOST_ROOT, 'HEAD');
        expect(mockExecGitAsync).not.toHaveBeenCalled();
    });

    it('sends a WSL checkout to the command runner instead', async () => {
        mockGitValidateRef.mockRejectedValue(new Error('should not be called'));
        mockExecGitAsync.mockResolvedValue(`${SHA}\n`);

        await expect(gitHeadSha(WSL_ROOT)).resolves.toBe(SHA);
        expect(mockExecGitAsync).toHaveBeenCalledWith(
            ['rev-parse', 'HEAD'],
            WSL_ROOT,
            expect.objectContaining({ timeout: 10_000 }),
        );
        expect(mockGitValidateRef).not.toHaveBeenCalled();
    });

    it('reads an unborn host repository as no baseline, not as an error', async () => {
        // The capability answers `null` where `rev-parse HEAD` exited non-zero.
        mockGitValidateRef.mockResolvedValue(null);
        await expect(gitHeadSha(HOST_ROOT)).resolves.toBeUndefined();
    });

    it('refuses anything that is not a 40-character SHA', async () => {
        mockGitValidateRef.mockResolvedValue('abc1234');
        await expect(gitHeadSha(HOST_ROOT)).resolves.toBeUndefined();
    });
});
