/**
 * The sync kernel keeps a broken addon loud.
 *
 * Every `catch` in `sync-git.ts` turns a failed command into a routine sync
 * outcome, and a missing or stale native binary fails exactly the same way.
 * `isUsable()` is the one that matters most: answering `false` makes the
 * transaction delete the mirror and re-clone it, so a swallowed load error
 * would throw away the user's mirror on every tick and blame the remote.
 *
 * The stub spreads the real module rather than replacing it, and rejects with a
 * real `NativeAddonLoadError`, because the guard narrows with `instanceof`.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';

vi.mock('@plusplusoneplusplus/forge/git', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge/git')>();
    return { ...actual, execGitAsync: vi.fn() };
});

import { execGitAsync } from '@plusplusoneplusplus/forge/git';
import { SyncGitRepository } from '../../src/server/sync/sync-git';

const REBUILD = 'npm run build:native -w packages/coc-native';
const mockExecGitAsync = execGitAsync as unknown as ReturnType<typeof vi.fn>;
const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

function kernel(): SyncGitRepository {
    return new SyncGitRepository('/mirror', silentLogger);
}

describe('the sync kernel without a usable addon', () => {
    beforeEach(() => {
        mockExecGitAsync.mockReset();
        mockExecGitAsync.mockRejectedValue(
            new NativeAddonLoadError(
                `coc-native.node is missing the git capability — rebuild it with \`${REBUILD}\`.`,
            ),
        );
    });

    it('isUsable rejects rather than condemning the mirror', async () => {
        await expect(kernel().isUsable()).rejects.toThrow(REBUILD);
    });

    it('hasRemoteCommits and hasRemoteChanges reject rather than reporting an idle tick', async () => {
        await expect(kernel().hasRemoteCommits()).rejects.toThrow(REBUILD);
        await expect(kernel().hasRemoteChanges()).rejects.toThrow(REBUILD);
    });

    it('stageAll rejects rather than claiming there is something to commit', async () => {
        await expect(kernel().stageAll(new Set())).rejects.toThrow(REBUILD);
    });

    it('pull rejects rather than reporting an unreachable remote', async () => {
        await expect(kernel().pull()).rejects.toThrow(REBUILD);
    });

    it('defaultBranch rejects rather than falling back to the current branch', async () => {
        await expect(kernel().defaultBranch()).rejects.toThrow(REBUILD);
    });

    it('ensureRemote rejects rather than trying to add a remote that exists', async () => {
        await expect(kernel().ensureRemote('git@example.test:notes.git')).rejects.toThrow(REBUILD);
        // The `remote add` retry never ran: the guard fired inside the catch.
        expect(mockExecGitAsync).toHaveBeenCalledTimes(1);
    });
});

describe('the sync kernel against a directory git cannot read', () => {
    beforeEach(() => {
        mockExecGitAsync.mockReset();
        mockExecGitAsync.mockRejectedValue(
            new Error('git rev-parse --is-inside-work-tree failed: not a git repository'),
        );
    });

    it('still reads an ordinary git failure as the sync outcome it always was', async () => {
        await expect(kernel().isUsable()).resolves.toBe(false);
        await expect(kernel().hasRemoteCommits()).resolves.toBe(false);
        await expect(kernel().hasRemoteChanges()).resolves.toBe(false);
        await expect(kernel().defaultBranch()).resolves.toBeNull();
    });
});
