/**
 * The three git callers that answer a failure with silence keep a broken addon
 * loud.
 *
 * `resolveParentHash` says "no parent", `getFileDiff` says "no diff for this
 * file" and `gitHeadSha` says "no baseline" — each the right answer for a
 * directory that is not a repository, and the wrong one for a binary that is
 * missing or too old, where the repository is full of history nobody can read.
 * A commit rendered entirely as added lines, or a Ralph session silently
 * missing its baseline, is worse than a message naming the rebuild.
 *
 * The stub spreads the real module rather than replacing it, and rejects with a
 * real `NativeAddonLoadError`: every one of these callers narrows with
 * `instanceof`, so a look-alike would prove nothing.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';

vi.mock('@plusplusoneplusplus/forge/git', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge/git')>();
    return { ...actual, execGitAsync: vi.fn() };
});

import { execGitAsync } from '@plusplusoneplusplus/forge/git';
import { resolveParentHash } from '../../src/server/executors/commit-chat-executor';
import { getFileDiff } from '../../src/server/llm-tools/diff-line-mapper';
import { gitHeadSha } from '../../src/server/ralph/capture-baseline-sha';

const REBUILD = 'npm run build:native -w packages/coc-native';
const mockExecGitAsync = execGitAsync as unknown as ReturnType<typeof vi.fn>;

describe('git callers without a usable addon', () => {
    beforeEach(() => {
        mockExecGitAsync.mockReset();
        mockExecGitAsync.mockRejectedValue(
            new NativeAddonLoadError(
                `coc-native.node is missing the git capability — rebuild it with \`${REBUILD}\`.`,
            ),
        );
    });

    it('resolveParentHash rejects rather than reporting no parent', async () => {
        await expect(resolveParentHash('abc123', '/repo')).rejects.toThrow(REBUILD);
    });

    it('getFileDiff rejects rather than blaming the file', async () => {
        // The `git show` fallback fails the same way, so without the guard the
        // per-file message is the one the user would have seen.
        await expect(getFileDiff('/repo', 'p', 'c', 'a.txt')).rejects.toThrow(REBUILD);
        expect(mockExecGitAsync).toHaveBeenCalledTimes(1);
    });

    it('gitHeadSha rejects rather than reporting no baseline', async () => {
        await expect(gitHeadSha('/repo')).rejects.toThrow(REBUILD);
    });

    it('resolveParentHash still answers "no parent" for its own guard clauses', async () => {
        // The guards run before any git does, so a broken addon cannot reach
        // them — the empty string is still the answer for a missing argument.
        await expect(resolveParentHash('', '/repo')).resolves.toBe('');
        await expect(resolveParentHash('abc123', undefined)).resolves.toBe('');
        expect(mockExecGitAsync).not.toHaveBeenCalled();
    });
});

describe('git callers against a directory git cannot read', () => {
    beforeEach(() => {
        mockExecGitAsync.mockReset();
        mockExecGitAsync.mockRejectedValue(
            new Error('git rev-parse HEAD failed: not a git repository'),
        );
    });

    it('resolveParentHash answers with the empty string', async () => {
        await expect(resolveParentHash('abc123', '/repo')).resolves.toBe('');
    });

    it('getFileDiff falls back, then blames the file', async () => {
        await expect(getFileDiff('/repo', 'p', 'c', 'a.txt')).rejects.toThrow(
            'Failed to retrieve diff for a.txt',
        );
        expect(mockExecGitAsync).toHaveBeenCalledTimes(2);
    });

    it('gitHeadSha answers undefined', async () => {
        await expect(gitHeadSha('/repo')).resolves.toBeUndefined();
    });
});
