import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import type { DelegatedJob } from '../../../src/server/delegation/delegated-job-store';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { TriggerStore } from '../../../src/server/triggers/trigger-store';
import { SentinelPrOutcomeControls } from '../../../src/server/triggers/sentinel-pr-outcome-controls';
import { SentinelPrOutcomeService } from '../../../src/server/triggers/sentinel-pr-outcome-service';
import { parsePullRequestUrl } from '../../../src/server/triggers/pr-status-fetcher';

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
        listOwner.mockRejectedValueOnce(new Error('Missing owner'));
        expect(await service.reviewExecutionDisposition(parent, trigger.id, 'admitted')).toBe('skip');
        expect(triggers.getById(trigger.id)).toMatchObject({ outcome: 'error', delivery: { state: 'failed' } });
    });
});
