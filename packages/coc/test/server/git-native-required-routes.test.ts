/**
 * The last three git callers in `packages/coc/src` keep a broken addon loud —
 * or, where they can, say so in words.
 *
 * Two shapes, and which one a caller gets is not a style choice:
 *
 *  - `readGitOriginRemote` and the PR full-context diff **answer with silence**.
 *    "This workspace has no origin" and "full context isn't available for this
 *    file" are the right answers for a directory that is not a repository and
 *    the wrong ones for a binary that is missing or too old, where the remote
 *    and the commits are right there and nobody can read them. Both rethrow.
 *  - The clone route **answers with words**: it already puts the failure text
 *    in front of the user at 500, so the message naming the rebuild reaches
 *    them without a guard, exactly as `WorkingTreeService.stageFile` does.
 *
 * These three import `execGitAsync`/`getRemoteUrl` from the `@plusplusoneplusplus/forge`
 * root barrel, so that is the specifier mocked here — mocking
 * `@plusplusoneplusplus/forge/git` would leave the barrel's own copy untouched
 * and every assertion would pass straight through to real git. The stub spreads
 * the real module and rejects with a real `NativeAddonLoadError`, because every
 * caller narrows with `instanceof`.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return { ...actual, execGitAsync: vi.fn(), getRemoteUrl: vi.fn() };
});

import { execGitAsync, getRemoteUrl } from '@plusplusoneplusplus/forge';
import { readGitOriginRemote } from '../../src/server/work-items/work-item-sync-github-repo';
import { cloneRepository } from '../../src/server/routes/api-git-clone-routes';
import { getFullContextFileDiff } from '../../src/server/repos/pr-routes';

const REBUILD = 'npm run build:native -w packages/coc-native';
const mockExecGitAsync = execGitAsync as unknown as ReturnType<typeof vi.fn>;
const mockGetRemoteUrl = getRemoteUrl as unknown as ReturnType<typeof vi.fn>;

function loadError(): NativeAddonLoadError {
    return new NativeAddonLoadError(
        `coc-native.node is missing the git capability — rebuild it with \`${REBUILD}\`.`,
    );
}

const PR_DATA = { baseSha: 'aaaa1111', headSha: 'bbbb2222' } as any;

describe('route-level git callers without a usable addon', () => {
    beforeEach(() => {
        mockExecGitAsync.mockReset();
        mockGetRemoteUrl.mockReset();
        mockExecGitAsync.mockRejectedValue(loadError());
        mockGetRemoteUrl.mockRejectedValue(loadError());
    });

    it('readGitOriginRemote rejects rather than reporting no origin', async () => {
        await expect(readGitOriginRemote('/repo')).rejects.toThrow(REBUILD);
    });

    it('getFullContextFileDiff rejects rather than blaming the diff', async () => {
        // Without the guard this is `{ diff: null, unavailableReason: 'git-diff-failed' }`
        // — a reason code the UI renders as "full context unavailable", which
        // says nothing about a binary that needs rebuilding.
        await expect(getFullContextFileDiff('/repo', 'origin', '42', PR_DATA, 'a.ts'))
            .rejects.toThrow(REBUILD);
        // It stops at the first crossing instead of walking the fetch candidates.
        expect(mockExecGitAsync).toHaveBeenCalledTimes(1);
    });

    it('cloneRepository carries the words to the caller, which shows them at 500', async () => {
        await expect(cloneRepository(['clone', 'https://x/y.git'], '/parent'))
            .rejects.toThrow(REBUILD);
    });
});

describe('route-level git callers against a directory git cannot read', () => {
    beforeEach(() => {
        mockExecGitAsync.mockReset();
        mockGetRemoteUrl.mockReset();
        mockExecGitAsync.mockRejectedValue(
            new Error('git diff -U99999 aaaa1111 bbbb2222 -- a.ts failed: fatal: not a git repository'),
        );
        mockGetRemoteUrl.mockResolvedValue(null);
    });

    it('readGitOriginRemote answers undefined', async () => {
        await expect(readGitOriginRemote('/repo')).resolves.toBeUndefined();
    });

    it('readGitOriginRemote answers undefined for a remote configured as blank', async () => {
        mockGetRemoteUrl.mockResolvedValue('   ');
        await expect(readGitOriginRemote('/repo')).resolves.toBeUndefined();
    });

    it('readGitOriginRemote trims the configured URL', async () => {
        mockGetRemoteUrl.mockResolvedValue('https://github.com/octo-org/octo-repo.git\n');
        await expect(readGitOriginRemote('/repo')).resolves.toBe('https://github.com/octo-org/octo-repo.git');
    });

    it('getFullContextFileDiff reports the diff unavailable', async () => {
        await expect(getFullContextFileDiff('/repo', 'origin', '42', PR_DATA, 'a.ts'))
            .resolves.toEqual({ diff: null, unavailableReason: 'git-diff-failed' });
    });

    it('still classifies a missing commit off the native wording and tries a fetch', async () => {
        // `fatal: bad object <sha>` is on stderr, which the native runner keeps —
        // so `isMissingCommitError` reads the same substring it always did, and
        // the fetch path is still reachable after the move.
        mockExecGitAsync.mockRejectedValue(
            new Error('git diff -U99999 aaaa1111 bbbb2222 -- a.ts failed: fatal: bad object aaaa1111'),
        );
        await expect(getFullContextFileDiff('/repo', 'origin', '42', PR_DATA, 'a.ts'))
            .resolves.toEqual({ diff: null, unavailableReason: 'git-fetch-failed' });
        // diff, then the two `cat-file -e` probes, then the `rev-parse --git-dir`
        // guard that stops a network fetch against a non-repository.
        expect(mockExecGitAsync).toHaveBeenCalledTimes(4);
    });

    it('getFullContextFileDiff needs both SHAs before it runs git at all', async () => {
        await expect(getFullContextFileDiff('/repo', 'origin', '42', { headSha: 'b' } as any, 'a.ts'))
            .resolves.toEqual({ diff: null, unavailableReason: 'missing-pr-shas' });
        expect(mockExecGitAsync).not.toHaveBeenCalled();
    });
});
