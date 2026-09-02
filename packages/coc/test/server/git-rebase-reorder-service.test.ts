/**
 * GitRebaseReorderService Tests
 *
 * Reorder is queue-backed, so the job in `GitOpsStore` is only as accurate as
 * the listener that settles it. These tests cover every way the queue task can
 * end — completed, failed, cancelled, removed, already-terminal before the
 * listener attached, enqueue failure, and no terminal event at all — plus
 * listener cleanup in each case.
 *
 * No HTTP, no git, no filesystem.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { GitOpJob, GitOpType } from '@plusplusoneplusplus/forge';
import { GitOperationRunner } from '../../src/server/git/git-operation-runner';
import {
    GitRebaseReorderService,
    buildRebaseReorderPrompt,
} from '../../src/server/git/git-rebase-reorder-service';

const WS = { id: 'ws-1', rootPath: '/repos/demo' };

function createFakeStore() {
    const jobs: GitOpJob[] = [];
    return {
        jobs,
        create: vi.fn(async (job: GitOpJob) => { jobs.push({ ...job }); return job; }),
        update: vi.fn(async (workspaceId: string, jobId: string, patch: Partial<GitOpJob>) => {
            const job = jobs.find(j => j.workspaceId === workspaceId && j.id === jobId);
            if (job) Object.assign(job, patch);
            return job;
        }),
        getRunning: vi.fn(async (workspaceId: string, op?: GitOpType) =>
            jobs.filter(j => j.workspaceId === workspaceId && j.status === 'running' && (!op || j.op === op))),
        getById: vi.fn(), getLatest: vi.fn(), markStaleRunningJobs: vi.fn(),
    };
}

function createHarness(options: {
    enqueue?: () => Promise<string>;
    getTask?: (taskId: string) => { id: string; status: string } | undefined;
    timeoutMs?: number;
} = {}) {
    const store = createFakeStore();
    const broadcastGitChanged = vi.fn();
    const invalidateMutable = vi.fn();
    const listeners: Array<(event: Record<string, unknown>) => void> = [];

    const bridge = {
        enqueue: vi.fn(options.enqueue ?? (async () => 'task-1')),
        getTask: options.getTask ? vi.fn(options.getTask) : undefined,
        on: vi.fn((_event: string, listener: (e: Record<string, unknown>) => void) => { listeners.push(listener); }),
        off: vi.fn((_event: string, listener: (e: Record<string, unknown>) => void) => {
            const index = listeners.indexOf(listener);
            if (index >= 0) listeners.splice(index, 1);
        }),
    };

    const runner = new GitOperationRunner({
        gitOpsStore: store as never,
        getWsServer: () => ({ broadcastGitChanged }),
        cache: { invalidateMutable },
    });
    const service = new GitRebaseReorderService({ runner, bridge, timeoutMs: options.timeoutMs });

    const emit = (event: Record<string, unknown>) => { [...listeners].forEach(listener => listener(event)); };
    return { service, store, bridge, listeners, emit, broadcastGitChanged, invalidateMutable };
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

describe('GitRebaseReorderService.start', () => {
    let h: ReturnType<typeof createHarness>;

    beforeEach(() => {
        h = createHarness();
    });

    it('creates a running job, enqueues an autopilot chat task, and returns both IDs', async () => {
        const result = await h.service.start(WS, ['aaaa', 'bbbb']);

        expect(result).toEqual({ taskId: 'task-1', jobId: expect.stringMatching(/^rebase-reorder-/) });
        expect(h.store.jobs).toHaveLength(1);
        expect(h.store.jobs[0]).toMatchObject({ workspaceId: 'ws-1', op: 'rebase-reorder', status: 'running' });

        const input = h.bridge.enqueue.mock.calls[0][0];
        expect(input).toMatchObject({
            type: 'chat',
            priority: 'normal',
            displayName: 'Reorder 2 commits',
            config: { retryOnFailure: false },
        });
        expect(input.payload).toMatchObject({
            kind: 'chat',
            mode: 'autopilot',
            workingDirectory: '/repos/demo',
            workspaceId: 'ws-1',
        });
        expect(input.payload.prompt).toContain('aaaa');
    });

    it('singularizes the display name for a one-commit reorder', async () => {
        await h.service.start(WS, ['aaaa']);
        expect(h.bridge.enqueue.mock.calls[0][0].displayName).toBe('Reorder 1 commit');
    });

    it('rejects an empty or non-array commit list before touching the queue', async () => {
        await expect(h.service.start(WS, [])).rejects.toMatchObject({ statusCode: 400 });
        await expect(h.service.start(WS, undefined)).rejects.toMatchObject({ statusCode: 400 });
        expect(h.bridge.enqueue).not.toHaveBeenCalled();
        expect(h.store.create).not.toHaveBeenCalled();
    });

    it('rejects with 409 when the queue bridge cannot enqueue', async () => {
        const runner = new GitOperationRunner({ gitOpsStore: createFakeStore() as never });
        const service = new GitRebaseReorderService({ runner, bridge: undefined });
        await expect(service.start(WS, ['aaaa'])).rejects.toMatchObject({
            statusCode: 409,
            message: 'Queue bridge is not available for rebase-reorder',
        });
    });

    it('rejects with 409 when a reorder is already running for the workspace', async () => {
        await h.service.start(WS, ['aaaa']);
        await expect(h.service.start(WS, ['bbbb'])).rejects.toMatchObject({
            statusCode: 409,
            message: 'A rebase-reorder operation is already running',
        });
        expect(h.bridge.enqueue).toHaveBeenCalledTimes(1);
    });

    it('allows a concurrent reorder in a different workspace', async () => {
        await h.service.start(WS, ['aaaa']);
        await expect(h.service.start({ id: 'ws-2', rootPath: '/repos/other' }, ['bbbb'])).resolves.toBeTruthy();
        expect(h.store.jobs.map(j => j.workspaceId)).toEqual(['ws-1', 'ws-2']);
    });

    it('fails the job instead of stranding it when enqueue throws', async () => {
        const harness = createHarness({ enqueue: async () => { throw new Error('queue is down'); } });
        await expect(harness.service.start(WS, ['aaaa'])).rejects.toThrow('queue is down');
        expect(harness.store.jobs[0]).toMatchObject({ status: 'failed', error: 'queue is down' });
        expect(harness.broadcastGitChanged).toHaveBeenCalledWith('ws-1', 'rebase-reorder');
        expect(harness.listeners).toHaveLength(0);
    });
});

describe('GitRebaseReorderService queue lifecycle', () => {
    let h: ReturnType<typeof createHarness>;

    beforeEach(() => {
        h = createHarness();
    });

    it('marks the job successful, invalidates the cache, and broadcasts when the task completes', async () => {
        const { jobId } = await h.service.start(WS, ['aaaa']);
        h.emit({ type: 'updated', taskId: 'task-1', task: { id: 'task-1', status: 'completed' } });
        await flush();

        expect(h.store.jobs.find(j => j.id === jobId)).toMatchObject({ status: 'success' });
        expect(h.invalidateMutable).toHaveBeenCalledWith('ws-1');
        expect(h.broadcastGitChanged).toHaveBeenCalledWith('ws-1', 'rebase-reorder');
        expect(h.listeners).toHaveLength(0);
    });

    it('marks the job failed when the task fails', async () => {
        const { jobId } = await h.service.start(WS, ['aaaa']);
        h.emit({ type: 'updated', taskId: 'task-1', task: { id: 'task-1', status: 'failed' } });
        await flush();

        expect(h.store.jobs.find(j => j.id === jobId)).toMatchObject({ status: 'failed' });
        expect(h.listeners).toHaveLength(0);
    });

    it('marks the job interrupted when the task is cancelled', async () => {
        const { jobId } = await h.service.start(WS, ['aaaa']);
        h.emit({ type: 'updated', taskId: 'task-1', task: { id: 'task-1', status: 'cancelled' } });
        await flush();

        expect(h.store.jobs.find(j => j.id === jobId)).toMatchObject({
            status: 'interrupted',
            error: 'Rebase-reorder task was cancelled',
        });
        expect(h.listeners).toHaveLength(0);
    });

    it('marks the job interrupted when the task is removed from the queue', async () => {
        const { jobId } = await h.service.start(WS, ['aaaa']);
        h.emit({ type: 'removed', taskId: 'task-1' });
        await flush();

        expect(h.store.jobs.find(j => j.id === jobId)).toMatchObject({
            status: 'interrupted',
            error: 'Rebase-reorder task was removed from the queue',
        });
        expect(h.listeners).toHaveLength(0);
    });

    it('ignores events for other tasks and non-terminal updates', async () => {
        const { jobId } = await h.service.start(WS, ['aaaa']);
        h.emit({ type: 'updated', taskId: 'other-task', task: { id: 'other-task', status: 'completed' } });
        h.emit({ type: 'updated', taskId: 'task-1', task: { id: 'task-1', status: 'in-progress' } });
        h.emit({ type: 'reordered', taskId: 'task-1' });
        h.emit({ type: 'updated', taskId: 'task-1' });
        await flush();

        expect(h.store.jobs.find(j => j.id === jobId)?.status).toBe('running');
        expect(h.listeners).toHaveLength(1);
    });

    it('resolves the task ID from the event task when taskId is absent', async () => {
        const { jobId } = await h.service.start(WS, ['aaaa']);
        h.emit({ type: 'updated', task: { id: 'task-1', status: 'completed' } });
        await flush();
        expect(h.store.jobs.find(j => j.id === jobId)?.status).toBe('success');
    });

    it('settles the job only once even if the queue repeats terminal events', async () => {
        await h.service.start(WS, ['aaaa']);
        h.emit({ type: 'updated', taskId: 'task-1', task: { id: 'task-1', status: 'completed' } });
        h.emit({ type: 'updated', taskId: 'task-1', task: { id: 'task-1', status: 'failed' } });
        await flush();

        expect(h.store.update).toHaveBeenCalledTimes(1);
        expect(h.store.jobs[0].status).toBe('success');
    });

    it('settles from the current task state when the task ended before the listener attached', async () => {
        const harness = createHarness({ getTask: () => ({ id: 'task-1', status: 'completed' }) });
        const { jobId } = await harness.service.start(WS, ['aaaa']);
        await flush();

        expect(harness.store.jobs.find(j => j.id === jobId)?.status).toBe('success');
        expect(harness.listeners).toHaveLength(0);
    });

    it('keeps watching when the task is still running at subscription time', async () => {
        const harness = createHarness({ getTask: () => ({ id: 'task-1', status: 'in-progress' }) });
        const { jobId } = await harness.service.start(WS, ['aaaa']);
        await flush();
        expect(harness.store.jobs.find(j => j.id === jobId)?.status).toBe('running');
        expect(harness.listeners).toHaveLength(1);
    });

    it('fails the job when no terminal event arrives within the timeout', async () => {
        vi.useFakeTimers();
        try {
            const harness = createHarness({ timeoutMs: 1000 });
            const { jobId } = await harness.service.start(WS, ['aaaa']);
            expect(harness.store.jobs.find(j => j.id === jobId)?.status).toBe('running');

            vi.advanceTimersByTime(1000);
            await vi.runAllTicks();
            await Promise.resolve();

            expect(harness.store.jobs.find(j => j.id === jobId)).toMatchObject({
                status: 'failed',
                error: 'Rebase-reorder task did not report a result in time',
            });
            expect(harness.listeners).toHaveLength(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('cancels the timeout once the task reports a result', async () => {
        vi.useFakeTimers();
        try {
            const harness = createHarness({ timeoutMs: 1000 });
            const { jobId } = await harness.service.start(WS, ['aaaa']);
            harness.emit({ type: 'updated', taskId: 'task-1', task: { id: 'task-1', status: 'completed' } });
            await Promise.resolve();

            vi.advanceTimersByTime(5000);
            await Promise.resolve();

            expect(harness.store.jobs.find(j => j.id === jobId)?.status).toBe('success');
            expect(harness.store.update).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not leave an unhandled rejection when the store update fails', async () => {
        h.store.update.mockRejectedValueOnce(new Error('disk full'));
        await h.service.start(WS, ['aaaa']);
        h.emit({ type: 'updated', taskId: 'task-1', task: { id: 'task-1', status: 'completed' } });
        await flush();
        // The side effects still ran even though persistence failed.
        expect(h.broadcastGitChanged).toHaveBeenCalledWith('ws-1', 'rebase-reorder');
    });
});

describe('buildRebaseReorderPrompt', () => {
    it('includes the repo root, the ordered commit list, and pick lines', () => {
        const prompt = buildRebaseReorderPrompt('/repos/demo', ['aaaa', 'bbbb', 'cccc']);
        expect(prompt).toContain('/repos/demo');
        expect(prompt).toContain('  1. aaaa');
        expect(prompt).toContain('  3. cccc');
        expect(prompt).toContain('pick aaaa\npick bbbb\npick cccc');
        expect(prompt).toContain('all 3 commits reordered');
    });

    it('bases the rebase on the parent of the first commit', () => {
        expect(buildRebaseReorderPrompt('/repos/demo', ['aaaa', 'bbbb'])).toContain('git rev-parse aaaa~1');
    });

    it('emits platform-appropriate sequence-editor instructions', () => {
        const prompt = buildRebaseReorderPrompt('/repos/demo', ['aaaa']);
        if (process.platform === 'win32') {
            expect(prompt).toContain('seq-editor.cmd');
            expect(prompt).not.toContain('chmod +x');
        } else {
            expect(prompt).toContain('seq-editor.sh');
            expect(prompt).toContain('chmod +x');
        }
    });

    it('forbids pushing', () => {
        expect(buildRebaseReorderPrompt('/repos/demo', ['aaaa'])).toContain('Do NOT push any changes');
    });
});
