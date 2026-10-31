import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboundWAMessage } from '@plusplusoneplusplus/coc-connector/whatsapp';
import { WhatsAppBindings } from '../../../src/server/messaging/whatsapp-bindings';
import { WhatsAppCommandRouter, type WhatsAppRouterDeps } from '../../../src/server/messaging/whatsapp-command-router';
import { whatsappOverturesReply } from '../../../src/server/messaging/whatsapp-overtures';
import { TriggerStore } from '../../../src/server/triggers/trigger-store';
import type { Trigger } from '../../../src/server/triggers/trigger-types';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { createTodoTestDatabase, createTodoTestDirectory } from '../sentinel-todos/test-db';

const workspaces = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }];
const inbound = (text = 'list topics', patch: Partial<InboundWAMessage> = {}): InboundWAMessage => ({
    chatJid: 'group@g.us', senderJid: 'group@g.us', fromMe: true, messageId: 'in', text, ...patch,
});
const rule = (id: string, patch: Partial<Trigger> = {}): Trigger => ({
    id, workspaceId: 'a', processId: 'same-chat', status: 'active',
    event: { type: 'condition-monitor', monitor: 'pr-merged', pollIntervalMs: 300_000, consecutiveErrors: 0,
        pr: { provider: 'github', host: 'github.com', repoPath: 'org/repo', number: 42, url: 'https://github.com/org/repo/pull/42' },
        lastSeenTitle: 'Ship the fix' },
    action: { type: 'send-message', processId: 'same-chat', prompt: 'PRIVATE ACTION PROMPT', mode: 'inherit' },
    inFlight: false, createdAt: '2026-10-01T00:00:00Z', expiresAt: null, lastTickAt: null, nextTickAt: null, revision: 1,
    ...patch,
});

describe('WhatsApp topic overtures', () => {
    let database: ReturnType<typeof createTodoTestDatabase>;
    let triggers: TriggerStore;
    let todos: SentinelTodoStore;
    let bindings: WhatsAppBindings;
    let store: WhatsAppRouterDeps['store'];
    let send: ReturnType<typeof vi.fn>;
    let enqueue: ReturnType<typeof vi.fn>;
    let getOvertures: ReturnType<typeof vi.fn>;
    let router: WhatsAppCommandRouter;
    beforeEach(async () => {
        database = createTodoTestDatabase(createTodoTestDirectory());
        triggers = new TriggerStore(database.db);
        todos = new SentinelTodoStore(database.db);
        bindings = new WhatsAppBindings(database.dataDir);
        const processes = workspaces.map(ws => ({
            id: 'same-chat', title: `${ws.name} chat`, startTime: new Date(), status: 'running',
            metadata: { workspaceId: ws.id, mode: 'sentinel' },
        }));
        store = {
            getWorkspaces: vi.fn().mockResolvedValue(workspaces),
            getAllProcesses: vi.fn().mockResolvedValue(processes),
            getProcess: vi.fn(async (id, workspaceId) => processes.find(p => p.id === id && p.metadata.workspaceId === workspaceId)),
        } as unknown as WhatsAppRouterDeps['store'];
        await bindings.restore(store);
        bindings.selectRepo('a');
        bindings.selectTopic('a', 'same-chat');
        send = vi.fn(async () => 'out');
        enqueue = vi.fn();
        getOvertures = vi.fn(() => triggers);
        router = new WhatsAppCommandRouter({
            store, bindings, send, enqueue, react: vi.fn(), groupJid: () => 'group@g.us', getTask: () => undefined,
            getOvertures, getOvertureTodos: () => todos,
        });
    });
    afterEach(() => { router.dispose(); database.dispose(); });

    it('displays saved PR/date/CI names and states across exact local owners, without any database writes', async () => {
        const item = todos.create({ workspaceId: 'b', processId: 'same-chat' }, { title: 'Release package' }, { actor: 'user' }).item;
        const binding = { kind: 'sentinel-todo' as const, itemId: item.id, armedBy: 'user' as const,
            armedAt: '2026-10-01T00:00:00Z', instruction: 'PRIVATE INSTRUCTION' };
        triggers.insert(rule('merge', { event: { ...rule('x').event, lastError: { message: 'PRIVATE ERROR', at: 'now' } } as Trigger['event'] }));
        triggers.insert(rule('date', { workspaceId: 'b', binding, status: 'paused',
            event: { type: 'date-time', firesAt: '2026-11-01T09:00:00Z', timeZone: 'UTC' } }));
        triggers.insert(rule('ci', { event: { type: 'condition-monitor', monitor: 'ci-failure', originId: 'origin',
            prId: '77', pollIntervalMs: 60_000, lastSeenChecks: {} }, inFlight: true }));
        triggers.insert(rule('pending', { status: 'disarmed', outcome: 'fired',
            delivery: { deliveryId: 'd', firedAt: 'now', reason: 'merged', state: 'pending' } }));
        triggers.insert(rule('secret', { workspaceId: 'not-registered' }));
        const before = triggers.getAll();
        database.db.pragma('query_only = ON');
        await router.handle(inbound());
        const text = send.mock.calls[0][0];
        expect(text).toContain('*Overtures · all local repos*');
        expect(text).toContain('Alpha · Alpha chat');
        expect(text).toContain('Beta · Beta chat · Release package');
        expect(text).toContain('PR merged · org/repo #42 · Ship the fix · active · read error; retrying');
        expect(text).toContain('Nov 1, 2026');
        expect(text).toContain('(UTC) · paused');
        expect(text).toContain('CI failure · PR #77 · active · in progress');
        expect(text).toContain('fired · delivery pending');
        expect(text).not.toMatch(/PRIVATE|not-registered|secret/);
        expect(triggers.getAll()).toEqual(before);
        expect(store.getProcess).toHaveBeenCalledWith('same-chat', 'b');
        expect(bindings.selectedRepo).toBe('a');
        expect(bindings.topic('a')).toBe('same-chat');
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('keeps overtures outside numeric selection and includes them even when no recent topics exist', async () => {
        triggers.insert(rule('old-overture'));
        vi.mocked(store.getAllProcesses).mockResolvedValueOnce([]);
        await router.handle(inbound());
        expect(send.mock.calls[0][0]).toContain('No chat topics created in the last24hours.');
        expect(send.mock.calls[0][0]).toContain('PR merged');
        await router.handle(inbound('select topic 1', { messageId: 'select' }));
        expect(send).toHaveBeenLastCalledWith(expect.stringContaining('Topic not found'), 'select');
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('preserves the displayed owner-qualified topic numbering after overtures are added', async () => {
        triggers.insert(rule('trigger_new'));
        await router.handle(inbound('list topics -v'));
        const text = send.mock.calls[0][0];
        expect(text).toContain('a/trigger_new');
        expect(text).toContain('a/same-chat');
        vi.mocked(store.getAllProcesses).mockResolvedValue([]);
        await router.handle(inbound('select topic 2', { messageId: 'select' }));
        expect(bindings.selectedRepo).toBe('b');
        expect(bindings.topic('b')).toBe('same-chat');
    });

    it('distinguishes empty, missing infrastructure and partial read failures without leaking errors', async () => {
        expect(await whatsappOverturesReply(workspaces, triggers, store)).toContain('No overtures.');
        const missing = await whatsappOverturesReply(workspaces, undefined, store);
        expect(missing).toContain('Data unavailable.');
        expect(missing).not.toContain('No overtures.');
        const reader = { getByWorkspace: vi.fn((id: string) => {
            if (id === 'a') throw new Error('https://private-host/token');
            return [rule('beta', { workspaceId: 'b' }), rule('wrong-owner', { workspaceId: 'a' })];
        }) };
        const partial = await whatsappOverturesReply(workspaces, reader, store, undefined, true);
        expect(partial).toContain('Beta · Beta chat');
        expect(partial).toContain('Data unavailable: Alpha.');
        expect(partial).not.toMatch(/private-host|wrong-owner|No overtures/);
        expect(reader.getByWorkspace.mock.calls).toEqual([['a'], ['b']]);
    });

    it('hides removed, delivered and delegated bound rules and rejects mismatched action ownership', async () => {
        const binding = { kind: 'sentinel-todo' as const, itemId: 'item', armedBy: 'user' as const, armedAt: 'now' };
        triggers.insert(rule('removed', { binding: { ...binding, removedAt: 'now' } }));
        triggers.insert(rule('delegated', { binding: { ...binding, delegatedPr: { jobId: 'j', receiptId: 'r' } } }));
        triggers.insert(rule('delivered', { binding, status: 'disarmed', outcome: 'fired',
            delivery: { deliveryId: 'd', firedAt: 'now', reason: 'merged', state: 'delivered' } }));
        triggers.insert(rule('wrong', { action: { ...rule('x').action, processId: 'other' } }));
        expect(await whatsappOverturesReply(workspaces, triggers, store)).toContain('No overtures.');
    });

    it('caps long multiline names, retains Unicode, and reports overflow with no prompts or instructions', async () => {
        vi.mocked(store.getProcess).mockResolvedValue({ id: 'same-chat', title: '*Long*\n' + '😀'.repeat(150), metadata: { workspaceId: 'a' } } as never);
        for (let i = 0; i < 8; i++) triggers.insert(rule(`rule-${i}`));
        const text = await whatsappOverturesReply(workspaces, triggers, store);
        expect(text.match(/^• /gm)).toHaveLength(5);
        expect(text).toContain('…3 more in CoC.');
        expect(text).toContain('Long 😀');
        expect(text).not.toMatch(/\*Long\*|PRIVATE|\uFFFD/);
        expect(text.length).toBeLessThan(1600);
    });

    it('does not borrow names from a different owner and tolerates unavailable owner data', async () => {
        triggers.insert(rule('owner'));
        for (const process of [
            { id: 'same-chat', title: 'PRIVATE OTHER WORKSPACE', metadata: { workspaceId: 'b' } },
            { id: 'different-chat', title: 'PRIVATE OTHER CHAT', metadata: { workspaceId: 'a' } },
        ]) {
            vi.mocked(store.getProcess).mockResolvedValue(process as never);
            const text = await whatsappOverturesReply(workspaces, triggers, store);
            expect(text).toContain('Alpha · Chat unavailable');
            expect(text).not.toContain('PRIVATE');
        }
        vi.mocked(store.getProcess).mockRejectedValue(new Error('PRIVATE STORE ERROR'));
        const text = await whatsappOverturesReply(workspaces, triggers, store);
        expect(text).toContain('Chat unavailable');
        expect(text).toContain('PR merged');
        expect(text).not.toContain('PRIVATE');
    });

    it('suppresses late display replies when the connection is reset during the read', async () => {
        triggers.insert(rule('late'));
        let release!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        vi.mocked(store.getProcess).mockImplementation(async () => {
            await pending;
            return undefined;
        });
        const handling = router.handle(inbound());
        await vi.waitFor(() => expect(getOvertures).toHaveBeenCalled());
        router.resetPendingImages();
        release();
        await handling;
        expect(send).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('chunks verbose topic replies and records all parts without changing selection', async () => {
        const id = 'trigger_' + 'x'.repeat(4200);
        triggers.insert(rule(id));
        send.mockImplementation(async () => `out-${send.mock.calls.length}`);
        await router.handle(inbound('list topics -v'));
        expect(send.mock.calls.length).toBeGreaterThan(1);
        expect(send.mock.calls.every(([text, quoted]) => text.length <= 4096 && quoted === 'in')).toBe(true);
        expect(send.mock.calls.map(([text]) => text).join('')).toContain(`a/${id}`);
        for (let i = 1; i <= send.mock.calls.length; i++) expect(bindings.isKnownMessage(`out-${i}`)).toBe(true);
        expect(bindings.selectedRepo).toBe('a');
        expect(bindings.topic('a')).toBe('same-chat');
        expect(enqueue).not.toHaveBeenCalled();
    });

    it.each([
        { fromMe: false }, { chatJid: 'other@g.us' }, { messageId: '' },
    ])('does not read trigger data for unauthorized input %j', async patch => {
        await router.handle(inbound('list topics', patch));
        expect(getOvertures).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    it('never substitutes local data for a remote browse, including identical workspace IDs and empty lists', async () => {
        router.dispose();
        const remotes = {
            list: vi.fn().mockResolvedValue({
                entries: [{ id: 'remote:remote-server:a', name: 'RemoteAlpha', type: 'repo', server: 'Away', online: true }],
                servers: [{ serverId: 'remote-server', server: 'Away', online: true }],
            }), listRemoteChats: vi.fn().mockResolvedValue([]),
        };
        router = new WhatsAppCommandRouter({ store, bindings, send, enqueue, react: vi.fn(), groupJid: () => 'group@g.us',
            getTask: () => undefined, getOvertures, remotes: remotes as never });
        await router.handle(inbound('list topics RemoteAlpha@Away'));
        expect(remotes.listRemoteChats).toHaveBeenCalledWith('remote-server', 'a', 10);
        expect(send.mock.calls[0][0]).toContain('Unavailable from this remote server.');
        expect(send.mock.calls[0][0]).not.toContain('No overtures.');
        expect(getOvertures).not.toHaveBeenCalled();
        expect(store.getProcess).not.toHaveBeenCalled();
        expect(bindings.selectedRepo).toBe('a');
        expect(enqueue).not.toHaveBeenCalled();
    });
});
