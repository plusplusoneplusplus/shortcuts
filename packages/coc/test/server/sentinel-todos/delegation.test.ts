import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProcess, CreateTaskInput, ProcessStore } from '@plusplusoneplusplus/forge';
import { SentinelTodoStore, type SentinelTodoItem } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import type { DelegatedJob } from '../../../src/server/delegation/delegated-job-store';
import { createSentinelTodoTracking } from '../../../src/server/llm-tools/sentinel-todos-tool';
import {
    createSendToConversationTool, type SendToConversationSuccess,
} from '../../../src/server/llm-tools/send-to-conversation-tool';
import { buildSendToConversationAddon } from '../../../src/server/executors/prompt-builder';

const owner = { workspaceId: 'ws-a', processId: 'queue_parent' };
const other = { workspaceId: 'ws-b', processId: 'queue_other' };
const invocation = { sessionId: 's', toolCallId: 'c', toolName: 'send_to_conversation', arguments: {} };

function sentinel(id: string, workspaceId: string): AIProcess {
    return {
        id, type: 'chat', status: 'completed', startTime: new Date(),
        metadata: { workspaceId, mode: 'sentinel', provider: 'copilot' },
    } as unknown as AIProcess;
}

function terminalJob(processId: string, outcome: 'completed' | 'failed' | 'cancelled' | 'capped', reason?: string,
    parent = owner): DelegatedJob {
    return {
        id: processId, title: 'Fix login', createdAt: new Date().toISOString(),
        parent, child: { workspaceId: 'ws-child', processId },
        terminal: {
            result: { terminalEventId: `${processId}:terminal`, outcome, summary: 'done', links: [], ...(reason ? { reason } : {}) },
            delivery: { state: 'pending' },
        },
    };
}

describe('Sentinel to-do job links', () => {
    let dataDir: string;
    let todos: SentinelTodoStore;
    let service: SentinelTodoService;
    let onChange: ReturnType<typeof vi.fn>;
    const processes = new Map<string, AIProcess>();

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-sentinel-todo-links-'));
        processes.clear();
        processes.set(owner.processId, sentinel(owner.processId, owner.workspaceId));
        processes.set(other.processId, sentinel(other.processId, other.workspaceId));
        todos = new SentinelTodoStore(dataDir);
        onChange = vi.fn();
        service = new SentinelTodoService({ todos, onChange, store: { getProcess: async (id: string) => processes.get(id) } });
    });
    afterEach(() => { fs.rmSync(dataDir, { recursive: true, force: true }); });

    async function createItem(at = owner): Promise<SentinelTodoItem> {
        return (await service.create(at, { title: 'Fix login', completionCondition: 'Login test passes' }, { actor: 'sentinel' })).item;
    }
    function link(itemId: string, processId: string, extra: Record<string, unknown> = {}, at = owner) {
        return service.linkJob(at, itemId, {
            processId, workspaceId: 'ws-child', kind: 'local', openLink: `#/process/${processId}`, ...extra,
        });
    }
    function current(itemId: string, at = owner): SentinelTodoItem {
        return todos.get(at).items.find(item => item.id === itemId)!;
    }

    it('links several jobs in different repos to one item and marks it in progress', async () => {
        const item = await createItem();
        await link(item.id, 'queue_a');
        const { item: linked } = await link(item.id, 'queue_b', { workspaceId: 'ws-other' });
        expect(linked.status).toBe('in_progress');
        expect(linked.jobs.map(job => [job.processId, job.workspaceId])).toEqual([['queue_a', 'ws-child'], ['queue_b', 'ws-other']]);
        expect(todos.get(owner).items).toHaveLength(1);
    });

    it('treats relinking the same job as a no-op without a change event', async () => {
        const item = await createItem();
        const first = await link(item.id, 'queue_a');
        onChange.mockClear();
        const again = await link(item.id, 'queue_a');
        expect(again.item.revision).toBe(first.item.revision);
        expect(again.item.jobs).toHaveLength(1);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('keeps items created before job links readable with an empty jobs list', async () => {
        const file = path.join(dataDir, 'repos', 'ws-a', 'sentinel-todos.json');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const now = new Date().toISOString();
        fs.writeFileSync(file, JSON.stringify({ version: 1, ledgers: { [owner.processId]: { revision: 1, items: [{
            id: 'old', title: 'Old', completionCondition: '', notes: '', status: 'todo', archived: false, revision: 1,
            createdAt: now, updatedAt: now, createdBy: 'user', updatedBy: 'user',
        }] } } }));
        expect(todos.get(owner).items[0].jobs).toEqual([]);
    });

    it('rejects linking from another chat even for the same item ID', async () => {
        const item = await createItem();
        await expect(link(item.id, 'queue_a', {}, other)).rejects.toMatchObject({ code: 'not_found' });
        await expect(service.linkJob({ workspaceId: 'ws-b', processId: owner.processId }, item.id, {
            processId: 'queue_x', workspaceId: 'ws-child', kind: 'local', openLink: '#',
        })).rejects.toMatchObject({ code: 'not_found' });
        expect(current(item.id).jobs).toEqual([]);
    });

    it('never marks an item done when a linked job completes', async () => {
        const item = await createItem();
        await link(item.id, 'queue_a');
        const recorded = service.recordJobResult(terminalJob('queue_a', 'completed'));
        expect(recorded?.status).toBe('in_progress');
        expect(recorded?.jobs[0].result).toMatchObject({ outcome: 'completed', terminalEventId: 'queue_a:terminal' });
        expect(recorded?.updatedBy).toBe('system');
    });

    it.each(['failed', 'cancelled', 'capped'] as const)('moves the item to needs attention when a job is %s', async outcome => {
        const item = await createItem();
        await link(item.id, 'queue_a');
        const recorded = service.recordJobResult(terminalJob('queue_a', outcome, 'Tests failed'));
        expect(recorded?.status).toBe('needs_attention');
        expect(recorded?.statusReason).toBe(`Job "Fix login" ${outcome}: Tests failed`);
    });

    it('ignores replayed terminal events', async () => {
        const item = await createItem();
        await link(item.id, 'queue_a');
        service.recordJobResult(terminalJob('queue_a', 'failed'));
        const revision = current(item.id).revision;
        onChange.mockClear();
        expect(service.recordJobResult(terminalJob('queue_a', 'failed'))).toBeUndefined();
        expect(service.recordJobResult(terminalJob('queue_a', 'completed'))).toBeUndefined();
        expect(current(item.id).revision).toBe(revision);
        expect(current(item.id).jobs[0].result?.outcome).toBe('failed');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('does not let a job outcome overwrite a newer user edit', async () => {
        const item = await createItem();
        const { item: linked } = await link(item.id, 'queue_a');
        await new Promise(resolve => setTimeout(resolve, 20));
        await service.update(owner, item.id, linked.revision, { status: 'todo' }, 'user');
        const recorded = service.recordJobResult(terminalJob('queue_a', 'failed', 'boom'));
        expect(recorded?.status).toBe('todo');
        expect(recorded?.jobs[0].result?.outcome).toBe('failed');
    });

    it('does not let a stale attempt override a newer completed attempt', async () => {
        const item = await createItem();
        await link(item.id, 'queue_old');
        await new Promise(resolve => setTimeout(resolve, 20));
        await link(item.id, 'queue_new');
        service.recordJobResult(terminalJob('queue_new', 'completed'));
        const recorded = service.recordJobResult(terminalJob('queue_old', 'failed', 'late'));
        expect(recorded?.status).toBe('in_progress');
        expect(recorded?.jobs.map(job => job.result?.outcome)).toEqual(['failed', 'completed']);
    });

    it('flags needs attention while another linked job stays active, retaining both links', async () => {
        const item = await createItem();
        await link(item.id, 'queue_a');
        await link(item.id, 'queue_b', { workspaceId: 'ws-other' });
        const recorded = service.recordJobResult(terminalJob('queue_a', 'failed', 'boom'));
        expect(recorded?.status).toBe('needs_attention');
        expect(recorded?.jobs.map(job => [job.processId, job.result?.outcome])).toEqual([['queue_a', 'failed'], ['queue_b', undefined]]);
        const back = await service.update(owner, item.id, recorded!.revision, { status: 'in_progress' }, 'sentinel');
        expect(back.item.status).toBe('in_progress');
    });

    it('leaves done and archived items unchanged by late failures', async () => {
        const done = await createItem();
        const { item: linked } = await link(done.id, 'queue_a');
        await service.update(owner, done.id, linked.revision, { status: 'done', statusReason: 'Verified', outcome: 'Verified' }, 'sentinel');
        expect(service.recordJobResult(terminalJob('queue_a', 'failed'))?.status).toBe('done');
    });

    it('records nothing for unlinked, remote, or foreign-parent jobs', async () => {
        const item = await createItem();
        await link(item.id, 'queue_remote', { serverId: 'srv-1', kind: 'remote' });
        expect(service.recordJobResult(terminalJob('queue_unlinked', 'failed'))).toBeUndefined();
        expect(service.recordJobResult({ ...terminalJob('queue_remote', 'failed'),
            child: { workspaceId: 'w', processId: 'queue_remote', serverId: 'srv-1' } })).toBeUndefined();
        expect(service.recordJobResult(terminalJob('queue_remote', 'failed', undefined, other))).toBeUndefined();
        expect(current(item.id).status).toBe('in_progress');
    });

    describe('send_to_conversation tracking', () => {
        function makeTool(opts: { bound?: typeof owner; enqueue?: (input: CreateTaskInput) => Promise<string>; tracking?: boolean } = {}) {
            const enqueueChat = vi.fn(opts.enqueue ?? (async () => 'task-1'));
            const launchRalph = vi.fn(async () => ({ ok: true as const, processId: 'queue_ralph', sessionId: 'ralph-1' }));
            const startRemoteChat = vi.fn(async () => ({ processId: 'queue_remote' }));
            const store = {
                getWorkspaces: async () => [{ id: 'ws-a', name: 'a', rootPath: '/a' }, { id: 'ws-child', name: 'child', rootPath: '/c' }],
                getProcess: async (id: string) => processes.get(id),
            } as unknown as ProcessStore;
            const directory = {
                list: vi.fn().mockResolvedValue({ entries: [], servers: [] }),
                isRemoteAutoProviderRoutingAvailable: vi.fn().mockResolvedValue(true),
                validateRemoteProvider: vi.fn(),
                startRemoteChat,
            };
            const bound = opts.bound ?? owner;
            const { tool } = createSendToConversationTool({
                store, workspaceId: bound.workspaceId, enqueueChat, launchRalph: launchRalph as any,
                parentProcessId: bound.processId,
                runtime: { workspaceDirectory: directory as any },
                ...(opts.tracking === false ? {} : { todoTracking: createSentinelTodoTracking({ service, owner: bound }) }),
            });
            const call = (args: Record<string, unknown>) => (tool as any).handler(args, invocation);
            return { tool, call, enqueueChat, launchRalph, startRemoteChat };
        }

        it('requires an existing, unarchived item before launching anything', async () => {
            const { call, enqueueChat } = makeTool();
            expect(await call({ content: 'go' })).toMatchObject({ code: 'untracked' });
            expect(await call({ content: 'go', todoItemId: 'missing' })).toMatchObject({ code: 'untracked' });
            const item = await createItem();
            await service.update(owner, item.id, item.revision, { archived: true }, 'user');
            expect((await call({ content: 'go', todoItemId: item.id })).error).toContain('archived');
            expect(enqueueChat).not.toHaveBeenCalled();
        });

        it('rejects another chat\'s item ID without launching', async () => {
            const foreign = await createItem(other);
            const { call, enqueueChat } = makeTool();
            expect(await call({ content: 'go', todoItemId: foreign.id })).toMatchObject({ code: 'untracked' });
            expect(enqueueChat).not.toHaveBeenCalled();
            expect(current(foreign.id, other).jobs).toEqual([]);
        });

        it('links an admitted local job and reports it as tracked', async () => {
            const item = await createItem();
            const { call, enqueueChat } = makeTool();
            const result = await call({ content: 'go', todoItemId: item.id, workspaceId: 'ws-child', title: 'Fix it' }) as SendToConversationSuccess;
            expect(enqueueChat).toHaveBeenCalledTimes(1);
            expect(result).toMatchObject({ processId: 'queue_task-1', tracking: { status: 'tracked', itemId: item.id } });
            expect(current(item.id)).toMatchObject({
                status: 'in_progress',
                jobs: [{ processId: 'queue_task-1', workspaceId: 'ws-child', kind: 'local', title: 'Fix it', openLink: '#/process/queue_task-1' }],
            });
        });

        it('links a Ralph launch as one whole-session job', async () => {
            const item = await createItem();
            const { call, launchRalph } = makeTool();
            const result = await call({ content: 'goal', mode: 'ralph', todoItemId: item.id });
            expect(launchRalph).toHaveBeenCalledTimes(1);
            expect(result.tracking.status).toBe('tracked');
            expect(current(item.id).jobs).toEqual([
                expect.objectContaining({ processId: 'queue_ralph', kind: 'ralph', sessionId: 'ralph-1', workspaceId: 'ws-a' }),
            ]);
            const ledger = await service.list(owner);
            expect(ledger.items[0].jobs[0].execution).toEqual({ state: 'running' });
        });

        it('links a remote job with its server routing only after admission', async () => {
            const item = await createItem();
            const { call, startRemoteChat } = makeTool();
            const result = await call({ content: 'go', workspaceId: 'remote:srv-1:w-api', todoItemId: item.id });
            expect(startRemoteChat).toHaveBeenCalledTimes(1);
            expect(result.tracking.status).toBe('tracked');
            const job = current(item.id).jobs[0];
            expect(job).toMatchObject({ processId: 'queue_remote', workspaceId: 'w-api', serverId: 'srv-1', kind: 'remote' });
            expect(job.openLink).toBe(`#repos/${encodeURIComponent('remote:srv-1:w-api')}/chats/queue_remote`);
            expect((await service.list(owner)).items[0].jobs[0].execution).toEqual({ state: 'unavailable' });
        });

        it('stores no link when remote admission fails', async () => {
            const item = await createItem();
            const { call, startRemoteChat } = makeTool();
            startRemoteChat.mockRejectedValueOnce(new Error('offline'));
            expect((await call({ content: 'go', workspaceId: 'remote:srv-1:w-api', todoItemId: item.id })).error).toBeDefined();
            expect(current(item.id).jobs).toEqual([]);
        });

        it('reports a failed link without relaunching the admitted job', async () => {
            const item = await createItem();
            const { call, enqueueChat } = makeTool();
            vi.spyOn(service, 'linkJob').mockRejectedValueOnce(new Error('disk full'));
            const result = await call({ content: 'go', todoItemId: item.id });
            expect(result).toMatchObject({ processId: 'queue_task-1', tracking: { status: 'failed', error: 'disk full' } });
            expect(enqueueChat).toHaveBeenCalledTimes(1);
        });

        it('leaves post and cancel modes untouched', async () => {
            const { call, enqueueChat } = makeTool();
            const cancel = await call({ action: 'cancel', processId: 'queue_x', todoItemId: 'item' });
            expect(cancel.error).toContain('send-only');
            expect(enqueueChat).not.toHaveBeenCalled();
        });

        it('adds the todoItemId parameter only when tracking is wired', () => {
            const tracked = makeTool().tool;
            expect(Object.keys((tracked as any).parameters.properties)).toContain('todoItemId');
            expect(tracked.description).toContain('Reuse the same feature/outcome item across grilling, implementation, and review');
            expect(tracked.description).toContain('Do not launch implementation without user authorization');
            const plain = makeTool({ tracking: false }).tool as any;
            expect(Object.keys(plain.parameters.properties)).not.toContain('todoItemId');
            expect(plain.description).not.toContain('todoItemId');
            expect(plain.description).not.toContain('Reuse the same feature/outcome item');
        });

        it('launches untracked when the addon gets no Sentinel to-do deps (flag off)', async () => {
            const store = { getProcess: async (id: string) => processes.get(id), getWorkspaces: async () => [{ id: 'ws-a' }] } as any;
            const enqueue = vi.fn(async () => 'task-9');
            const off = buildSendToConversationAddon(store, 'ws-a', enqueue, owner.processId);
            const offTool = off.tools.find(tool => tool.name === 'send_to_conversation') as any;
            const result = await offTool.handler({ content: 'go' }, invocation);
            expect(result).toEqual({ processId: 'queue_task-9', openLink: '#/process/queue_task-9' });

            const on = buildSendToConversationAddon(store, 'ws-a', enqueue, owner.processId,
                undefined, undefined, undefined, { service, owner });
            const onTool = on.tools.find(tool => tool.name === 'send_to_conversation') as any;
            expect((await onTool.handler({ content: 'go' }, invocation)).code).toBe('untracked');
        });
    });
});
