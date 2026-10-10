import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskQueueManager } from '@plusplusoneplusplus/forge';
import type { InboundWAMessage } from '@plusplusoneplusplus/coc-connector/whatsapp';
import { WhatsAppBindings } from '../../../src/server/messaging/whatsapp-bindings';
import { WhatsAppCommandRouter, type WhatsAppRouterDeps } from '../../../src/server/messaging/whatsapp-command-router';
import { formatTodosReply, TODOS_DISABLED_REPLY, TODOS_NO_TARGET_REPLY } from '../../../src/server/messaging/messaging-todos';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';

const GLOBAL = 'global-workspace-00';

describe('WhatsApp list todos', () => {
    let dir: string;
    let bindings: WhatsAppBindings;
    let todos: SentinelTodoStore;
    let service: SentinelTodoService;
    let enqueue: ReturnType<typeof vi.fn>;
    let send: ReturnType<typeof vi.fn>;
    let react: ReturnType<typeof vi.fn>;
    let store: WhatsAppRouterDeps['store'];
    let router: WhatsAppCommandRouter;
    let enabled: boolean;
    const workspaces = [{ id: 'ws-a', name: 'Alpha' }, { id: 'ws-b', name: 'Beta' }, { id: GLOBAL, name: 'Global' }];
    const startTime = new Date(Date.now() - 1000);
    const processes = [
        { id: 'sent-a', title: 'Plan A', startTime, metadata: { workspaceId: 'ws-a', mode: 'sentinel' } },
        { id: 'sent-b', title: 'Plan B', startTime, metadata: { workspaceId: 'ws-b', mode: 'sentinel' } },
        { id: 'chat-a', title: 'Plain A', startTime, metadata: { workspaceId: 'ws-a', mode: 'ask' } },
    ];
    const inbound = (text: string, id: string, patch: Partial<InboundWAMessage> = {}): InboundWAMessage => ({
        chatJid: 'group@g.us', senderJid: 'group@g.us', participantJid: 'self@s.whatsapp.net',
        fromMe: true, messageId: id, text, ...patch,
    });
    const quoteBinding = (workspaceId: string, processId: string, outboundId: string) => bindings.add({
        groupJid: 'group@g.us', workspaceId, processId, taskId: `t-${outboundId}`, inboundId: `in-${outboundId}`,
        outboundIds: [outboundId], nextPart: 1, status: 'delivered',
    });
    const ledgerFile = () => path.join(dir, 'repos', 'ws-a', 'sentinel-todos.json');

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-todos-'));
        bindings = new WhatsAppBindings(dir);
        store = {
            getWorkspaces: vi.fn().mockResolvedValue(workspaces),
            getAllProcesses: vi.fn(async ({ workspaceId }: { workspaceId?: string }) =>
                processes.filter(proc => !workspaceId || proc.metadata.workspaceId === workspaceId)),
            getProcess: vi.fn(async (id: string, workspaceId?: string) =>
                processes.find(proc => proc.id === id && (!workspaceId || proc.metadata.workspaceId === workspaceId))),
            updateProcess: vi.fn(),
        } as unknown as WhatsAppRouterDeps['store'];
        await bindings.restore(store);
        todos = new SentinelTodoStore(dir);
        service = new SentinelTodoService({ todos, store: store as never });
        enabled = true;
        const queue = new TaskQueueManager();
        enqueue = vi.fn();
        send = vi.fn(async (_text: string, quoted: string) => `out-${quoted}-${send.mock.calls.length}`);
        react = vi.fn().mockResolvedValue(undefined);
        router = new WhatsAppCommandRouter({
            store, bindings, groupJid: () => 'group@g.us', enqueue, send, react,
            getTask: id => queue.getTask(id), getTodos: () => enabled ? service : undefined,
        });
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    function seedLedger() {
        const owner = { workspaceId: 'ws-a', processId: 'sent-a' };
        const create = (title: string, extra = {}) => todos.create(owner, { title, ...extra }, { actor: 'user' }).item;
        create('Write release notes');
        create('Fix flaky test', { status: 'needs_attention', statusReason: 'CI red on macOS' });
        create('Ship v2', { priority: 'high', status: 'in_progress' });
        const done = create('Old done');
        todos.update(owner, done.id, done.revision, { status: 'done' }, 'user');
        const archived = create('Archived item');
        todos.update(owner, archived.id, archived.revision, { archived: true }, 'user');
        create('Call the vendor', { type: 'manual' });
        create('Manual finished', { type: 'manual', status: 'done' });
        return owner;
    }

    it('lists the selected Sentinel topic\'s unfinished items, grouping manual tracking, read-only', async () => {
        seedLedger();
        bindings.selectRepo('ws-a');
        bindings.selectTopic('ws-a', 'sent-a');
        const before = fs.readFileSync(ledgerFile(), 'utf8');
        await router.handle(inbound('list todos', 'todos'));
        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith([
            '📋 To-do · "Plan A" — 4 not done',
            '1. [Needs attention] Fix flaky test',
            '   ↳ CI red on macOS',
            '2. [In progress · High] Ship v2',
            '3. [To do] Write release notes',
            '',
            'Manual tracking (tracked only, never run):',
            '4. [To do] Call the vendor',
        ].join('\n'), 'todos');
        // No ledger write, AI admission, selection change; replies are guarded own messages.
        expect(fs.readFileSync(ledgerFile(), 'utf8')).toBe(before);
        expect(enqueue).not.toHaveBeenCalled();
        expect(bindings.selectedRepo).toBe('ws-a');
        expect(bindings.topic('ws-a')).toBe('sent-a');
        expect(react).toHaveBeenCalledWith('todos');
        expect(bindings.isKnownMessage('todos')).toBe(true);
        expect(bindings.isKnownMessage('out-todos-1')).toBe(true);
        await router.handle(inbound('list todos', 'todos'));
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('prefers the quoted chat over the selected topic and keeps the selection', async () => {
        seedLedger();
        bindings.selectRepo('ws-b');
        bindings.selectTopic('ws-b', 'sent-b');
        quoteBinding('ws-a', 'sent-a', 'answer-a');
        await router.handle(inbound('/todo', 'quoted', { quotedMessageId: 'answer-a' }));
        expect(send).toHaveBeenLastCalledWith(expect.stringContaining('"Plan A" — 4 not done'), 'quoted');
        await router.handle(inbound('todos', 'selected'));
        expect(send).toHaveBeenLastCalledWith('📋 To-do · "Plan B"\nNo unfinished items.', 'selected');
        // An unknown quote falls back to the selected topic.
        await router.handle(inbound('list todos', 'unknown-quote', { quotedMessageId: 'nope' }));
        expect(send).toHaveBeenLastCalledWith(expect.stringContaining('"Plan B"'), 'unknown-quote');
        expect(bindings.selectedRepo).toBe('ws-b');
        expect(bindings.topic('ws-b')).toBe('sent-b');
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('answers truthfully with no target, a non-Sentinel chat, the ledger off, or a foreign repo', async () => {
        seedLedger();
        await router.handle(inbound('list todos', 'none'));
        expect(send).toHaveBeenLastCalledWith(TODOS_NO_TARGET_REPLY, 'none');
        bindings.selectRepo('ws-a');
        await router.handle(inbound('list todos', 'repo-only'));
        expect(send).toHaveBeenLastCalledWith(TODOS_NO_TARGET_REPLY, 'repo-only');
        bindings.selectTopic('ws-a', 'chat-a');
        await router.handle(inbound('list todos', 'plain'));
        expect(send).toHaveBeenLastCalledWith(expect.stringContaining('not a Sentinel chat'), 'plain');
        // A selected topic id from another repo never reads that repo's ledger.
        bindings.selectTopic('ws-a', 'sent-b');
        await router.handle(inbound('list todos', 'cross'));
        expect(send).toHaveBeenLastCalledWith(expect.stringContaining('not a Sentinel chat'), 'cross');
        quoteBinding('ws-gone', 'sent-x', 'answer-x');
        await router.handle(inbound('list todos', 'foreign', { quotedMessageId: 'answer-x' }));
        expect(send).toHaveBeenLastCalledWith('❌ That chat\'s repo is not on this server. Select a local topic.', 'foreign');
        enabled = false;
        bindings.selectTopic('ws-a', 'sent-a');
        await router.handle(inbound('list todos', 'off'));
        expect(send).toHaveBeenLastCalledWith(TODOS_DISABLED_REPLY, 'off');
        expect(enqueue).not.toHaveBeenCalled();
        expect(bindings.topic('ws-a')).toBe('sent-a');
    });

    it('chunks long lists and counts items past the bound instead of dropping them', async () => {
        const owner = { workspaceId: 'ws-a', processId: 'sent-a' };
        for (let i = 0; i < 105; i++) todos.create(owner, { title: `Item ${i} ${'x'.repeat(150)}` }, { actor: 'user' });
        todos.create(owner, { title: 'Manual tail', type: 'manual' }, { actor: 'user' });
        bindings.selectRepo('ws-a');
        bindings.selectTopic('ws-a', 'sent-a');
        await router.handle(inbound('list todos', 'long'));
        const parts = send.mock.calls.map(call => call[0] as string);
        expect(parts.length).toBeGreaterThan(1);
        for (const part of parts) expect(part.length).toBeLessThanOrEqual(4096);
        const text = parts.join('');
        expect(text).toContain('— 106 not done');
        expect(text).toContain('100. [To do] Item 99 ');
        expect(text).not.toContain('Item 100 ');
        expect(text).toContain('…6 more not shown.');
        for (let i = 1; i <= parts.length; i++) expect(bindings.isKnownMessage(`out-long-${i}`)).toBe(true);
    });

    it('formats derived In review and running job state from the shared read model', () => {
        const base = {
            type: 'normal' as const, completionCondition: '', notes: '', priority: 'regular' as const, archived: false,
            revision: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
            createdBy: 'user' as const, updatedBy: 'user' as const,
        };
        const job = (execution: object) => ({ processId: 'j', workspaceId: 'ws-a', kind: 'local' as const,
            openLink: 'x', linkedAt: '2026-01-01T00:00:00.000Z', execution } as never);
        const text = formatTodosReply('S', [
            { ...base, id: 'a', title: 'Reviewed soon', status: 'in_progress', jobs: [job({ state: 'completed',
                review: { state: 'delivered', assessment: 'pending', terminalEventId: 'e' } })] },
            { ...base, id: 'b', title: 'Working', status: 'in_progress', jobs: [job({ state: 'running' })] },
            { ...base, id: 'c', title: 'Waiting', status: 'todo', jobs: [job({ state: 'queued' })] },
        ]);
        expect(text).toBe([
            '📋 To-do · "S" — 3 not done',
            '1. [In review] Reviewed soon',
            '2. [In progress · job running] Working',
            '3. [To do · job queued] Waiting',
        ].join('\n'));
    });

    it('leaves ordinary commands and chat routing unchanged', async () => {
        await router.handle(inbound('help', 'help'));
        expect(send).toHaveBeenLastCalledWith(expect.stringContaining('list todos\n'), 'help');
        await router.handle(inbound('list topics', 'topics'));
        expect(send).toHaveBeenLastCalledWith(expect.stringContaining('Plan A'), 'topics');
        await router.handle(inbound('list todos please', 'bad'));
        expect(send).toHaveBeenLastCalledWith(expect.stringMatching(/^Unknown command/), 'bad');
        expect(enqueue).not.toHaveBeenCalled();
    });
});
