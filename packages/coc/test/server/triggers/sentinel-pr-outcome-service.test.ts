import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import type { DelegatedJob } from '../../../src/server/delegation/delegated-job-store';
import { SentinelTodoError, SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { TriggerStore } from '../../../src/server/triggers/trigger-store';
import { SentinelPrOutcomeControls } from '../../../src/server/triggers/sentinel-pr-outcome-controls';
import { SentinelPrOutcomeService } from '../../../src/server/triggers/sentinel-pr-outcome-service';
import { parsePullRequestUrl } from '../../../src/server/triggers/pr-status-fetcher';
import { RalphGrillingStore } from '../../../src/server/ralph/grilling-state';

const parent = { workspaceId: 'owner-ws', processId: 'sentinel-parent' };
const child = { workspaceId: 'child-ws', processId: 'child-job' };
const url = 'https://github.com/example/repo/pull/7';

describe('Sentinel PR outcome tracking', () => {
    let db: NativeDatabase;
    let todos: SentinelTodoStore;
    let triggers: TriggerStore;
    let service: SentinelPrOutcomeService;
    let job: DelegatedJob;
    let itemId: string;
    let enabled: boolean;
    const arm = vi.fn();
    const listOwner = vi.fn();
    const recordPullRequest = vi.fn();
    const deliverPending = vi.fn();
    const checkOutcome = vi.fn();
    const recoverPendingMessages = vi.fn();
    let controls: SentinelPrOutcomeControls;

    beforeEach(() => {
        vi.clearAllMocks();
        db = new NativeDatabase(':memory:');
        todos = new SentinelTodoStore(db);
        triggers = new TriggerStore(db);
        enabled = true;
        itemId = todos.create(parent, { title: 'Release', completionCondition: 'Published and verified' }, { actor: 'user' }).item.id;
        listOwner.mockImplementation(async () => todos.get(parent));
        job = { id: child.processId, parent, child: { ...child }, title: 'Implementation', createdAt: new Date().toISOString() };
        recordPullRequest.mockImplementation((_workspace, _job, itemId, prUrl, requestOutcomeWatch = false) => {
            const pr = parsePullRequestUrl(prUrl)!;
            const existing = job.pullRequests?.find(receipt => receipt.pr.url === pr.url);
            if (existing) {
                if (requestOutcomeWatch) existing.outcomeWatchRequestedAt ??= new Date().toISOString();
                return existing;
            }
            const receipt = { id: `receipt-${pr.number}`, itemId, pr, recordedAt: new Date().toISOString(),
                ...(requestOutcomeWatch ? { outcomeWatchRequestedAt: new Date().toISOString() } : {}) };
            (job.pullRequests ??= []).push(receipt);
            return receipt;
        });
        controls = new SentinelPrOutcomeControls(db);
        service = new SentinelPrOutcomeService({
            jobs: { list: workspaceId => workspaceId === parent.workspaceId ? [job] : [], recordPullRequest,
                recordPullRequestOutcomeWatchError: (_workspace: string, _job: string, receiptId: string, error?: {message: string; permanent: boolean}) => {
                    const receipt = job.pullRequests!.find(receipt => receipt.id === receiptId)!;
                    if (error) receipt.outcomeWatchError = error;
                    else delete receipt.outcomeWatchError;
                },
                requestPullRequestOutcomeWatch: (_workspace: string, _job: string, receiptId: string) => {
                    job.pullRequests!.find(receipt => receipt.id === receiptId)!.outcomeWatchRequestedAt ??= new Date().toISOString();
                } } as never,
            processes: { getWorkspaces: async () => [{ id: child.workspaceId }, { id: parent.workspaceId }] as never,
                getProcess: async () => undefined },
            owners: { list: listOwner, findLinkedItem: () => todos.get(parent).items.find(item => item.id === itemId) },
            triggers, controls,
            manager: { arm, disarm: vi.fn(), schedulePendingDelivery: vi.fn(), checkOutcome },
            firer: { fire: vi.fn(), deliverPending }, enabled: () => enabled,
            recoverPendingMessages,
        });
    });
    afterEach(() => db.close());

    it('does not overwrite a newer receipt revision during asynchronous execution validation', async () => {
        const registration = await service.registerSubmission(child.workspaceId, child.processId, url);
        const trigger = triggers.getById(registration.triggerId!)!;
        trigger.status = 'disarmed';
        trigger.outcome = 'fired';
        trigger.delivery = { deliveryId: 'review-1', reason: 'merged', state: 'delivered', firedAt: new Date().toISOString() };
        triggers.update(trigger);
        listOwner.mockImplementationOnce(async () => {
            const latest = triggers.getById(trigger.id)!;
            triggers.update({ ...latest, revision: latest.revision + 1, outcomeReason: 'Concurrent update' });
            const ledger = todos.get(parent);
            return { ...ledger, items: ledger.items.map(item => ({ ...item, status: 'done' as const })) };
        });
        expect(await service.reviewExecutionDisposition(parent, trigger.id, 'review-1')).toBe('defer');
        expect(triggers.getById(trigger.id)).toMatchObject({
            outcomeReason: 'Concurrent update', delivery: { state: 'delivered' },
        });
    });

    it('registers every exact cross-workspace submission at the original parent and deduplicates retries', async () => {
        const first = await service.registerSubmission(child.workspaceId, child.processId, url);
        expect(await service.registerSubmission(child.workspaceId, child.processId, url)).toEqual(first);
        await service.registerSubmission(child.workspaceId, child.processId, url.replace('/7', '/8'));
        expect(triggers.getAll()).toHaveLength(2);
        expect(arm).toHaveBeenCalledTimes(2);
        expect(triggers.getAll()).toEqual(expect.arrayContaining([
            expect.objectContaining({ ...parent, binding: expect.objectContaining({
                itemId, delegatedPr: { jobId: child.processId, receiptId: 'receipt-7' },
            }) }),
        ]));
        expect(service.validate(triggers.getAll()[0])).toBe(true);
    });

    it('does not register untracked jobs or when disabled', async () => {
        expect(await service.registerSubmission(child.workspaceId, 'untracked', url)).toEqual({ registered: false });
        enabled = false;
        expect(await service.registerSubmission(child.workspaceId, child.processId, url)).toEqual({ registered: false });
        expect(recordPullRequest).not.toHaveBeenCalled();
    });

    it('deduplicates concurrent registration after asynchronous owner validation', async () => {
        const results = await Promise.all([
            service.registerSubmission(child.workspaceId, child.processId, url),
            service.registerSubmission(child.workspaceId, child.processId, url),
        ]);
        expect(results[0]).toEqual(results[1]);
        expect(triggers.getAll()).toHaveLength(1);
        expect(arm).toHaveBeenCalledTimes(1);
        expect(job.pullRequests).toHaveLength(1);
        expect(job.pullRequests![0].outcomeWatchError).toBeUndefined();
    });

    it('reconciles durable registration intent after a crash but never backfills older receipts', async () => {
        const receipt = recordPullRequest(parent.workspaceId, job.id, itemId, url);
        await service.restore();
        expect(triggers.getAll()).toHaveLength(0);
        receipt.outcomeWatchRequestedAt = new Date().toISOString();
        await service.restore();
        await service.restore();
        expect(triggers.getAll()).toHaveLength(1);
        expect(arm).toHaveBeenCalledTimes(1);
    });

    it('rejects remote transport without local misrouting', async () => {
        job.child.serverId = 'remote';
        await expect(service.registerSubmission(child.workspaceId, child.processId, url)).rejects.toThrow('transport is unavailable');
        expect(triggers.getAll()).toEqual([]);
    });

    it('retains evidence without reviewing done or archived items', async () => {
        todos.update(parent, itemId, 1, { status: 'done' }, 'user');
        await service.registerSubmission(child.workspaceId, child.processId, url);
        expect(recordPullRequest).toHaveBeenCalled();
        expect(triggers.getAll()[0]).toMatchObject({ status: 'disarmed', outcome: 'skipped' });
        expect(arm).not.toHaveBeenCalled();
    });

    it('rejects missing parent and missing or manual exact item', async () => {
        listOwner.mockRejectedValueOnce(new Error('Owner missing'));
        await expect(service.registerSubmission(child.workspaceId, child.processId, url)).rejects.toThrow('Owner missing');
        itemId = 'missing';
        await expect(service.registerSubmission(child.workspaceId, child.processId, url)).rejects.toThrow('exact tracked');
        expect(recordPullRequest).not.toHaveBeenCalled();
    });

    it('durably pauses an item before submission and new exact submissions inherit that preference', async () => {
        expect(await service.control(parent, itemId, 'pause', { expectedRevision: 0 })).toEqual({
            paused: true, revision: 1, outcomes: [],
        });
        await service.registerSubmission(child.workspaceId, child.processId, url);
        expect(service.canDeliver(triggers.getAll()[0])).toBe(false);
        expect(new SentinelPrOutcomeControls(db).get(parent, itemId)).toEqual({ paused: true, revision: 1 });
        expect(await service.list(parent, itemId)).toMatchObject({
            paused: true, outcomes: [{ status: 'watching', delivery: 'none', jobId: child.processId, receiptId: 'receipt-7' }],
        });
        await expect(service.control(parent, itemId, 'resume', { expectedRevision: 0 })).rejects.toMatchObject({ statusCode: 409 });
    });

    it('check never bypasses pause and resume admits retained evidence once', async () => {
        await service.registerSubmission(child.workspaceId, child.processId, url);
        const trigger = triggers.getAll()[0];
        trigger.status = 'disarmed';
        trigger.delivery = { deliveryId: 'delivery', reason: 'closed', state: 'pending', firedAt: new Date().toISOString() };
        if (trigger.event.monitor === 'pr-merged') trigger.event.terminalObservation = { status: 'closed', observedAt: new Date().toISOString() };
        triggers.update(trigger);
        await service.control(parent, itemId, 'pause', { expectedRevision: 0 });
        expect(await service.control(parent, itemId, 'check', { expectedRevision: 1 })).toMatchObject({
            paused: true, revision: 1, outcomes: [{ status: 'closed', delivery: 'pending' }],
        });
        expect(checkOutcome).toHaveBeenCalledWith(trigger.id);
        expect(deliverPending).not.toHaveBeenCalled();
        deliverPending.mockImplementation(async () => {
            const current = triggers.getById(trigger.id)!;
            current.delivery!.state = 'delivered';
            triggers.update(current);
        });
        await service.control(parent, itemId, 'resume', { expectedRevision: 1 });
        await service.control(parent, itemId, 'resume', { expectedRevision: 2 });
        expect(deliverPending).toHaveBeenCalledTimes(1);
    });

    it('rejects foreign, manual and unknown authoring fields without exposing other owners', async () => {
        await expect(service.list(parent, 'missing')).rejects.toMatchObject({ statusCode: 404 });
        await expect(service.control(parent, itemId, 'pause', { expectedRevision: 0, paused: true })).rejects.toMatchObject({ statusCode: 400 });
        const manual = todos.create(parent, { title: 'Manual', type: 'manual' }, { actor: 'user' }).item;
        await expect(service.list(parent, manual.id)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('projects observed draft state while preserving the first terminal evidence after reopen', async () => {
        await service.registerSubmission(child.workspaceId, child.processId, url);
        const trigger = triggers.getAll()[0];
        if (trigger.event.monitor !== 'pr-merged') throw new Error('Expected PR outcome monitor');
        trigger.event.lastSeenStatus = 'draft';
        triggers.update(trigger);
        expect(await service.list(parent, itemId)).toMatchObject({ outcomes: [{ status: 'draft' }] });
        trigger.event.terminalObservation = { status: 'closed', observedAt: new Date().toISOString() };
        triggers.update(trigger);
        expect(await service.list(parent, itemId)).toMatchObject({ outcomes: [{ status: 'closed' }] });
    });

    it('serializes optimistic controls behind an already admitted review', async () => {
        let release!: () => void;
        const busy = new Promise<void>(resolve => { release = resolve; });
        const admission = service.withAdmission(parent, itemId, () => busy);
        const pause = service.control(parent, itemId, 'pause', { expectedRevision: 0 });
        await Promise.resolve();
        expect(controls.get(parent, itemId).paused).toBe(false);
        release();
        await admission;
        expect(await pause).toMatchObject({ paused: true, revision: 1 });
    });

    async function admittedReview() {
        await service.registerSubmission(child.workspaceId, child.processId, url);
        const trigger = triggers.getAll()[0];
        trigger.status = 'disarmed';
        trigger.delivery = { deliveryId: 'admitted', reason: 'merged', state: 'delivered', firedAt: new Date().toISOString() };
        triggers.update(trigger);
        return trigger;
    }

    it('defers an already admitted review after pause and recovers its original receipt on resume', async () => {
        const trigger = await admittedReview();
        expect(await service.reviewExecutionDisposition(parent, trigger.id, 'admitted')).toBe('execute');
        await service.control(parent, itemId, 'pause', { expectedRevision: 0 });
        expect(await service.reviewExecutionDisposition(parent, trigger.id, 'admitted')).toBe('defer');
        expect(recoverPendingMessages).not.toHaveBeenCalled();
        await service.control(parent, itemId, 'check', { expectedRevision: 1 });
        expect(await service.reviewExecutionDisposition(parent, trigger.id, 'admitted')).toBe('defer');
        await service.control(parent, itemId, 'resume', { expectedRevision: 1 });
        expect(recoverPendingMessages).toHaveBeenCalledWith(parent.workspaceId, parent.processId);
        expect(await service.reviewExecutionDisposition(parent, trigger.id, 'admitted')).toBe('execute');
        expect(triggers.getById(trigger.id)?.delivery?.deliveryId).toBe('admitted');
        expect(deliverPending).not.toHaveBeenCalled();
    });

    it('defers execution while the live feature is disabled', async () => {
        const trigger = await admittedReview();
        enabled = false;
        expect(await service.reviewExecutionDisposition(parent, trigger.id, 'admitted')).toBe('defer');
        enabled = true;
        expect(await service.reviewExecutionDisposition(parent, trigger.id, 'admitted')).toBe('execute');
    });

    it('recovers already admitted reviews on enablement but retains paused buffers', async () => {
        await admittedReview();
        enabled = false;
        await service.restore();
        expect(recoverPendingMessages).not.toHaveBeenCalled();
        enabled = true;
        await service.restore();
        expect(recoverPendingMessages).toHaveBeenCalledExactlyOnceWith(parent.workspaceId, parent.processId);
        recoverPendingMessages.mockClear();
        await service.control(parent, itemId, 'pause', { expectedRevision: 0 });
        await service.restore();
        expect(recoverPendingMessages).not.toHaveBeenCalled();
    });

    it('rejects foreign owners and receipts without modifying their trigger', async () => {
        const trigger = await admittedReview();
        expect(await service.reviewExecutionDisposition({ ...parent, workspaceId: child.workspaceId }, trigger.id, 'admitted')).toBe('skip');
        expect(await service.reviewExecutionDisposition({ ...parent, processId: 'foreign' }, trigger.id, 'admitted')).toBe('skip');
        expect(await service.reviewExecutionDisposition(parent, trigger.id, 'foreign-receipt')).toBe('skip');
        expect(triggers.getById(trigger.id)).toEqual(trigger);
    });

    it.each([{ status: 'done' as const }, { archived: true }])('skips an admitted review after the latest item verdict changes: %j', async change => {
        const trigger = await admittedReview();
        todos.update(parent, itemId, 1, change, 'user');
        expect(await service.reviewExecutionDisposition(parent, trigger.id, 'admitted')).toBe('skip');
        expect(triggers.getById(trigger.id)).toMatchObject({ outcome: 'skipped', delivery: { state: 'failed' } });
    });

    it('exposes a permanent failure when the admitted exact job link disappears', async () => {
        const trigger = await admittedReview();
        job.pullRequests = [];
        expect(await service.reviewExecutionDisposition(parent, trigger.id, 'admitted')).toBe('skip');
        expect(await service.list(parent, itemId)).toMatchObject({
            outcomes: [{ delivery: 'error', error: 'Exact delegated PR owner or job link is unavailable' }],
        });
    });

    it('exposes a permanent failure when the admitted Sentinel owner disappears', async () => {
        const trigger = await admittedReview();
        listOwner.mockRejectedValueOnce(new SentinelTodoError('not_found', 'Missing owner'));
        expect(await service.reviewExecutionDisposition(parent, trigger.id, 'admitted')).toBe('skip');
        expect(triggers.getById(trigger.id)).toMatchObject({ outcome: 'error', delivery: { state: 'failed' } });
    });
    it('surfaces storage failures without turning a valid receipt into a missing-owner failure', async () => {
        const trigger = await admittedReview();
        const failure = new Error('Storage unavailable');
        listOwner.mockRejectedValueOnce(failure);
        await expect(service.reviewExecutionDisposition(parent, trigger.id, 'admitted')).rejects.toBe(failure);
        expect(triggers.getById(trigger.id)).toEqual(trigger);
    });
});

/**
 * A tracked Ralph delegation's child `processId` only identifies the first
 * grill/launch admission; every later iteration, final-check and submit turn
 * runs under its own fresh processId. `registerSubmission` must find the
 * original job by the session identity an accepted grill actually executes
 * under (the saved execution pointer), never by inference over the newest
 * session or by trusting tool-supplied routing alone.
 */
describe('Sentinel PR outcome tracking — Ralph execution-owner provenance', () => {
    let dataDir: string;
    let db: NativeDatabase;
    let todos: SentinelTodoStore;
    let triggers: TriggerStore;
    let controls: SentinelPrOutcomeControls;
    let service: SentinelPrOutcomeService;
    let jobsByWorkspace: Map<string, DelegatedJob[]>;
    let processesById: Map<string, { parentProcessId?: string; metadata?: { ralph?: { sessionId?: string } } }>;
    let itemId: string;
    const recordPullRequest = vi.fn();
    const arm = vi.fn();
    const grillWorkspace = 'grill-ws';
    const execWorkspace = 'exec-ws';
    const grillSessionId = 'ralph-session-1';

    beforeEach(() => {
        vi.clearAllMocks();
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-pr-outcome-ralph-'));
        db = new NativeDatabase(':memory:');
        todos = new SentinelTodoStore(db);
        triggers = new TriggerStore(db);
        controls = new SentinelPrOutcomeControls(db);
        itemId = todos.create(parent, { title: 'Release', completionCondition: 'Published and verified' }, { actor: 'user' }).item.id;
        jobsByWorkspace = new Map();
        processesById = new Map();
        recordPullRequest.mockImplementation((_workspace: string, jobId: string, recordItemId: string, prUrl: string, requestOutcomeWatch = false) => {
            const job = [...jobsByWorkspace.values()].flat().find(candidate => candidate.id === jobId)!;
            const pr = parsePullRequestUrl(prUrl)!;
            const existing = job.pullRequests?.find(receipt => receipt.pr.url === pr.url);
            if (existing) {
                if (requestOutcomeWatch) existing.outcomeWatchRequestedAt ??= new Date().toISOString();
                return existing;
            }
            const receipt = { id: `receipt-${pr.number}`, itemId: recordItemId, pr, recordedAt: new Date().toISOString(),
                ...(requestOutcomeWatch ? { outcomeWatchRequestedAt: new Date().toISOString() } : {}) };
            (job.pullRequests ??= []).push(receipt);
            return receipt;
        });
        service = new SentinelPrOutcomeService({
            jobs: {
                list: (workspaceId: string) => jobsByWorkspace.get(workspaceId) ?? [],
                recordPullRequest,
                recordPullRequestOutcomeWatchError: vi.fn(),
                requestPullRequestOutcomeWatch: vi.fn(),
            } as never,
            dataDir,
            processes: {
                getWorkspaces: async () => [{ id: parent.workspaceId }, { id: grillWorkspace }, { id: execWorkspace }] as never,
                getProcess: async (processId: string) => processesById.get(processId) as never,
            },
            owners: { list: async () => todos.get(parent), findLinkedItem: () => todos.get(parent).items.find(item => item.id === itemId) },
            triggers, controls,
            manager: { arm, disarm: vi.fn(), schedulePendingDelivery: vi.fn(), checkOutcome: vi.fn() },
            firer: { fire: vi.fn(), deliverPending: vi.fn() }, enabled: () => true,
        });
    });

    afterEach(() => {
        db.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    function registerJob(job: DelegatedJob): void {
        const list = jobsByWorkspace.get(job.parent.workspaceId) ?? [];
        list.push(job);
        jobsByWorkspace.set(job.parent.workspaceId, list);
    }

    it('leaves ordinary non-Ralph jobs matched only by their exact child processId', async () => {
        const job: DelegatedJob = { id: 'job-ordinary', parent, child: { ...child }, title: 'Plain', createdAt: new Date().toISOString() };
        registerJob(job);
        const result = await service.registerSubmission(child.workspaceId, child.processId, url);
        expect(result.registered).toBe(true);
        expect(recordPullRequest).toHaveBeenCalledWith(parent.workspaceId, job.id, itemId, url, true);
    });

    it('matches a direct Ralph execution launch by session identity across later iteration/submit processIds', async () => {
        const job: DelegatedJob = {
            id: 'job-direct', parent,
            child: { workspaceId: grillWorkspace, processId: 'grill-task-1', sessionId: grillSessionId },
            title: 'Ralph', createdAt: new Date().toISOString(),
        };
        registerJob(job);
        processesById.set('submit-task-9', { metadata: { ralph: { sessionId: grillSessionId } } });
        const result = await service.registerSubmission(grillWorkspace, 'submit-task-9', url);
        expect(result.registered).toBe(true);
        expect(recordPullRequest).toHaveBeenCalledWith(parent.workspaceId, job.id, itemId, url, true);
    });

    it('matches an accepted grill\'s same-server cross-workspace execution via the saved pointer', async () => {
        const job: DelegatedJob = {
            id: 'job-pointer', parent,
            child: { workspaceId: grillWorkspace, processId: 'grill-task-2', sessionId: grillSessionId },
            title: 'Ralph', createdAt: new Date().toISOString(),
        };
        registerJob(job);
        await new RalphGrillingStore(dataDir).write({
            workspaceId: grillWorkspace, sessionId: grillSessionId, processId: 'grill-task-2',
            start: {
                taskId: 'grill-task-2', goalSpec: 'Ship it', status: 'admitted',
                execution: { workspaceId: execWorkspace, sessionId: 'exec-session-1', processId: 'exec-task-1', remote: false },
            },
        });
        processesById.set('submit-task-10', { metadata: { ralph: { sessionId: 'exec-session-1' } } });
        const result = await service.registerSubmission(execWorkspace, 'submit-task-10', url);
        expect(result.registered).toBe(true);
        expect(recordPullRequest).toHaveBeenCalledWith(parent.workspaceId, job.id, itemId, url, true);
    });

    it('skips remote execution with a visible unavailable warning instead of matching it', async () => {
        const job: DelegatedJob = {
            id: 'job-remote', parent,
            child: { workspaceId: grillWorkspace, processId: 'grill-task-3', sessionId: grillSessionId },
            title: 'Ralph', createdAt: new Date().toISOString(),
        };
        registerJob(job);
        await new RalphGrillingStore(dataDir).write({
            workspaceId: grillWorkspace, sessionId: grillSessionId, processId: 'grill-task-3',
            start: {
                taskId: 'grill-task-3', goalSpec: 'Ship it', status: 'admitted',
                execution: { workspaceId: execWorkspace, sessionId: 'exec-session-2', processId: 'exec-task-2', remote: true },
            },
        });
        processesById.set('submit-task-11', { parentProcessId: 'parent-proc', metadata: { ralph: { sessionId: 'exec-session-2' } } });
        const result = await service.registerSubmission(execWorkspace, 'submit-task-11', url);
        expect(result).toEqual({ registered: false, warning: expect.stringContaining('unavailable') });
        expect(recordPullRequest).not.toHaveBeenCalled();
    });

    it('does not match a job whose child origin itself is a remote delegation', async () => {
        const job: DelegatedJob = {
            id: 'job-remote-child', parent,
            child: { workspaceId: grillWorkspace, processId: 'grill-task-7', sessionId: grillSessionId, serverId: 'remote-server' },
            title: 'Ralph', createdAt: new Date().toISOString(),
        };
        registerJob(job);
        processesById.set('submit-task-13', { metadata: { ralph: { sessionId: grillSessionId } } });
        const result = await service.registerSubmission(grillWorkspace, 'submit-task-13', url);
        expect(result).toEqual({ registered: false });
        expect(recordPullRequest).not.toHaveBeenCalled();
    });

    it('rejects spoofed or mismatched session metadata instead of matching an unrelated job', async () => {
        const job: DelegatedJob = {
            id: 'job-mismatch', parent,
            child: { workspaceId: grillWorkspace, processId: 'grill-task-4', sessionId: grillSessionId },
            title: 'Ralph', createdAt: new Date().toISOString(),
        };
        registerJob(job);
        processesById.set('submit-task-12', { metadata: { ralph: { sessionId: 'not-a-tracked-session' } } });
        const result = await service.registerSubmission(grillWorkspace, 'submit-task-12', url);
        expect(result).toEqual({ registered: false });
        expect(recordPullRequest).not.toHaveBeenCalled();
    });

    it('rejects ambiguity when a direct processId match and a session-based match disagree', async () => {
        const jobA: DelegatedJob = {
            id: 'job-5a', parent,
            child: { workspaceId: grillWorkspace, processId: 'shared-task', sessionId: 'session-a' },
            title: 'A', createdAt: new Date().toISOString(),
        };
        const jobB: DelegatedJob = {
            id: 'job-5b', parent: { ...parent, processId: 'other-parent' },
            child: { workspaceId: grillWorkspace, processId: 'other-task', sessionId: 'session-b' },
            title: 'B', createdAt: new Date().toISOString(),
        };
        registerJob(jobA);
        registerJob(jobB);
        // The tool call reports jobA's exact processId directly, but that very process's own
        // authoritative Ralph session metadata resolves to jobB's tracked session instead.
        processesById.set('shared-task', { metadata: { ralph: { sessionId: 'session-b' } } });
        await expect(service.registerSubmission(grillWorkspace, 'shared-task', url)).rejects.toThrow('ambiguous');
        expect(recordPullRequest).not.toHaveBeenCalled();
    });

    it('dedups repeated submissions of the same PR reported across different iteration/submit processIds', async () => {
        const job: DelegatedJob = {
            id: 'job-dedup', parent,
            child: { workspaceId: grillWorkspace, processId: 'grill-task-6', sessionId: grillSessionId },
            title: 'Ralph', createdAt: new Date().toISOString(),
        };
        registerJob(job);
        processesById.set('iteration-task', { metadata: { ralph: { sessionId: grillSessionId } } });
        processesById.set('submit-task', { metadata: { ralph: { sessionId: grillSessionId } } });
        const first = await service.registerSubmission(grillWorkspace, 'iteration-task', url);
        const second = await service.registerSubmission(grillWorkspace, 'submit-task', url);
        expect(second).toEqual(first);
        expect(triggers.getAll()).toHaveLength(1);
        expect(arm).toHaveBeenCalledTimes(1);
    });
});
