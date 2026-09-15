import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    RepoQueueRegistry,
    TaskQueueManager,
    type ProviderPullRequestAutoMerge,
} from '@plusplusoneplusplus/forge';
import {
    IMPLEMENT_PLAN_PR_MERGE_POLL_INTERVAL_MS,
    ImplementPlanPrMergeWatcher,
    type ImplementPlanPrMergeSnapshot,
} from '../../src/server/queue/implement-plan-pr-merge-watcher';
import { MultiRepoQueueRouter } from '../../src/server/queue/multi-repo-queue-router';
import { createMockProcessStore } from '../helpers/mock-process-store';

const ARMED_AUTO_MERGE: ProviderPullRequestAutoMerge = {
    enabled: true,
    state: 'armed',
    mergeMethod: 'squash',
};

function restoredSubmittedGate(): TaskQueueManager {
    const manager = new TaskQueueManager({ getTaskRepoId: task => task.repoId });
    manager.restoreRepoGate('repo-A', {
        chainId: 'chain-1',
        implementTaskId: 'implement-1',
        submissionStatus: 'submitted',
        prUrl: 'https://github.com/acme/repo/pull/123',
        prNumber: 123,
    });
    return manager;
}

function snapshot(status: ImplementPlanPrMergeSnapshot['status']): ImplementPlanPrMergeSnapshot {
    return { status, autoMerge: ARMED_AUTO_MERGE, checks: [] };
}

describe('ImplementPlanPrMergeWatcher', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('polls every 60 seconds and releases the matching gate after open, open, merged', async () => {
        vi.useFakeTimers();
        const manager = restoredSubmittedGate();
        const fetchStatus = vi.fn()
            .mockResolvedValueOnce(snapshot('open'))
            .mockResolvedValueOnce(snapshot('open'))
            .mockResolvedValueOnce(snapshot('merged'));
        const watcher = new ImplementPlanPrMergeWatcher(fetchStatus);

        watcher.sync('repo-A', manager);
        await vi.advanceTimersByTimeAsync(IMPLEMENT_PLAN_PR_MERGE_POLL_INTERVAL_MS * 3);

        expect(fetchStatus).toHaveBeenCalledTimes(3);
        expect(manager.getRepoGate('repo-A')).toBeUndefined();
        watcher.dispose();
    });

    it('keeps the gate and pauses the repo when the PR closes without merging', async () => {
        vi.useFakeTimers();
        const manager = restoredSubmittedGate();
        const watcher = new ImplementPlanPrMergeWatcher(
            vi.fn().mockResolvedValue(snapshot('closed')),
        );

        watcher.sync('repo-A', manager);
        await vi.advanceTimersByTimeAsync(IMPLEMENT_PLAN_PR_MERGE_POLL_INTERVAL_MS);

        expect(manager.getRepoGate('repo-A')?.chainId).toBe('chain-1');
        expect(manager.isRepoPaused('repo-A')).toBe(true);
        expect(manager.getPauseReason('repo-A')?.displayName).toContain('PR #123');
        expect(manager.getPauseReason('repo-A')?.displayName).toContain('closed without merging');
        watcher.dispose();
    });

    it('starts watching when a PR-submit result records submitted', async () => {
        vi.useFakeTimers();
        const fetchStatus = vi.fn().mockResolvedValue(snapshot('merged'));
        const registry = new RepoQueueRegistry();
        const router = new MultiRepoQueueRouter(registry, createMockProcessStore(), {
            autoStart: false,
            prMergeStatusFetcher: fetchStatus,
        });
        router.registerRepoId('repo-A', '/repo/demo');
        const manager = registry.getQueueForRepo('/repo/demo');
        manager.restoreRepoGate('repo-A', {
            chainId: 'chain-1',
            implementTaskId: 'implement-1',
            submissionStatus: 'pending',
        });

        manager.recordRepoGateSubmission('repo-A', 'chain-1', {
            submissionStatus: 'submitted',
            prUrl: 'https://github.com/acme/repo/pull/123',
            prNumber: 123,
        });
        await vi.advanceTimersByTimeAsync(IMPLEMENT_PLAN_PR_MERGE_POLL_INTERVAL_MS);

        expect(fetchStatus).toHaveBeenCalledOnce();
        expect(manager.getRepoGate('repo-A')).toBeUndefined();
        router.dispose();
    });

    it('reconstructs a persisted submitted watch after router restore', async () => {
        vi.useFakeTimers();
        const fetchStatus = vi.fn().mockResolvedValue(snapshot('merged'));
        const registry = new RepoQueueRegistry();
        const router = new MultiRepoQueueRouter(registry, createMockProcessStore(), {
            autoStart: false,
            prMergeStatusFetcher: fetchStatus,
        });
        router.registerRepoId('repo-A', '/repo/demo');
        const manager = registry.getQueueForRepo('/repo/demo');
        manager.restoreRepoGate('repo-A', {
            chainId: 'chain-1',
            implementTaskId: 'implement-1',
            submissionStatus: 'submitted',
            prUrl: 'https://github.com/acme/repo/pull/123',
            prNumber: 123,
        });

        router.restorePrMergeWatchers();
        await vi.advanceTimersByTimeAsync(IMPLEMENT_PLAN_PR_MERGE_POLL_INTERVAL_MS);

        expect(fetchStatus).toHaveBeenCalledOnce();
        expect(manager.getRepoGate('repo-A')).toBeUndefined();
        router.dispose();
    });

    it('keeps polling without a timeout while auto-merge remains armed', async () => {
        vi.useFakeTimers();
        const manager = restoredSubmittedGate();
        const fetchStatus = vi.fn().mockResolvedValue(snapshot('open'));
        const watcher = new ImplementPlanPrMergeWatcher(fetchStatus);

        watcher.sync('repo-A', manager);
        await vi.advanceTimersByTimeAsync(IMPLEMENT_PLAN_PR_MERGE_POLL_INTERVAL_MS * 10);

        expect(fetchStatus).toHaveBeenCalledTimes(10);
        expect(manager.getRepoGate('repo-A')?.chainId).toBe('chain-1');
        watcher.dispose();
    });
});
