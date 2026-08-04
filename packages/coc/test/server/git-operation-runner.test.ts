/**
 * GitOperationRunner Tests
 *
 * The runner owns the lifecycle shared by every background git operation:
 * job creation, the already-running guard, terminal status mapping, mutable
 * cache invalidation, and the gitChanged broadcast.
 *
 * Pure unit tests — no HTTP, no git, no filesystem. Cross-platform compatible.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { GitOpJob, GitOpType } from '@plusplusoneplusplus/forge';
import { GitOperationRunner } from '../../src/server/git/git-operation-runner';
import { APIError } from '../../src/server/errors';

// ============================================================================
// In-memory GitOpsStore double
// ============================================================================

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
        getById: vi.fn(async (workspaceId: string, jobId: string) =>
            jobs.find(j => j.workspaceId === workspaceId && j.id === jobId)),
        getLatest: vi.fn(),
        markStaleRunningJobs: vi.fn(),
    };
}

function createRunner(overrides: Record<string, unknown> = {}) {
    const store = createFakeStore();
    const broadcastGitChanged = vi.fn();
    const invalidateMutable = vi.fn();
    const runner = new GitOperationRunner({
        gitOpsStore: store as never,
        getWsServer: () => ({ broadcastGitChanged }),
        cache: { invalidateMutable },
        generateJobSuffix: () => 'testsuffix',
        ...overrides,
    });
    return { runner, store, broadcastGitChanged, invalidateMutable };
}

/** Let the runner's detached `.then()` chain settle. */
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

describe('GitOperationRunner', () => {
    let ctx: ReturnType<typeof createRunner>;

    beforeEach(() => {
        ctx = createRunner();
    });

    describe('createJobId', () => {
        it('prefixes the ID with the op name and includes the injected suffix', () => {
            const id = ctx.runner.createJobId('pull');
            expect(id.startsWith('pull-')).toBe(true);
            expect(id.endsWith('-testsuffix')).toBe(true);
        });

        it('produces distinct IDs without an injected suffix', () => {
            const { runner } = createRunner({ generateJobSuffix: undefined });
            const ids = new Set(Array.from({ length: 50 }, () => runner.createJobId('reword')));
            expect(ids.size).toBeGreaterThan(1);
        });
    });

    describe('start', () => {
        it('creates exactly one running job and returns its ID immediately', async () => {
            let resolveRun: (value: { success: boolean }) => void = () => {};
            const run = vi.fn(() => new Promise<{ success: boolean }>(r => { resolveRun = r; }));

            const { jobId } = await ctx.runner.start({ workspaceId: 'ws-1', op: 'pull', run });

            expect(ctx.store.create).toHaveBeenCalledTimes(1);
            expect(ctx.store.jobs).toHaveLength(1);
            expect(ctx.store.jobs[0]).toMatchObject({
                id: jobId,
                workspaceId: 'ws-1',
                op: 'pull',
                status: 'running',
                pid: process.pid,
            });
            expect(ctx.store.jobs[0].startedAt).toBeTruthy();
            // Still running — no terminal update or broadcast yet.
            expect(ctx.store.update).not.toHaveBeenCalled();
            expect(ctx.broadcastGitChanged).not.toHaveBeenCalled();

            resolveRun({ success: true });
            await flush();
        });

        it('marks the job successful and broadcasts using the op name', async () => {
            const { jobId } = await ctx.runner.start({
                workspaceId: 'ws-1',
                op: 'rebase-continue',
                run: async () => ({ success: true }),
            });
            await flush();

            const job = ctx.store.jobs.find(j => j.id === jobId)!;
            expect(job.status).toBe('success');
            expect(job.finishedAt).toBeTruthy();
            expect(job.error).toBeUndefined();
            expect(ctx.broadcastGitChanged).toHaveBeenCalledWith('ws-1', 'rebase-continue');
        });

        it('marks the job failed and carries the error through when the op reports failure', async () => {
            const { jobId } = await ctx.runner.start({
                workspaceId: 'ws-1',
                op: 'pull',
                run: async () => ({ success: false, error: 'merge conflict' }),
            });
            await flush();

            const job = ctx.store.jobs.find(j => j.id === jobId)!;
            expect(job.status).toBe('failed');
            expect(job.error).toBe('merge conflict');
            expect(ctx.broadcastGitChanged).toHaveBeenCalledWith('ws-1', 'pull');
        });

        it('marks the job failed when the op rejects, using the rejection message', async () => {
            const { jobId } = await ctx.runner.start({
                workspaceId: 'ws-1',
                op: 'drop-commit',
                run: async () => { throw new Error('git exploded'); },
            });
            await flush();

            expect(ctx.store.jobs.find(j => j.id === jobId)).toMatchObject({
                status: 'failed',
                error: 'git exploded',
            });
        });

        it('falls back to a generic message for non-Error rejections', async () => {
            const { jobId } = await ctx.runner.start({
                workspaceId: 'ws-1',
                op: 'drop-commit',
                run: async () => { throw 'nope'; },
            });
            await flush();

            expect(ctx.store.jobs.find(j => j.id === jobId)?.error).toBe('Unknown error');
        });

        it('uses an explicit broadcastReason over the op name', async () => {
            await ctx.runner.start({
                workspaceId: 'ws-1',
                op: 'pull',
                broadcastReason: 'custom-reason',
                run: async () => ({ success: true }),
            });
            await flush();
            expect(ctx.broadcastGitChanged).toHaveBeenCalledWith('ws-1', 'custom-reason');
        });

        it('only invalidates the mutable cache when asked to', async () => {
            await ctx.runner.start({ workspaceId: 'ws-1', op: 'pull', run: async () => ({ success: true }) });
            await flush();
            expect(ctx.invalidateMutable).not.toHaveBeenCalled();

            await ctx.runner.start({
                workspaceId: 'ws-1',
                op: 'merge-continue',
                invalidateCache: true,
                run: async () => ({ success: true }),
            });
            await flush();
            expect(ctx.invalidateMutable).toHaveBeenCalledWith('ws-1');
        });

        it('still invalidates and broadcasts when the operation fails', async () => {
            await ctx.runner.start({
                workspaceId: 'ws-1',
                op: 'reword',
                invalidateCache: true,
                run: async () => { throw new Error('boom'); },
            });
            await flush();
            expect(ctx.invalidateMutable).toHaveBeenCalledWith('ws-1');
            expect(ctx.broadcastGitChanged).toHaveBeenCalledWith('ws-1', 'reword');
        });

        it('rejects a duplicate operation with a 409 when rejectIfRunning is set', async () => {
            await ctx.runner.start({
                workspaceId: 'ws-1',
                op: 'pull',
                rejectIfRunning: 'A pull operation is already running',
                run: () => new Promise(() => {}),
            });

            await expect(ctx.runner.start({
                workspaceId: 'ws-1',
                op: 'pull',
                rejectIfRunning: 'A pull operation is already running',
                run: async () => ({ success: true }),
            })).rejects.toMatchObject({
                statusCode: 409,
                message: 'A pull operation is already running',
            });
            expect(ctx.store.create).toHaveBeenCalledTimes(1);
        });

        it('allows a concurrent operation of a different type', async () => {
            await ctx.runner.start({
                workspaceId: 'ws-1',
                op: 'pull',
                rejectIfRunning: 'A pull operation is already running',
                run: () => new Promise(() => {}),
            });
            await expect(ctx.runner.start({
                workspaceId: 'ws-1',
                op: 'reword',
                rejectIfRunning: 'A reword operation is already running',
                run: () => new Promise(() => {}),
            })).resolves.toHaveProperty('jobId');
        });

        it('allows the same operation to run concurrently in a different workspace', async () => {
            await ctx.runner.start({
                workspaceId: 'ws-1',
                op: 'pull',
                rejectIfRunning: 'A pull operation is already running',
                run: () => new Promise(() => {}),
            });
            await ctx.runner.start({
                workspaceId: 'ws-2',
                op: 'pull',
                rejectIfRunning: 'A pull operation is already running',
                run: async () => ({ success: true }),
            });
            await flush();

            expect(ctx.store.jobs.map(j => j.workspaceId)).toEqual(['ws-1', 'ws-2']);
            expect(ctx.store.jobs[0].status).toBe('running');
            expect(ctx.store.jobs[1].status).toBe('success');
            expect(ctx.broadcastGitChanged).toHaveBeenCalledWith('ws-2', 'pull');
            expect(ctx.broadcastGitChanged).not.toHaveBeenCalledWith('ws-1', 'pull');
        });

        it('does not reject duplicates when rejectIfRunning is omitted', async () => {
            await ctx.runner.start({ workspaceId: 'ws-1', op: 'rebase-continue', run: () => new Promise(() => {}) });
            await expect(ctx.runner.start({
                workspaceId: 'ws-1',
                op: 'rebase-continue',
                run: () => new Promise(() => {}),
            })).resolves.toHaveProperty('jobId');
            expect(ctx.store.getRunning).not.toHaveBeenCalled();
        });
    });

    describe('settle', () => {
        it('broadcasts even when the store update throws', async () => {
            ctx.store.update.mockRejectedValueOnce(new Error('disk full'));
            await expect(ctx.runner.settle('ws-1', 'job-1', {
                status: 'success',
                invalidateCache: true,
                broadcastReason: 'rebase-reorder',
            })).rejects.toThrow('disk full');
            expect(ctx.invalidateMutable).toHaveBeenCalledWith('ws-1');
            expect(ctx.broadcastGitChanged).toHaveBeenCalledWith('ws-1', 'rebase-reorder');
        });
    });

    describe('recordCompleted', () => {
        it('persists an already-terminal job with metadata', async () => {
            const startedAt = new Date(0).toISOString();
            const job = await ctx.runner.recordCompleted({
                workspaceId: 'ws-1',
                op: 'cherry-pick-transfer',
                startedAt,
                metadata: { kind: 'patch-transfer', targetWorkspace: { id: 'ws-1' }, targetBranch: 'main', stashed: false },
            });

            expect(job.status).toBe('success');
            expect(job.startedAt).toBe(startedAt);
            expect(job.finishedAt).toBeTruthy();
            expect(job.metadata).toMatchObject({ kind: 'patch-transfer' });
            expect(ctx.store.jobs).toHaveLength(1);
        });
    });

    describe('ensureNotRunning', () => {
        it('throws an APIError with a 409 status', async () => {
            await ctx.runner.start({ workspaceId: 'ws-1', op: 'pull', run: () => new Promise(() => {}) });
            await expect(ctx.runner.ensureNotRunning('ws-1', 'pull', 'busy')).rejects.toBeInstanceOf(APIError);
        });

        it('resolves when nothing of that type is running', async () => {
            await expect(ctx.runner.ensureNotRunning('ws-1', 'pull', 'busy')).resolves.toBeUndefined();
        });
    });

    it('tolerates a missing websocket server', async () => {
        const { runner, store } = createRunner({ getWsServer: () => undefined });
        const { jobId } = await runner.start({ workspaceId: 'ws-1', op: 'pull', run: async () => ({ success: true }) });
        await flush();
        expect(store.jobs.find(j => j.id === jobId)?.status).toBe('success');
    });
});
