/**
 * Unit tests for the pure auto-pull tick logic (no React).
 *
 * Covers the single-flight guard (AC-3), the dirty-tree pre-check and the
 * failed-pull notify branch (AC-4), the async-job / sync-success paths, the
 * server 409 single-flight no-op, and the poller-callback wrapper.
 */

import { describe, it, expect, vi } from 'vitest';
import type { GitWorkingTreeChange } from '@plusplusoneplusplus/coc-client';
import {
    runAutoPullTick,
    hasBlockingChanges,
    buildAutoPullPollerCallbacks,
    AUTO_PULL_MESSAGES,
    type AutoPullTickDeps,
} from '../../../../../src/server/spa/client/react/features/git/autoPullTick';

function change(stage: string): GitWorkingTreeChange {
    return {
        filePath: 'a.ts',
        status: 'M',
        stage,
        repositoryRoot: '/repo',
        repositoryName: 'repo',
    };
}

/** Default deps: clean tree, pull returns a job id. Override per test. */
function makeDeps(overrides: Partial<AutoPullTickDeps> = {}): AutoPullTickDeps {
    return {
        isPullInFlight: vi.fn(() => false),
        getWorkingTreeChanges: vi.fn(async () => ({ changes: [] as GitWorkingTreeChange[] })),
        pull: vi.fn(async () => ({ jobId: 'job-1' })),
        onJobStarted: vi.fn(),
        onSyncSuccess: vi.fn(),
        onSkip: vi.fn(),
        setInFlight: vi.fn(),
        ...overrides,
    };
}

describe('hasBlockingChanges', () => {
    it('is false for a clean tree', () => {
        expect(hasBlockingChanges([])).toBe(false);
    });

    it('ignores untracked files (they do not block a rebase)', () => {
        expect(hasBlockingChanges([change('untracked'), change('untracked')])).toBe(false);
    });

    it('is true when there are staged changes', () => {
        expect(hasBlockingChanges([change('untracked'), change('staged')])).toBe(true);
    });

    it('is true when there are unstaged changes', () => {
        expect(hasBlockingChanges([change('unstaged')])).toBe(true);
    });
});

describe('runAutoPullTick', () => {
    it('is a no-op when a pull is already in flight (single-flight, AC-3)', async () => {
        const deps = makeDeps({ isPullInFlight: vi.fn(() => true) });
        const outcome = await runAutoPullTick(deps);

        expect(outcome).toBe('skipped-in-flight');
        expect(deps.getWorkingTreeChanges).not.toHaveBeenCalled();
        expect(deps.pull).not.toHaveBeenCalled();
        expect(deps.onSkip).not.toHaveBeenCalled();
    });

    it('skips and notifies on a dirty working tree without pulling (AC-4)', async () => {
        const deps = makeDeps({
            getWorkingTreeChanges: vi.fn(async () => ({ changes: [change('unstaged')] })),
        });
        const outcome = await runAutoPullTick(deps);

        expect(outcome).toBe('skipped-dirty');
        expect(deps.onSkip).toHaveBeenCalledWith(AUTO_PULL_MESSAGES.dirty);
        expect(deps.pull).not.toHaveBeenCalled();
        expect(deps.setInFlight).not.toHaveBeenCalled();
    });

    it('starts the async pull job and hands the id to the poller on a clean tree', async () => {
        const deps = makeDeps();
        const outcome = await runAutoPullTick(deps);

        expect(outcome).toBe('started-job');
        expect(deps.setInFlight).toHaveBeenCalledWith(true);
        expect(deps.onJobStarted).toHaveBeenCalledWith('job-1');
        expect(deps.onSkip).not.toHaveBeenCalled();
    });

    it('handles a synchronous success (no job id)', async () => {
        const deps = makeDeps({ pull: vi.fn(async () => ({ success: true })) });
        const outcome = await runAutoPullTick(deps);

        expect(outcome).toBe('synced');
        expect(deps.onSyncSuccess).toHaveBeenCalledTimes(1);
        expect(deps.setInFlight).toHaveBeenLastCalledWith(false);
        expect(deps.onSkip).not.toHaveBeenCalled();
    });

    it('notifies on a synchronous failed pull with the server error (AC-4 failed-pull)', async () => {
        const deps = makeDeps({
            pull: vi.fn(async () => ({ success: false, error: 'could not fast-forward' })),
        });
        const outcome = await runAutoPullTick(deps);

        expect(outcome).toBe('failed');
        expect(deps.onSkip).toHaveBeenCalledWith(`${AUTO_PULL_MESSAGES.failedPrefix}could not fast-forward`);
        expect(deps.setInFlight).toHaveBeenLastCalledWith(false);
        expect(deps.onJobStarted).not.toHaveBeenCalled();
    });

    it('skips and notifies when the dirty pre-check itself fails', async () => {
        const deps = makeDeps({
            getWorkingTreeChanges: vi.fn(async () => { throw new Error('offline'); }),
        });
        const outcome = await runAutoPullTick(deps);

        expect(outcome).toBe('skipped-precheck-error');
        expect(deps.onSkip).toHaveBeenCalledWith(AUTO_PULL_MESSAGES.precheckError);
        expect(deps.pull).not.toHaveBeenCalled();
    });

    it('treats a server 409 as a silent no-op (server single-flight)', async () => {
        const err = Object.assign(new Error('conflict'), { status: 409 });
        const deps = makeDeps({ pull: vi.fn(async () => { throw err; }) });
        const outcome = await runAutoPullTick(deps);

        expect(outcome).toBe('skipped-in-flight');
        expect(deps.onSkip).not.toHaveBeenCalled();
        // Flag toggled true before the attempt, then cleared.
        expect(deps.setInFlight).toHaveBeenNthCalledWith(1, true);
        expect(deps.setInFlight).toHaveBeenLastCalledWith(false);
    });

    it('notifies with a generic message on a non-409 thrown pull error', async () => {
        const deps = makeDeps({ pull: vi.fn(async () => { throw new Error('boom'); }) });
        const outcome = await runAutoPullTick(deps);

        expect(outcome).toBe('failed');
        expect(deps.onSkip).toHaveBeenCalledWith(
            `${AUTO_PULL_MESSAGES.failedPrefix}${AUTO_PULL_MESSAGES.genericFailure}`,
        );
        expect(deps.setInFlight).toHaveBeenLastCalledWith(false);
    });
});

describe('buildAutoPullPollerCallbacks', () => {
    it('clears the flag and refreshes on job success', () => {
        const setInFlight = vi.fn();
        const onSuccess = vi.fn();
        const onFailure = vi.fn();
        const cb = buildAutoPullPollerCallbacks({ setInFlight, onSuccess, onFailure });

        cb.onSuccess?.();
        expect(setInFlight).toHaveBeenCalledWith(false);
        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(onFailure).not.toHaveBeenCalled();
    });

    it('surfaces a failed job as a prefixed toast (AC-4)', () => {
        const setInFlight = vi.fn();
        const onFailure = vi.fn();
        const cb = buildAutoPullPollerCallbacks({ setInFlight, onSuccess: vi.fn(), onFailure });

        cb.onFailure?.('merge conflict', { id: 'j', workspaceId: 'w', op: 'pull', status: 'failed', startedAt: '' });
        expect(setInFlight).toHaveBeenCalledWith(false);
        expect(onFailure).toHaveBeenCalledWith(`${AUTO_PULL_MESSAGES.failedPrefix}merge conflict`);
    });

    it('uses the generic message when the failed job has no error string', () => {
        const onFailure = vi.fn();
        const cb = buildAutoPullPollerCallbacks({ setInFlight: vi.fn(), onSuccess: vi.fn(), onFailure });

        cb.onFailure?.(undefined, { id: 'j', workspaceId: 'w', op: 'pull', status: 'failed', startedAt: '' });
        expect(onFailure).toHaveBeenCalledWith(
            `${AUTO_PULL_MESSAGES.failedPrefix}${AUTO_PULL_MESSAGES.genericFailure}`,
        );
    });

    it('clears the flag when a poll request throws', () => {
        const setInFlight = vi.fn();
        const cb = buildAutoPullPollerCallbacks({ setInFlight, onSuccess: vi.fn(), onFailure: vi.fn() });

        cb.onError?.(new Error('network'));
        expect(setInFlight).toHaveBeenCalledWith(false);
    });
});
