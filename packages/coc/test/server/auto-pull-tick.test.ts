/**
 * Server-side auto-pull tick tests (AC-02 + the persistence half of AC-03).
 *
 * Ported from the deleted client suite `test/spa/react/features/git/autoPullTick.test.ts`:
 * one case per outcome (in-flight skip, dirty skip, pre-check error, job started,
 * job failed), plus the rules the client version couldn't express — that the pull
 * goes through `GitOperationRunner.start({ op: 'pull' })` rather than the branch
 * service, and that each terminal outcome lands in the run-state file.
 *
 * A real `GitOperationRunner` over an in-memory git-ops store, so the 409
 * single-flight guard under test is the production one. Real filesystem under a
 * temp dir; no git, no timers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { GitChange } from '@plusplusoneplusplus/forge';
import { GitOperationRunner, type GitOperationOutcome } from '../../src/server/git/git-operation-runner';
import { AUTO_PULL_MESSAGES, hasBlockingChanges, runAutoPullTick } from '../../src/server/git/auto-pull-tick';
import { readAutoPullState } from '../../src/server/git/auto-pull-state';

const WS = 'ws-auto-pull';
const REPO_ROOT = '/repo/root';
const NOW = Date.parse('2026-08-29T12:00:00.000Z');

type Job = { id: string; workspaceId: string; op: string; status: string; [k: string]: unknown };

/** Minimal in-memory `GitOpsStore`: enough for create/update/getRunning. */
function createGitOpsStore() {
    const jobs: Job[] = [];
    return {
        jobs,
        create: vi.fn(async (job: Job) => { jobs.push({ ...job }); }),
        update: vi.fn(async (workspaceId: string, jobId: string, patch: Record<string, unknown>) => {
            const job = jobs.find(j => j.workspaceId === workspaceId && j.id === jobId);
            if (job) Object.assign(job, patch);
        }),
        getRunning: vi.fn(async (workspaceId: string, op: string) =>
            jobs.filter(j => j.workspaceId === workspaceId && j.op === op && j.status === 'running')),
    };
}

function change(stage: GitChange['stage'], filePath: string): GitChange {
    return {
        filePath,
        status: stage === 'untracked' ? 'untracked' : 'modified',
        stage,
        repositoryRoot: REPO_ROOT,
        repositoryName: 'root',
    } as GitChange;
}

let dataDir: string;
let store: ReturnType<typeof createGitOpsStore>;
let runner: GitOperationRunner;

beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-pull-tick-'));
    store = createGitOpsStore();
    runner = new GitOperationRunner({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        gitOpsStore: store as any,
        cache: { invalidateMutable: vi.fn() },
    });
});

afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
});

interface Overrides {
    isPullRunning?: () => Promise<boolean>;
    getChanges?: (repoRoot: string) => Promise<readonly GitChange[]>;
    pull?: (repoRoot: string) => Promise<GitOperationOutcome>;
}

function deps(overrides: Overrides = {}) {
    return {
        dataDir,
        workspaceId: WS,
        repoRoot: REPO_ROOT,
        runner,
        now: () => NOW,
        isPullRunning: overrides.isPullRunning ?? (async () => false),
        getChanges: overrides.getChanges ?? (async () => []),
        pull: overrides.pull ?? (async (): Promise<GitOperationOutcome> => ({ success: true })),
    };
}

/** Let the runner's background `.then` chain settle the job. */
async function flush(): Promise<void> {
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
}

describe('hasBlockingChanges', () => {
    it('blocks on staged and on unstaged changes', () => {
        expect(hasBlockingChanges([change('staged', 'a.ts')])).toBe(true);
        expect(hasBlockingChanges([change('unstaged', 'a.ts')])).toBe(true);
    });

    it('does not block on untracked files alone, or on an empty tree', () => {
        expect(hasBlockingChanges([change('untracked', 'scratch.txt')])).toBe(false);
        expect(hasBlockingChanges([])).toBe(false);
    });
});

describe('runAutoPullTick outcomes', () => {
    it('skips when a pull job is already running, without touching the tree', async () => {
        const getChanges = vi.fn(async () => []);
        const pull = vi.fn(async () => ({ success: true }));

        const result = await runAutoPullTick(deps({ isPullRunning: async () => true, getChanges, pull }));

        expect(result.outcome).toBe('skipped-in-flight');
        expect(getChanges).not.toHaveBeenCalled();
        expect(pull).not.toHaveBeenCalled();
        expect(readAutoPullState(dataDir, WS)?.outcome).toBe('skipped-in-flight');
    });

    it('skips a dirty tree and records the reason', async () => {
        const pull = vi.fn(async () => ({ success: true }));

        const result = await runAutoPullTick(deps({
            getChanges: async () => [change('unstaged', 'src/a.ts')],
            pull,
        }));

        expect(result.outcome).toBe('skipped-dirty');
        expect(result.message).toBe(AUTO_PULL_MESSAGES.dirty);
        expect(pull).not.toHaveBeenCalled();
        expect(readAutoPullState(dataDir, WS)).toEqual({
            lastRunAt: new Date(NOW).toISOString(),
            outcome: 'skipped-dirty',
            message: AUTO_PULL_MESSAGES.dirty,
        });
    });

    it('skips a staged-only tree', async () => {
        const result = await runAutoPullTick(deps({ getChanges: async () => [change('staged', 'src/a.ts')] }));
        expect(result.outcome).toBe('skipped-dirty');
    });

    it('pulls an untracked-only tree', async () => {
        const pull = vi.fn(async () => ({ success: true }));

        const result = await runAutoPullTick(deps({
            getChanges: async () => [change('untracked', 'notes.txt')],
            pull,
        }));

        expect(result.outcome).toBe('started-job');
        expect(pull).toHaveBeenCalledWith(REPO_ROOT);
    });

    it('skips when the working-tree pre-check throws', async () => {
        const pull = vi.fn(async () => ({ success: true }));

        const result = await runAutoPullTick(deps({
            getChanges: async () => { throw new Error('git status exploded'); },
            pull,
        }));

        expect(result.outcome).toBe('skipped-precheck-error');
        expect(result.message).toBe(AUTO_PULL_MESSAGES.precheckError);
        expect(pull).not.toHaveBeenCalled();
        expect(readAutoPullState(dataDir, WS)?.outcome).toBe('skipped-precheck-error');
    });

    it('starts a pull job through the runner and records success when it settles', async () => {
        const start = vi.spyOn(runner, 'start');

        const result = await runAutoPullTick(deps());

        expect(result.outcome).toBe('started-job');
        expect(result.jobId).toMatch(/^pull-/);
        expect(start).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: WS, op: 'pull' }));

        await flush();
        expect(readAutoPullState(dataDir, WS)).toEqual({
            lastRunAt: new Date(NOW).toISOString(),
            outcome: 'success',
        });
        expect(store.jobs).toEqual([expect.objectContaining({ op: 'pull', status: 'success' })]);
    });

    it('records a failed outcome with the pull error when the job fails', async () => {
        await runAutoPullTick(deps({ pull: async () => ({ success: false, error: 'refusing to merge unrelated histories' }) }));
        await flush();

        expect(readAutoPullState(dataDir, WS)).toEqual({
            lastRunAt: new Date(NOW).toISOString(),
            outcome: 'failed',
            message: 'refusing to merge unrelated histories',
        });
        expect(store.jobs).toEqual([expect.objectContaining({ op: 'pull', status: 'failed' })]);
    });

    it('does not reject when the pull throws, and still records the failure', async () => {
        const result = await runAutoPullTick(deps({ pull: async () => { throw new Error('network down'); } }));
        await flush();

        // `start` already returned a job id; the rejection is absorbed by the runner.
        expect(result.outcome).toBe('started-job');
        expect(readAutoPullState(dataDir, WS)).toEqual({
            lastRunAt: new Date(NOW).toISOString(),
            outcome: 'failed',
            message: 'network down',
        });
        expect(store.jobs).toEqual([expect.objectContaining({ status: 'failed' })]);
    });

    it('does not reject when the runner itself throws', async () => {
        vi.spyOn(runner, 'start').mockRejectedValue(new Error('git-ops store unavailable'));

        const result = await runAutoPullTick(deps());

        expect(result.outcome).toBe('failed');
        expect(result.message).toBe('git-ops store unavailable');
        expect(readAutoPullState(dataDir, WS)?.outcome).toBe('failed');
    });

    it("treats the runner's 409 as an in-flight skip", async () => {
        // A pull job appears between the pre-check and `start` — exactly what the
        // runner's `rejectIfRunning` guard exists to catch.
        store.jobs.push({ id: 'pull-1', workspaceId: WS, op: 'pull', status: 'running' });

        const result = await runAutoPullTick(deps({ isPullRunning: async () => false }));

        expect(result.outcome).toBe('skipped-in-flight');
        expect(readAutoPullState(dataDir, WS)?.outcome).toBe('skipped-in-flight');
    });

    it('falls through to the runner guard when the in-flight probe throws', async () => {
        const result = await runAutoPullTick(deps({
            isPullRunning: async () => { throw new Error('store unreadable'); },
        }));

        expect(result.outcome).toBe('started-job');
    });
});
