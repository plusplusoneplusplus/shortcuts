import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProcess, ProcessStore, QueuedTask } from '@plusplusoneplusplus/forge';
import { SentinelTodoStore, type SentinelTodoItem } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { createSentinelTodoDelegationHooks } from '../../../src/server/sentinel-todos/sentinel-todo-delegation';
import { DelegatedJobStore } from '../../../src/server/delegation/delegated-job-store';
import { DelegatedJobResults } from '../../../src/server/delegation/delegated-job-results';
import { DelegatedJobReviews } from '../../../src/server/delegation/delegated-job-reviews';
import { sentinelTodoDisplayStatus } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoPanelModel';

const owner = { workspaceId: 'ws-parent', processId: 'queue_parent' };
const childId = 'queue_child';
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 20));

describe('Sentinel to-do reviewed outcomes', () => {
    let dataDir: string;
    let enabled: boolean;
    let jobs: DelegatedJobStore;
    let todos: SentinelTodoStore;
    let service: SentinelTodoService;
    let queue: EventEmitter & { getTask: ReturnType<typeof vi.fn>; getHistory: () => QueuedTask[]; getQueued: () => QueuedTask[]; getRunning: () => QueuedTask[] };
    let deliverOnce: ReturnType<typeof vi.fn>;
    let deliverNoticeOnce: ReturnType<typeof vi.fn>;
    let reviews: DelegatedJobReviews;
    let results: DelegatedJobResults;
    let store: ProcessStore;
    let onChange: ReturnType<typeof vi.fn>;

    function wire() {
        const hooks = createSentinelTodoDelegationHooks(service, () => enabled);
        reviews = new DelegatedJobReviews({
            jobs, store, queue: queue as any, delivery: { deliverOnce, deliverNoticeOnce } as any,
            findTodo: job => hooks.findTodo(job),
            onDeliveryChange: job => hooks.deliveryChanged(job),
        });
        results = new DelegatedJobResults({
            jobs, store, queue: queue as any,
            onResult: job => { hooks.recordResult(job); return reviews.schedule(job); },
        });
    }

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-sentinel-todo-review-'));
        enabled = true;
        const parent = {
            id: owner.processId, type: 'chat', status: 'completed', startTime: new Date(),
            metadata: { workspaceId: owner.workspaceId, mode: 'sentinel' },
        } as unknown as AIProcess;
        store = {
            getProcess: vi.fn(async (id: string) => id === owner.processId ? parent : undefined),
            getWorkspaces: vi.fn(async () => [{ id: owner.workspaceId, name: 'parent', rootPath: '/p' }]),
        } as unknown as ProcessStore;
        queue = Object.assign(new EventEmitter(), {
            getTask: vi.fn(() => undefined), getHistory: () => [], getQueued: () => [], getRunning: () => [],
        });
        deliverOnce = vi.fn(async () => ({ path: 'queued', events: [] }));
        deliverNoticeOnce = vi.fn(async () => 'delivered');
        jobs = new DelegatedJobStore(dataDir);
        todos = new SentinelTodoStore(dataDir);
        onChange = vi.fn();
        service = new SentinelTodoService({ todos, store, jobs, onChange, getTask: queue.getTask as any });
        jobs.register({ id: childId, title: 'Fix login', parent: owner, child: { workspaceId: 'ws-child', processId: childId } });
        wire();
    });
    afterEach(() => {
        results.dispose(); reviews.dispose();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function linkedItem(completionCondition = 'Login e2e passes'): Promise<SentinelTodoItem> {
        const { item } = await service.create(owner, { title: 'Fix login', completionCondition }, { actor: 'sentinel' });
        return (await service.linkJob(owner, item.id, {
            processId: childId, workspaceId: 'ws-child', kind: 'local', openLink: `#/process/${childId}`,
        })).item;
    }
    function finish(status: 'completed' | 'failed' | 'cancelled', error?: string, processId = childId, result = 'Implemented the fix') {
        const event = status === 'completed' ? 'taskCompleted' : status === 'failed' ? 'taskFailed' : 'taskCancelled';
        queue.emit(event, {
            id: processId, type: 'chat', status, processId, repoId: 'ws-child',
            payload: { kind: 'chat', workspaceId: 'ws-child' }, result, ...(error ? { error } : {}),
        });
    }
    function item(id: string): SentinelTodoItem {
        return todos.get(owner).items.find(row => row.id === id)!;
    }
    function evidence(processId = childId) {
        const job = jobs.list(owner.workspaceId).find(job => job.id === processId)!;
        return [{ processId, terminalEventId: job.terminal!.result.terminalEventId }];
    }
    async function view() { return (await service.list(owner)).items[0]; }

    it('keeps delivered parent turns in review until an explicit durable assessment commits', async () => {
        const linked = await linkedItem();
        finish('completed');
        await flush();
        const delivery = jobs.list(owner.workspaceId)[0].terminal!.delivery;
        expect(delivery.state).toBe('queued');
        expect(sentinelTodoDisplayStatus(await view())).toBe('in_review');
        if (delivery.state !== 'queued') throw new Error('Expected admitted review');
        onChange.mockClear();
        queue.emit('taskCompleted', {
            id: delivery.receiptId, type: 'chat', status: 'completed', processId: owner.processId,
            repoId: owner.workspaceId,
            payload: { processId: owner.processId, workspaceId: owner.workspaceId, relayRequestId: delivery.receiptId },
        });
        await flush();
        expect(jobs.list(owner.workspaceId)[0].terminal!.delivery.state).toBe('delivered');
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
            owner, item: expect.objectContaining({ id: linked.id }),
            ledgerRevision: todos.get(owner).revision,
        }));
        // Repeated terminal delivery events must not publish a second invalidation.
        const notifications = onChange.mock.calls.length;
        queue.emit('taskCompleted', {
            id: delivery.receiptId, type: 'chat', status: 'completed', processId: owner.processId,
            payload: { processId: owner.processId, workspaceId: owner.workspaceId, relayRequestId: delivery.receiptId },
        });
        await flush();
        expect(onChange).toHaveBeenCalledTimes(notifications);
        expect((await view()).jobs[0].execution).toMatchObject({ review: { state: 'delivered', assessment: 'pending' } });
        expect(sentinelTodoDisplayStatus(await view())).toBe('in_review');
        // Neither timestamp advancement nor unrelated user/AI edits proves judgment.
        for (const actor of ['user', 'sentinel'] as const) {
            await service.update(owner, linked.id, item(linked.id).revision, { notes: `Notes by ${actor}` }, actor);
            expect(sentinelTodoDisplayStatus(await view())).toBe('in_review');
        }
        const staleRevision = item(linked.id).revision;
        await service.update(owner, linked.id, staleRevision, { priority: 'high' }, 'user');
        await expect(service.update(owner, linked.id, staleRevision, {
            status: 'todo', statusReason: 'Spec ready; awaiting implementation approval', reviewedJobs: evidence(),
        }, 'sentinel')).rejects.toMatchObject({ code: 'conflict' });
        expect(sentinelTodoDisplayStatus(await view())).toBe('in_review');
        await service.update(owner, linked.id, item(linked.id).revision, {
            status: 'todo', statusReason: 'Spec ready; awaiting implementation approval', reviewedJobs: evidence(),
        }, 'sentinel');
        expect(sentinelTodoDisplayStatus(await view())).toBe('todo');
        expect((await view()).jobs[0].execution).toMatchObject({ review: { assessment: 'reviewed' } });
        const acknowledged = item(linked.id).jobs[0].result!.reviewed;
        todos = new SentinelTodoStore(dataDir);
        service = new SentinelTodoService({ todos, store, jobs });
        expect(sentinelTodoDisplayStatus(await view())).toBe('todo');
        await service.update(owner, linked.id, item(linked.id).revision, {
            status: 'todo', statusReason: 'Spec ready; awaiting implementation approval', reviewedJobs: evidence(),
        }, 'sentinel');
        expect(item(linked.id).jobs[0].result!.reviewed).toEqual(acknowledged);
    });

    it.each([
        ['completed', 'done', 'Final condition verified'],
        ['completed', 'todo', 'Spec ready; awaiting implementation approval'],
        ['failed', 'needs_attention', 'Tests failed'],
        ['completed', 'in_progress', 'Authorized follow-up continues'],
    ] as const)('acknowledges %s evidence with an explicit %s verdict', async (outcome, status, reason) => {
        const linked = await linkedItem();
        finish(outcome);
        await flush();
        expect(sentinelTodoDisplayStatus(await view())).toBe('in_review');
        await service.update(owner, linked.id, item(linked.id).revision, {
            status, statusReason: reason, reviewedJobs: evidence(),
            ...(status === 'done' ? { outcome: reason } : {}),
        }, 'sentinel');
        expect(sentinelTodoDisplayStatus(await view())).toBe(status);
        expect(item(linked.id).jobs[0].result?.reviewed?.recordedBy).toBe('sentinel');
    });

    it('keeps concurrent follow-ups visible and acknowledges only the assessed job', async () => {
        const linked = await linkedItem();
        finish('completed');
        await flush();
        const followup = 'queue_followup';
        jobs.register({ id: followup, title: 'Implement', parent: owner,
            child: { workspaceId: 'ws-child', processId: followup } });
        await service.linkJob(owner, linked.id, {
            processId: followup, workspaceId: 'ws-child', kind: 'local', openLink: '#',
        });
        queue.getTask.mockImplementation(id => id === 'followup' ? { status: 'running' } : undefined);
        expect(sentinelTodoDisplayStatus(await view())).toBe('in_progress');
        expect((await view()).jobs[0].execution).toMatchObject({ review: { assessment: 'pending' } });
        finish('completed', undefined, followup);
        await flush();
        await service.update(owner, linked.id, item(linked.id).revision, {
            status: 'in_progress', statusReason: 'First result assessed', reviewedJobs: evidence(),
        }, 'sentinel');
        expect((await view()).jobs.map(job => 'review' in job.execution && job.execution.review?.assessment))
            .toEqual(['reviewed', 'pending']);
        expect(sentinelTodoDisplayStatus(await view())).toBe('in_review');
    });

    it.each([{ status: 'todo' as const }, { status: 'done' as const }, { archived: true }])(
        'preserves an explicit user verdict against late stale assessment: %j', async verdict => {
            const linked = await linkedItem();
            await service.update(owner, linked.id, linked.revision, verdict, 'user');
            finish('completed');
            await flush();
            const accepted = item(linked.id);
            await expect(service.update(owner, linked.id, accepted.revision, {
                status: 'needs_attention', statusReason: 'Stale verdict', reviewedJobs: evidence(),
            }, 'sentinel')).rejects.toMatchObject({ code: 'invalid' });
            await expect(service.update(owner, linked.id, accepted.revision, {
                status: 'needs_attention', statusReason: 'Stale verdict without acknowledgment',
            }, 'sentinel')).rejects.toMatchObject({ code: 'invalid' });
            expect(item(linked.id)).toEqual(accepted);
            expect(sentinelTodoDisplayStatus(await view())).toBe(accepted.status);
            expect((await view()).jobs[0].execution).toMatchObject({ review: { assessment: 'superseded' } });
        },
    );

    it('user status selection supersedes pending assessment without claiming the evidence was reviewed', async () => {
        const linked = await linkedItem();
        finish('completed');
        await flush();
        await service.update(owner, linked.id, item(linked.id).revision, { status: 'todo' }, 'user');
        expect((await view()).jobs[0].execution).toMatchObject({ review: { assessment: 'superseded' } });
        expect(item(linked.id).jobs[0].result?.reviewed).toBeUndefined();
        expect(sentinelTodoDisplayStatus(await view())).toBe('todo');
    });

    it('rejects missing, foreign, remote, and nonterminal acknowledgment evidence atomically', async () => {
        const linked = await linkedItem();
        finish('completed');
        await flush();
        const accepted = item(linked.id);
        for (const reviewedJobs of [
            [{ processId: 'queue_other', terminalEventId: evidence()[0].terminalEventId }],
            [{ processId: childId, terminalEventId: 'foreign-event' }],
        ]) {
            await expect(service.update(owner, linked.id, accepted.revision, {
                status: 'todo', statusReason: 'Assessed', reviewedJobs,
            }, 'sentinel')).rejects.toMatchObject({ code: 'invalid' });
        }
        await expect(service.update(owner, linked.id, accepted.revision, { reviewedJobs: evidence() }, 'sentinel'))
            .rejects.toMatchObject({ code: 'invalid' });
        expect(item(linked.id)).toEqual(accepted);
    });

    it('allows newly authorized linked work to be assessed without changing the earlier user verdict evidence', async () => {
        const linked = await linkedItem();
        finish('completed');
        await flush();
        await service.update(owner, linked.id, item(linked.id).revision, { status: 'todo' }, 'user');
        const followup = 'queue_approved';
        jobs.register({ id: followup, title: 'Approved implementation', parent: owner,
            child: { workspaceId: 'ws-child', processId: followup } });
        await service.linkJob(owner, linked.id, {
            processId: followup, workspaceId: 'ws-child', kind: 'local', openLink: '#',
        });
        finish('completed', undefined, followup);
        await flush();
        await service.update(owner, linked.id, item(linked.id).revision, {
            status: 'done', statusReason: 'Final condition verified', reviewedJobs: evidence(followup),
        }, 'sentinel');
        expect(item(linked.id).jobs.map(job => job.result?.reviewed?.recordedBy)).toEqual([undefined, 'sentinel']);
        expect((await view()).jobs[0].execution).toMatchObject({ review: { assessment: 'superseded' } });
        expect(sentinelTodoDisplayStatus(await view())).toBe('done');
    });

    it('does not acknowledge remote or running jobs, even when their process IDs collide with local evidence', async () => {
        const linked = await linkedItem();
        await service.linkJob(owner, linked.id, {
            processId: 'queue_remote', workspaceId: 'ws-child', serverId: 'srv-2', kind: 'remote', openLink: '#',
        });
        finish('completed');
        await flush();
        const accepted = item(linked.id);
        await expect(service.update(owner, linked.id, accepted.revision, {
            status: 'todo', statusReason: 'Unverified remote',
            reviewedJobs: [{ processId: 'queue_remote', terminalEventId: evidence()[0].terminalEventId }],
        }, 'sentinel')).rejects.toMatchObject({ code: 'invalid' });
        expect(item(linked.id)).toEqual(accepted);
        expect((await view()).jobs[1].execution).toEqual({ state: 'unavailable' });
        expect(sentinelTodoDisplayStatus(await view())).toBe('in_progress');
    });

    it('keeps the item in progress after completion and asks Sentinel for an explicit verdict', async () => {
        const linked = await linkedItem();
        finish('completed');
        await flush();
        expect(item(linked.id)).toMatchObject({ status: 'in_progress', jobs: [{ result: { outcome: 'completed' } }] });
        expect(deliverOnce).toHaveBeenCalledTimes(1);
        const content: string = deliverOnce.mock.calls[0][3].content;
        expect(content).toContain('Receiving this result is not a verdict');
        expect(content).toContain('`sentinel_todos`');
        expect(content).toContain('intended feature/outcome\'s final completion condition');
        expect(content).toContain('`done` with a short reason only if the final completion condition is satisfied');
        expect(content).toContain('`todo` for pending next steps or approval');
        expect(content).toContain('`in_progress` while authorized work continues');
        expect(content).toContain('`needs_attention` with a reason for failed, cancelled, blocked, or incomplete final work');
        expect(content).toContain('Successful intermediate phases are neither `done` nor failures');
        expect(content).toContain('Spec ready; awaiting implementation approval');
        expect(content).toContain('Do not launch implementation or a retry without user authorization');
        expect(content).toContain('honor manual user verdicts and latest instructions');
        expect(content).toContain('current `expectedRevision`');
        expect(content).toContain('preserve existing notes and record phase milestones and spec/artifact links');
        expect(content).toContain('Explicitly design-only/interview-only requests can finish after their agreed artifact');
        expect(content).not.toContain('otherwise `needs_attention`');
        const data = JSON.parse(content.slice(content.indexOf('{')));
        expect(data.todo).toEqual({
            id: linked.id, revision: linked.revision + 1, title: 'Fix login',
            completionCondition: 'Login e2e passes', status: 'in_progress',
        });
    });

    it('never associates automatic job results or reviews with manual tracking', async () => {
        const manual = (await service.create(owner, {
            type: 'manual', title: 'Read the release checklist', notes: 'Tracking only',
        }, { actor: 'sentinel' })).item;
        await expect(service.linkJob(owner, manual.id, {
            processId: childId, workspaceId: 'ws-child', kind: 'local', openLink: `#/process/${childId}`,
        })).rejects.toMatchObject({ code: 'invalid' });
        const linked = await linkedItem();
        finish('completed');
        await flush();
        expect(item(manual.id)).toEqual(manual);
        expect(item(manual.id).jobs).toEqual([]);
        expect(deliverOnce).toHaveBeenCalledTimes(1);
        const content: string = deliverOnce.mock.calls[0][3].content;
        expect(content).not.toContain(manual.title);
        expect(JSON.parse(content.slice(content.indexOf('{'))).todo.id).toBe(linked.id);
        const hooks = createSentinelTodoDelegationHooks(service, () => enabled);
        expect(hooks.findTodo(jobs.list(owner.workspaceId)[0])?.id).toBe(linked.id);
    });

    it('reviews grilling as intermediate todo and final implementation as done on the same feature item', async () => {
        const linked = await linkedItem();
        finish('completed', undefined, childId, 'Spec ready: notes/login-spec.md');
        await flush();
        const content: string = deliverOnce.mock.calls[0][3].content;
        expect(content).toContain('leave/return the feature item to `todo`');
        const specReady = await service.update(owner, linked.id, item(linked.id).revision, {
            status: 'todo', statusReason: 'Spec ready; awaiting implementation approval',
            notes: 'Grilling complete: notes/login-spec.md',
        }, 'sentinel');
        expect(specReady.item).toMatchObject({ status: 'todo', completionCondition: 'Login e2e passes' });
        expect(specReady.item.outcome).toBeUndefined();
        expect(jobs.list(owner.workspaceId)).toHaveLength(1);
        expect(deliverOnce).toHaveBeenCalledTimes(1);

        // A later user-authorized implementation serves the same outcome.
        const implementationId = 'queue_implementation';
        jobs.register({ id: implementationId, title: 'Implement login', parent: owner,
            child: { workspaceId: 'ws-child', processId: implementationId } });
        await service.linkJob(owner, linked.id, {
            processId: implementationId, workspaceId: 'ws-child', kind: 'local', openLink: `#/process/${implementationId}`,
        });
        finish('completed', undefined, implementationId, 'Login e2e passes');
        await flush();
        expect(item(linked.id).status).toBe('in_progress');
        const finalContent: string = deliverOnce.mock.calls[1][3].content;
        expect(JSON.parse(finalContent.slice(finalContent.indexOf('{'))).todo).toMatchObject({
            id: linked.id, completionCondition: 'Login e2e passes', status: 'in_progress',
        });
        await service.update(owner, linked.id, item(linked.id).revision, {
            status: 'done', statusReason: 'Login e2e passes', outcome: 'Login implemented and verified',
        }, 'sentinel');
        expect(todos.get(owner).items).toHaveLength(1);
        expect(item(linked.id)).toMatchObject({
            status: 'done', notes: specReady.item.notes,
            jobs: [{ result: { outcome: 'completed' } }, { result: { outcome: 'completed' } }],
            outcome: { summary: 'Login implemented and verified', recordedBy: 'sentinel' },
        });
    });

    it.each(['design-only', 'interview-only'])('allows an explicitly %s request to finish at its agreed artifact', async scope => {
        const condition = `${scope} spec delivered`;
        const linked = await linkedItem(condition);
        finish('completed', undefined, childId, condition);
        await flush();
        const content: string = deliverOnce.mock.calls[0][3].content;
        expect(content).toContain('Explicitly design-only/interview-only requests can finish after their agreed artifact');
        await service.update(owner, linked.id, item(linked.id).revision, {
            status: 'done', statusReason: condition, outcome: condition,
        }, 'sentinel');
        expect(item(linked.id)).toMatchObject({ status: 'done', outcome: { summary: condition } });
        expect(item(linked.id).jobs).toHaveLength(1);
    });

    it('marks done only through an explicit reviewed verdict with a stored outcome', async () => {
        const linked = await linkedItem();
        finish('completed');
        await flush();
        const reviewed = await service.update(owner, linked.id, item(linked.id).revision,
            { status: 'done', statusReason: 'Login e2e passes', outcome: 'Login e2e passes on main' }, 'sentinel');
        expect(reviewed.item).toMatchObject({
            status: 'done', outcome: { summary: 'Login e2e passes on main', recordedBy: 'sentinel' },
        });
    });

    it('moves a failed job to needs attention with its reason before the review is delivered', async () => {
        const linked = await linkedItem();
        let statusAtReview: string | undefined;
        deliverOnce.mockImplementation(async () => {
            statusAtReview = item(linked.id).status;
            return { path: 'queued', events: [] };
        });
        finish('failed', 'Tests failed');
        await flush();
        expect(item(linked.id)).toMatchObject({ status: 'needs_attention', statusReason: 'Job "Fix login" failed: Tests failed' });
        expect(statusAtReview).toBe('needs_attention');
    });

    it('records cancellation as needs attention without a review or retry', async () => {
        const linked = await linkedItem();
        finish('cancelled');
        await flush();
        expect(item(linked.id).status).toBe('needs_attention');
        expect(deliverOnce).not.toHaveBeenCalled();
        expect(deliverNoticeOnce).toHaveBeenCalledTimes(1);
    });

    it('is idempotent across restart replays and preserves a newer user edit', async () => {
        const linked = await linkedItem();
        finish('failed', 'Tests failed');
        await flush();
        const afterFailure = item(linked.id);
        await service.update(owner, linked.id, afterFailure.revision, { status: 'todo' }, 'user');
        const revision = item(linked.id).revision;
        results.dispose(); reviews.dispose();
        wire();
        await results.restore();
        finish('failed', 'Duplicate event');
        await flush();
        expect(item(linked.id)).toMatchObject({ status: 'todo', revision });
    });

    it('surfaces review-delivery failure on the job without marking the item done', async () => {
        const linked = await linkedItem();
        const { ReviewDeliveryRejectedError } = await import('../../../src/server/processes/process-message-delivery-service');
        deliverOnce.mockRejectedValue(new ReviewDeliveryRejectedError('Parent chat is gone'));
        finish('completed');
        await flush();
        const view = (await service.list(owner)).items.find(row => row.id === linked.id)!;
        expect(view.status).toBe('in_progress');
        expect(view.jobs[0].execution).toEqual({
            state: 'completed', review: { state: 'failed', reason: 'Parent chat is gone',
                assessment: 'pending', terminalEventId: evidence()[0].terminalEventId },
        });
    });

    it('reports live local execution separately from the item status', async () => {
        await linkedItem();
        queue.getTask.mockReturnValue({ id: 'child', status: 'running' });
        expect((await service.list(owner)).items[0].jobs[0].execution).toEqual({ state: 'running' });
        queue.getTask.mockReturnValue(undefined);
        expect((await service.list(owner)).items[0].jobs[0].execution).toEqual({ state: 'unknown' });
    });

    it('does not borrow a running queue task from another workspace', async () => {
        await linkedItem();
        queue.getTask.mockReturnValue({ status: 'running', repoId: 'ws-other', payload: { workspaceId: 'ws-other' } });
        expect((await view()).jobs[0].execution).toEqual({ state: 'unknown' });
    });

    it('records a reviewed outcome for a remote job without launching anything', async () => {
        const { item: created } = await service.create(owner, { title: 'Remote fix' }, { actor: 'sentinel' });
        const { item: linked } = await service.linkJob(owner, created.id, {
            processId: 'queue_remote', workspaceId: 'w-api', serverId: 'srv-1', kind: 'remote', openLink: '#repos/x/chats/queue_remote',
        });
        const done = await service.update(owner, linked.id, linked.revision,
            { status: 'done', outcome: 'Checked the remote chat: fixed' }, 'user');
        expect(done.item).toMatchObject({ status: 'done', outcome: { summary: 'Checked the remote chat: fixed', recordedBy: 'user' } });
        expect((await service.list(owner)).items[0].jobs[0].execution).toEqual({ state: 'unavailable' });
        expect(deliverOnce).not.toHaveBeenCalled();
    });

    it('leaves items and review prompts untouched when the feature flag is off', async () => {
        const linked = await linkedItem();
        enabled = false;
        finish('failed', 'Tests failed');
        await flush();
        expect(item(linked.id)).toMatchObject({ status: 'in_progress', revision: linked.revision });
        expect(item(linked.id).jobs[0].result).toBeUndefined();
        const content: string = deliverOnce.mock.calls[0][3].content;
        expect(content).not.toContain('sentinel_todos');
        expect(JSON.parse(content.slice(content.indexOf('{'))).todo).toBeUndefined();
    });

    it('still delivers the review when the ledger cannot be read', async () => {
        await linkedItem();
        vi.spyOn(service, 'findLinkedItem').mockImplementation(() => { throw new Error('corrupt'); });
        vi.spyOn(service, 'recordJobResult').mockImplementation(() => { throw new Error('disk full'); });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        finish('completed');
        await flush();
        expect(deliverOnce).toHaveBeenCalledTimes(1);
    });
});
