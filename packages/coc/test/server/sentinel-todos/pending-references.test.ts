/**
 * Reference-only links to targets without a saved conversation yet: queued
 * and running chat tasks, and Ralph sessions. Verification uses server state
 * (queue task ownership, the repo-scoped Ralph journal) with exact workspace
 * and server checks; attaching never executes, retries or changes status.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProcess } from '@plusplusoneplusplus/forge';
import type { DashboardDiscoveryRuntime } from '@plusplusoneplusplus/coc-client';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { createSentinelTodosTool } from '../../../src/server/llm-tools/sentinel-todos-tool';
import { RalphSessionStore } from '../../../src/server/ralph/ralph-session-store';
import { createTodoTestDatabase, createTodoTestDirectory } from './test-db';

const owner = { workspaceId: 'ws-a', processId: 'queue_parent' };
const SESSION = 'ralph-1792339116106-zgd0a6';

interface FakeTask {
    id: string; type: string; status: string; repoId?: string; displayName?: string;
    payload: { workspaceId?: string; prompt?: string; mode?: string; context?: { ralph?: { sessionId?: string; originalGoal?: string } } };
}

function chat(id: string, workspaceId: string, extra: Record<string, unknown> = {}): AIProcess {
    return { id, type: 'chat', status: 'running', startTime: new Date(), promptPreview: `prompt ${id}`,
        metadata: { workspaceId, mode: 'ask' }, ...extra } as unknown as AIProcess;
}

function task(id: string, extra: Partial<FakeTask> = {}): FakeTask {
    return { id, type: 'chat', status: 'queued', repoId: 'ws-a', displayName: `Task ${id}`,
        payload: { workspaceId: 'ws-a', prompt: `prompt ${id}`, mode: 'autopilot' }, ...extra };
}

function ralphTask(id: string, iteration: number, extra: Partial<FakeTask> = {}): FakeTask {
    return task(id, { displayName: 'Sentinel To-do Jobs',
        payload: { workspaceId: 'ws-a', mode: 'ralph', prompt: `iteration ${iteration}`,
            context: { ralph: { sessionId: SESSION, originalGoal: 'Ship to-do jobs' } } }, ...extra });
}

describe('Sentinel to-do references to pending jobs and Ralph sessions', () => {
    let database: ReturnType<typeof createTodoTestDatabase>;
    let todos: SentinelTodoStore;
    let service: SentinelTodoService;
    let onChange: ReturnType<typeof vi.fn>;
    const processes = new Map<string, AIProcess>();
    const tasks = new Map<string, FakeTask>();

    const build = (extra: Partial<ConstructorParameters<typeof SentinelTodoService>[0]> = {}) => new SentinelTodoService({
        todos, onChange, dataDir: database.dataDir,
        store: { getProcess: async (id: string) => processes.get(id) },
        getTask: (id => tasks.get(id)) as never,
        ...extra,
    });
    const item = () => todos.create(owner, { title: 'Jobs', completionCondition: 'Shipped', status: 'todo' }, { actor: 'user' }).item;
    const attach = (itemId: string, revision: number, processId: string, workspaceId = 'ws-a') =>
        service.attachReference(owner, itemId, revision, { processId, workspaceId }, 'sentinel');

    beforeEach(async () => {
        database = createTodoTestDatabase(createTodoTestDirectory());
        processes.clear();
        tasks.clear();
        processes.set(owner.processId, chat(owner.processId, 'ws-a', { metadata: { workspaceId: 'ws-a', mode: 'sentinel' } }));
        await new RalphSessionStore({ dataDir: database.dataDir }).initSession('ws-a', SESSION, { originalGoal: 'Ship to-do jobs', maxIterations: 5 });
        todos = new SentinelTodoStore(database.db);
        onChange = vi.fn();
        service = build();
    });
    afterEach(() => { database.dispose(); });

    it('accepts a queued chat task, keeps the link through execution start, and never touches status or jobs', async () => {
        tasks.set('t1', task('t1'));
        const target = item();
        const queued = await attach(target.id, target.revision, 'queue_t1');
        expect(queued.attached).toBe(true);
        expect(queued.item).toMatchObject({ status: 'todo', jobs: [] });
        expect(queued.item.references[0]).toMatchObject({
            processId: 'queue_t1', workspaceId: 'ws-a', title: 'Task t1', openLink: '#repos/ws-a/chats/queue_t1',
        });
        expect(queued.item.references[0]).not.toHaveProperty('sessionId');
        expect(tasks.get('t1')!.status).toBe('queued');
        // The executor persists the same `queue_` ID; re-attaching is the same reference.
        tasks.get('t1')!.status = 'running';
        expect((await attach(target.id, 1, 'queue_t1')).attached).toBe(false);
        tasks.delete('t1');
        processes.set('queue_t1', chat('queue_t1', 'ws-a'));
        expect((await attach(target.id, 1, 'queue_t1')).attached).toBe(false);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('accepts a running task before its process is saved', async () => {
        tasks.set('t2', task('t2', { status: 'running', displayName: undefined }));
        const target = item();
        const result = await attach(target.id, target.revision, 'queue_t2');
        expect(result.item.references[0]).toMatchObject({ processId: 'queue_t2', title: 'prompt t2' });
    });

    it('rejects cancelled, finished-unsaved, missing, non-chat and bare-ID tasks visibly without writing', async () => {
        tasks.set('cancelled', task('cancelled', { status: 'cancelled' }));
        tasks.set('done', task('done', { status: 'completed' }));
        tasks.set('script', task('script', { type: 'run-script' }));
        tasks.set('bare', task('bare'));
        const target = item();
        for (const id of ['queue_cancelled', 'queue_done', 'queue_missing', 'queue_script', 'bare']) {
            await expect(attach(target.id, target.revision, id)).rejects.toMatchObject({
                code: 'not_found', message: 'Conversation not found in that workspace',
            });
        }
        expect(todos.get(owner).items[0]).toEqual(target);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('requires the exact owning workspace from the queue task, never the caller', async () => {
        tasks.set('other-repo', task('other-repo', { repoId: 'ws-b', payload: { workspaceId: 'ws-b' } }));
        tasks.set('split', task('split', { payload: { workspaceId: 'ws-b' } }));
        tasks.set('no-repo', task('no-repo', { repoId: undefined }));
        const target = item();
        await expect(attach(target.id, 1, 'queue_other-repo', 'ws-a')).rejects.toMatchObject({ code: 'not_found' });
        await expect(attach(target.id, 1, 'queue_split', 'ws-a')).rejects.toMatchObject({ code: 'not_found' });
        await expect(attach(target.id, 1, 'queue_split', 'ws-b')).rejects.toMatchObject({ code: 'not_found' });
        await expect(attach(target.id, 1, 'queue_no-repo', 'ws-a')).rejects.toMatchObject({ code: 'not_found' });
        // A saved process in another workspace never falls back to a queue task or session.
        processes.set('queue_saved', chat('queue_saved', 'ws-b'));
        tasks.set('saved', task('saved'));
        await expect(attach(target.id, 1, 'queue_saved', 'ws-a')).rejects.toMatchObject({ code: 'not_found' });
        expect((await attach(target.id, 1, 'queue_other-repo', 'ws-b')).attached).toBe(true);
    });

    it('collapses Ralph iterations to their stable session reference and persists it', async () => {
        tasks.set('iter1', ralphTask('iter1', 1));
        const target = item();
        const first = await attach(target.id, target.revision, 'queue_iter1');
        expect(first.item.references[0]).toMatchObject({
            processId: 'queue_iter1', workspaceId: 'ws-a', sessionId: SESSION, title: 'Sentinel To-do Jobs',
            openLink: `#repos/ws-a/chats/ralph/${SESSION}`,
        });
        // Iteration 1 finished; iteration 2 is a different process of the same session.
        tasks.delete('iter1');
        processes.set('queue_iter1', chat('queue_iter1', 'ws-a', { metadata: { workspaceId: 'ws-a', mode: 'ralph', ralph: { sessionId: SESSION } } }));
        tasks.set('iter2', ralphTask('iter2', 2));
        expect((await attach(target.id, 1, 'queue_iter2')).attached).toBe(false);
        expect((await attach(target.id, 1, 'queue_iter1')).attached).toBe(false);
        expect((await attach(target.id, 1, SESSION)).attached).toBe(false);
        database.close();
        const reopened = createTodoTestDatabase(database.dataDir);
        try {
            expect(new SentinelTodoStore(reopened.db).get(owner).items[0].references).toEqual(first.item.references);
        } finally { reopened.close(); }
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('accepts a Ralph session ID directly only when its journal belongs to that workspace', async () => {
        const target = item();
        const result = await attach(target.id, target.revision, SESSION);
        expect(result.item.references[0]).toMatchObject({
            processId: SESSION, sessionId: SESSION, title: 'Ship to-do jobs', openLink: `#repos/ws-a/chats/ralph/${SESSION}`,
        });
        const other = item();
        await expect(attach(other.id, other.revision, SESSION, 'ws-b')).rejects.toMatchObject({ code: 'not_found' });
        await expect(attach(other.id, other.revision, 'ralph-missing')).rejects.toMatchObject({ code: 'not_found' });
        await expect(attach(other.id, other.revision, '../ws-a/ralph-sessions')).rejects.toMatchObject({ code: 'not_found' });
        // A journal copied under another workspace's directory does not prove ownership there.
        const sessions = new RalphSessionStore({ dataDir: database.dataDir });
        await sessions.initSession('ws-b', 'ralph-copied', { originalGoal: 'x', maxIterations: 1 });
        await sessions.updateSessionRecord('ws-b', 'ralph-copied', record => ({ ...record!, workspaceId: 'ws-a' }));
        await expect(attach(other.id, other.revision, 'ralph-copied', 'ws-b')).rejects.toMatchObject({ code: 'not_found' });
        // Without a data directory there is no journal to verify.
        service = build({ dataDir: undefined });
        await expect(attach(other.id, other.revision, SESSION)).rejects.toMatchObject({ code: 'not_found' });
    });

    it('keeps a plain process reference when the Ralph journal is unverifiable', async () => {
        tasks.set('grill', ralphTask('grill', 0, { payload: { workspaceId: 'ws-a', mode: 'ralph',
            context: { ralph: { sessionId: 'ralph-not-started' } } } }));
        const target = item();
        const result = await attach(target.id, target.revision, 'queue_grill');
        expect(result.item.references[0]).toMatchObject({ processId: 'queue_grill', openLink: '#repos/ws-a/chats/queue_grill' });
        expect(result.item.references[0]).not.toHaveProperty('sessionId');
    });

    it('keeps the manual-item restriction for pending targets', async () => {
        tasks.set('t1', task('t1'));
        const manual = todos.create(owner, { type: 'manual', title: 'Call vendor' }, { actor: 'user' }).item;
        await expect(attach(manual.id, manual.revision, 'queue_t1')).rejects.toMatchObject({ code: 'invalid' });
        await expect(attach(manual.id, manual.revision, SESSION)).rejects.toMatchObject({ code: 'invalid' });
    });

    it('routes dashboard targets by exact server identity, with no wrong-server fallback to the local queue', async () => {
        tasks.set('t1', task('t1'));
        const searchChats = vi.fn<DashboardDiscoveryRuntime['searchChats']>(async () => { throw new Error('offline'); });
        service = build({ serverIdentity: 'local-installation',
            getDashboardDiscovery: () => ({ listWorkspaces: vi.fn(), searchChats }) as never });
        const target = item();
        const dashboard = (serverIdentity: string, processId: string) => service.attachDashboardReference(owner, target.id, 1,
            { processId, target: { serverIdentity, workspaceId: 'ws-a' }, title: 'Task' }, 'sentinel');
        await expect(dashboard('remote-installation', 'queue_t1')).rejects.toMatchObject({ code: 'not_found' });
        await expect(dashboard('remote-installation', SESSION)).rejects.toMatchObject({ code: 'not_found' });
        expect(todos.get(owner).items[0].references).toEqual([]);
        const local = await dashboard('local-installation', 'queue_t1');
        expect(local.item.references[0]).toMatchObject({ processId: 'queue_t1', workspaceId: 'ws-a' });
        expect(searchChats).toHaveBeenCalledTimes(2);
    });

    it('attaches the repro shape through the sentinel_todos tool', async () => {
        tasks.set('1792339116113-0klj9kk', ralphTask('1792339116113-0klj9kk', 1));
        const target = item();
        const result = await (createSentinelTodosTool({ service, owner }).tool as any).handler({
            action: 'attach_reference', itemId: target.id, expectedRevision: target.revision,
            conversationId: 'queue_1792339116113-0klj9kk',
        }, {});
        expect(result).toMatchObject({ attached: true, item: { status: 'todo', jobs: [] } });
        expect(result.item.references[0]).toMatchObject({ sessionId: SESSION, attachedBy: 'sentinel' });
    });
});
