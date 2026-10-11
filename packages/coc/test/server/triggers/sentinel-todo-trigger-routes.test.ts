import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { TriggerStore } from '../../../src/server/triggers/trigger-store';
import { SentinelTodoTriggerService } from '../../../src/server/triggers/sentinel-todo-trigger-service';
import { SentinelTodoTriggerFirer } from '../../../src/server/triggers/sentinel-todo-trigger-firer';
import { registerSentinelTodoTriggerRoutes } from '../../../src/server/triggers/sentinel-todo-trigger-routes';
import { registerTriggerRoutes } from '../../../src/server/triggers/trigger-handler';
import { TriggerManager } from '../../../src/server/triggers/trigger-manager';
import { ScheduleTimerRegistry } from '../../../src/server/schedule/schedule-timer-registry';
import type { Route } from '../../../src/server/types';

const owner = { workspaceId: 'ws-owner', processId: 'sentinel-owner' };
const base = `/api/workspaces/${owner.workspaceId}/sentinel-todos/${owner.processId}/triggers`;
const prUrl = 'https://dev.azure.com/example/project/_git/repo/pullrequest/1';

describe('Sentinel To-do trigger REST ownership and lifecycle', () => {
    let store: SqliteProcessStore;
    let todos: SentinelTodoStore;
    let triggers: TriggerStore;
    let service: SentinelTodoTriggerService;
    let itemId: string;
    let routes: Route[];
    const fetchPr = vi.fn();
    const execute = vi.fn();

    beforeEach(async () => {
        vi.resetAllMocks();
        store = new SqliteProcessStore({ dbPath: ':memory:' });
        await store.addProcess({
            id: owner.processId, type: 'chat', promptPreview: '', status: 'completed', startTime: new Date(),
            metadata: { mode: 'sentinel', workspaceId: owner.workspaceId },
        });
        todos = new SentinelTodoStore(store.getDatabase());
        triggers = new TriggerStore(store.getDatabase());
        itemId = todos.create(owner, { title: 'Item' }, { actor: 'user' }).item.id;
        fetchPr.mockResolvedValue({ status: 'open', title: 'Open PR', url: prUrl });
        execute.mockResolvedValue(undefined);
        const firer = new SentinelTodoTriggerFirer({ triggers, todos, processes: store, executor: { execute }, emit: vi.fn() });
        service = new SentinelTodoTriggerService({
            triggers, todos, owners: new SentinelTodoService({ todos, store }), firer,
            manager: { arm: vi.fn(), disarm: vi.fn() }, fetchPr, enabled: true,
        });
        routes = [];
        registerSentinelTodoTriggerRoutes(routes, service, true);
    });
    afterEach(() => store.close());

    async function request(method: string, path: string, body?: unknown) {
        const route = routes.find(route => route.method === method && route.pattern.test(path))!;
        expect(route).toBeDefined();
        const req = new IncomingMessage(new Socket());
        req.method = method;
        req.headers = { 'content-type': 'application/json' };
        req.push(body === undefined ? '' : JSON.stringify(body));
        req.push(null);
        const res = new ServerResponse(req);
        let result: Record<string, any> = {};
        vi.spyOn(res, 'end').mockImplementation((data?: unknown) => {
            result = typeof data === 'string' || Buffer.isBuffer(data) ? JSON.parse(data.toString()) : {};
            return res;
        });
        await route.handler(req, res, path.match(route.pattern));
        return { status: res.statusCode, body: result };
    }
    async function create() {
        return request('POST', base, { itemId, prUrl, instruction: 'Owner guidance' });
    }

    it('creates, lists, previews and updates through the shared service without touching item status', async () => {
        const created = await create();
        expect(created.status).toBe(201);
        const rule = created.body.trigger;
        expect(rule).toMatchObject({
            expiresAt: null, processId: owner.processId, workspaceId: owner.workspaceId,
            event: { pr: { provider: 'ado', repoPath: 'example/project/repo' } },
            binding: { armedBy: 'user', itemId },
        });
        expect((await request('GET', base)).body.triggers).toHaveLength(1);
        expect((await request('POST', `${base}/preview`, { prUrl })).body.snapshot.title).toBe('Open PR');
        const paused = await request('POST', `${base}/${rule.id}/pause`, { expectedRevision: 1 });
        expect(paused.body.trigger.status).toBe('paused');
        const edit = await request('PATCH', `${base}/${rule.id}`, { expectedRevision: 2, itemId, prUrl, instruction: 'Changed' });
        expect(edit.body.trigger.binding.instruction).toBe('Changed');
        expect((await request('POST', `${base}/${rule.id}/resume`, { expectedRevision: 3 })).status).toBe(200);
        expect((await request('DELETE', `${base}/${rule.id}`, { expectedRevision: 4 })).status).toBe(200);
        expect((await request('GET', base)).body.triggers).toEqual([]);
        expect(todos.get(owner).items[0].status).toBe('todo');
    });

    it('requires confirmed Run now and uses up the rule without marking the item done', async () => {
        const rule = (await create()).body.trigger;
        expect((await request('POST', `${base}/${rule.id}/run-now`, { expectedRevision: 1 })).status).toBe(400);
        const fired = await request('POST', `${base}/${rule.id}/run-now`, { expectedRevision: 1, confirmed: true });
        expect(fired.body.trigger.outcome).toBe('fired');
        expect((await request('POST', `${base}/${rule.id}/run-now`, {
            expectedRevision: fired.body.trigger.revision, confirmed: true,
        })).status).toBe(409);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(todos.get(owner).items[0].status).toBe('todo');
    });

    it('returns 404 on a foreign workspace or another Sentinel process without leaking the rule', async () => {
        const rule = (await create()).body.trigger;
        await store.addProcess({
            id: 'other-sentinel', type: 'chat', promptPreview: '', status: 'completed', startTime: new Date(),
            metadata: { mode: 'sentinel', workspaceId: owner.workspaceId },
        });
        const foreign = base.replace(owner.workspaceId, 'foreign-workspace');
        expect((await request('GET', foreign)).status).toBe(404);
        expect((await request('DELETE', `${foreign}/${rule.id}`, { expectedRevision: 1 })).status).toBe(404);
        const other = base.replace(owner.processId, 'other-sentinel');
        expect((await request('DELETE', `${other}/${rule.id}`, { expectedRevision: 1 })).status).toBe(404);
        expect((await request('GET', other)).body.triggers).toEqual([]);
        expect(triggers.getById(rule.id)).not.toBeNull();
    });

    it('rejects manual item creation and arbitrary launch/author fields', async () => {
        const manual = todos.create(owner, { title: 'Manual', type: 'manual' }, { actor: 'user' }).item;
        expect((await request('POST', base, { itemId: manual.id, prUrl })).status).toBe(400);
        expect((await request('POST', base, { itemId, prUrl, mode: 'autopilot' })).status).toBe(400);
        expect((await request('POST', base, { itemId, prUrl, armedBy: 'sentinel' })).status).toBe(400);
        expect(execute).not.toHaveBeenCalled();
    });

    it('returns inline PR validation errors and stale revision 409 with the current rule', async () => {
        expect((await request('POST', `${base}/preview`, { prUrl: 'https://example.test/PR' })).status).toBe(400);
        const rule = (await create()).body.trigger;
        const conflict = await request('POST', `${base}/${rule.id}/pause`, { expectedRevision: 99 });
        expect(conflict.status).toBe(409);
        expect(conflict.body.current.id).toBe(rule.id);
        fetchPr.mockResolvedValue({ status: 'merged', title: 'PR', url: prUrl });
        expect((await create()).status).toBe(409);
        fetchPr.mockRejectedValue(new Error('PR credentials unavailable'));
        const result = await request('POST', `${base}/preview`, { prUrl });
        expect(result.status).toBe(502);
        expect(result.body.error).toContain('credentials unavailable');
    });

    it.each([
        ['GET', ''], ['POST', ''], ['POST', '/preview'], ['PATCH', '/rule-1'],
        ['DELETE', '/rule-1'], ['POST', '/rule-1/pause'], ['POST', '/rule-1/resume'], ['POST', '/rule-1/run-now'],
    ])('gates %s %s when triggers.enabled is off', async (method, suffix) => {
        routes = [];
        registerSentinelTodoTriggerRoutes(routes, service, false);
        expect((await request(method, `${base}${suffix}`, { itemId, prUrl })).status).toBe(403);
        expect(fetchPr).not.toHaveBeenCalled();
    });

    it('prevents legacy trigger endpoints bypassing bound-rule revision or ownership rules', async () => {
        const rule = (await create()).body.trigger;
        const timerRegistry = new ScheduleTimerRegistry();
        const manager = new TriggerManager({
            store: triggers, timerRegistry, actionExecutor: { execute }, resolveEvaluator: () => undefined,
        });
        registerTriggerRoutes(routes, { store: triggers, manager, enabled: true });
        try {
            const path = `/api/workspaces/${owner.workspaceId}/triggers/${rule.id}`;
            expect((await request('PATCH', path, { status: 'active' })).status).toBe(409);
            expect((await request('DELETE', path)).status).toBe(409);
            expect((await request('GET', path)).status).toBe(404);
            expect((await request('GET', `/api/workspaces/${owner.workspaceId}/triggers`)).body.triggers).toEqual([]);
            expect((await request('POST', `/api/workspaces/${owner.workspaceId}/triggers`, {
                processId: owner.processId, binding: { itemId }, event: {
                    type: 'condition-monitor', monitor: 'ci-failure', originId: 'origin-1', prId: '1',
                },
            })).status).toBe(400);
            expect(triggers.getById(rule.id)).toEqual(rule);
        } finally { manager.shutdownAll(); }
    });
});
