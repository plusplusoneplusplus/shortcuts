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

    function wire() {
        const hooks = createSentinelTodoDelegationHooks(service, () => enabled);
        reviews = new DelegatedJobReviews({
            jobs, store, queue: queue as any, delivery: { deliverOnce, deliverNoticeOnce } as any,
            findTodo: job => hooks.findTodo(job),
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
        service = new SentinelTodoService({ todos, store, jobs, getTask: queue.getTask as any });
        jobs.register({ id: childId, title: 'Fix login', parent: owner, child: { workspaceId: 'ws-child', processId: childId } });
        wire();
    });
    afterEach(() => {
        results.dispose(); reviews.dispose();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function linkedItem(): Promise<SentinelTodoItem> {
        const { item } = await service.create(owner, { title: 'Fix login', completionCondition: 'Login e2e passes' }, { actor: 'sentinel' });
        return (await service.linkJob(owner, item.id, {
            processId: childId, workspaceId: 'ws-child', kind: 'local', openLink: `#/process/${childId}`,
        })).item;
    }
    function finish(status: 'completed' | 'failed' | 'cancelled', error?: string) {
        const event = status === 'completed' ? 'taskCompleted' : status === 'failed' ? 'taskFailed' : 'taskCancelled';
        queue.emit(event, {
            id: 'child', type: 'chat', status, processId: childId, repoId: 'ws-child',
            payload: { kind: 'chat', workspaceId: 'ws-child' }, result: 'Implemented the fix', ...(error ? { error } : {}),
        });
    }
    function item(id: string): SentinelTodoItem {
        return todos.get(owner).items.find(row => row.id === id)!;
    }

    it('keeps the item in progress after completion and asks Sentinel for an explicit verdict', async () => {
        const linked = await linkedItem();
        finish('completed');
        await flush();
        expect(item(linked.id)).toMatchObject({ status: 'in_progress', jobs: [{ result: { outcome: 'completed' } }] });
        expect(deliverOnce).toHaveBeenCalledTimes(1);
        const content: string = deliverOnce.mock.calls[0][3].content;
        expect(content).toContain('Receiving this result is not a verdict');
        expect(content).toContain('`sentinel_todos`');
        const data = JSON.parse(content.slice(content.indexOf('{')));
        expect(data.todo).toEqual({
            id: linked.id, revision: linked.revision + 1, title: 'Fix login',
            completionCondition: 'Login e2e passes', status: 'in_progress',
        });
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
            state: 'completed', review: { state: 'failed', reason: 'Parent chat is gone' },
        });
    });

    it('reports live local execution separately from the item status', async () => {
        await linkedItem();
        queue.getTask.mockReturnValue({ id: 'child', status: 'running' });
        expect((await service.list(owner)).items[0].jobs[0].execution).toEqual({ state: 'running' });
        queue.getTask.mockReturnValue(undefined);
        expect((await service.list(owner)).items[0].jobs[0].execution).toEqual({ state: 'unknown' });
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
