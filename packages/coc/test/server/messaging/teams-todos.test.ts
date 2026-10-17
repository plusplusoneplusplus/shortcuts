import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboundTeamsMessage } from '@plusplusoneplusplus/coc-connector/teams';
import { TeamsCommandRouter, type TeamsCommandRouterDeps } from '../../../src/server/messaging/teams-command-router';
import { formatTeamsOutbound } from '../../../src/server/messaging/teams-outbound-format';
import { TODOS_NO_TARGET_REPLY, TODOS_UNAVAILABLE_REPLY } from '../../../src/server/messaging/messaging-todos';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { createTodoTestDatabase, createTodoTestDirectory } from '../sentinel-todos/test-db';

describe('Teams list todos', () => {
    let database: ReturnType<typeof createTodoTestDatabase>;
    let todos: SentinelTodoStore;
    let service: SentinelTodoService;
    let deps: TeamsCommandRouterDeps;
    let router: TeamsCommandRouter;
    let sendReply: ReturnType<typeof vi.fn>;
    let available: boolean;
    const startTime = new Date(Date.now() - 1000);
    const processes = [
        { id: 'sent-a', status: 'completed', title: 'Plan *A*', startTime, metadata: { workspaceId: 'ws-a', mode: 'sentinel' } },
        { id: 'sent-b', status: 'completed', title: 'Plan B', startTime, metadata: { workspaceId: 'ws-b', mode: 'sentinel' } },
        { id: 'chat-a', status: 'completed', title: 'Plain A', startTime, metadata: { workspaceId: 'ws-a', mode: 'ask' } },
    ];
    const ownerA = { workspaceId: 'ws-a', processId: 'sent-a' };
    const ownerB = { workspaceId: 'ws-b', processId: 'sent-b' };
    let seq = 0;
    const msg = (text: string, overrides: Partial<InboundTeamsMessage> = {}): InboundTeamsMessage => ({
        channelId: 'ch-1', messageId: `m-${++seq}`, text, senderAadId: 'user-1', senderName: 'User One', ...overrides,
    });
    const create = (owner: typeof ownerA, title: string, extra = {}) =>
        todos.create(owner, { title, ...extra }, { actor: 'user' }).item;
    const replies = () => sendReply.mock.calls.map(call => call[0] as string);
    const noTurnStarted = () => {
        expect(deps.enqueueChat).not.toHaveBeenCalled();
        expect(deps.executeFollowUp).not.toHaveBeenCalled();
    };

    beforeEach(() => {
        database = createTodoTestDatabase(createTodoTestDirectory());
        sendReply = vi.fn().mockResolvedValue(undefined);
        const store = {
            getWorkspaces: vi.fn().mockResolvedValue([{ id: 'ws-a', name: 'Alpha' }, { id: 'ws-b', name: 'Beta' }]),
            getAllProcesses: vi.fn(async ({ workspaceId }: { workspaceId?: string } = {}) =>
                processes.filter(proc => !workspaceId || proc.metadata.workspaceId === workspaceId)),
            getProcess: vi.fn(async (id: string, workspaceId?: string) =>
                processes.find(proc => proc.id === id && (!workspaceId || proc.metadata.workspaceId === workspaceId))),
        };
        todos = new SentinelTodoStore(database.db);
        service = new SentinelTodoService({ todos, store: store as never });
        available = true;
        deps = {
            store: store as never,
            enqueueChat: vi.fn().mockResolvedValue('task-new'),
            executeFollowUp: vi.fn().mockResolvedValue(undefined),
            sendReply,
            dataDir: database.dataDir,
            getTodos: () => available ? service : undefined,
        };
        router = new TeamsCommandRouter(deps);
    });
    afterEach(() => {
        router.stop();
        database.dispose();
    });

    it('lists every active item and only the five most recent Done items of the selected topic, read-only', async () => {
        create(ownerA, 'Write release notes');
        create(ownerA, 'Fix *flaky* test', { status: 'needs_attention', statusReason: 'CI red on `macOS`' });
        create(ownerA, 'Call the vendor', { type: 'manual' });
        for (let i = 0; i < 8; i++) create(ownerA, `Finished ${i}`, { status: 'done', ...(i === 6 ? { type: 'manual' } : {}) });
        const archived = create(ownerA, 'Archived done', { status: 'done' });
        todos.update(ownerA, archived.id, archived.revision, { archived: true }, 'user');
        await router.handle(msg('/select topic sent-a'));
        const before = todos.get(ownerA);
        database.db.pragma('query_only = ON');
        const command = msg('list todos');
        await router.handle(command);
        expect(sendReply).toHaveBeenLastCalledWith([
            '📋 To-do · "Plan \\*A\\*" — 3 not done',
            '1. [Needs attention] Fix \\*flaky\\* test',
            '   ↳ CI red on \\`macOS\\`',
            '2. [To do] Write release notes',
            '',
            'Manual tracking (tracked only, never run):',
            '3. [To do] Call the vendor',
            '',
            'Done:',
            '4. [Done] Finished 7',
            '5. [Done] Finished 5',
            '6. [Done] Finished 4',
            '7. [Done] Finished 3',
            '',
            'Done · Manual tracking (tracked only, never run):',
            '8. [Done] Finished 6',
            '',
            '…3 older Done items not shown. Open the chat\'s To-do tab in CoC for the full list.',
        ].join('\n'), command.messageId);
        // Chat-supplied Markdown stays literal in the rendered Teams HTML.
        expect(formatTeamsOutbound(replies().at(-1)!, 'markdown')).toContain('Fix *flaky* test');
        expect(todos.get(ownerA)).toEqual(before);
        noTurnStarted();
        // The sender's selection is unchanged: a plain message still continues the selected topic.
        await router.handle(msg('todo'));
        expect(replies().at(-1)).toBe(replies().at(-2));
    });

    it('lists all Done items when there are five or fewer, and no Done section when there are none', async () => {
        create(ownerA, 'Open item');
        create(ownerA, 'Done one', { status: 'done' });
        create(ownerA, 'Done two', { status: 'done', type: 'manual' });
        create(ownerB, 'Only active');
        await router.handle(msg('select topic sent-a'));
        await router.handle(msg('todos'));
        expect(replies().at(-1)).toBe([
            '📋 To-do · "Plan \\*A\\*" — 1 not done',
            '1. [To do] Open item',
            '',
            'Done:',
            '2. [Done] Done one',
            '',
            'Done · Manual tracking (tracked only, never run):',
            '3. [Done] Done two',
        ].join('\n'));
        await router.handle(msg('select topic sent-b'));
        await router.handle(msg('/list todos'));
        expect(replies().at(-1)).toBe('📋 To-do · "Plan B" — 1 not done\n1. [To do] Only active');
        const finished = todos.get(ownerB).items[0];
        todos.update(ownerB, finished.id, finished.revision, { archived: true }, 'user');
        await router.handle(msg('list todo'));
        expect(replies().at(-1)).toBe('📋 To-do · "Plan B"\nNo unfinished items.');
        noTurnStarted();
    });

    it('chunks active overflow without dropping active items and still caps Done at five', async () => {
        for (let i = 0; i < 70; i++) create(ownerA, `Active ${i} ${'x'.repeat(60)}`);
        create(ownerA, 'Manual open', { type: 'manual' });
        for (let i = 0; i < 8; i++) create(ownerA, `Closed ${i}`, { status: 'done' });
        await router.handle(msg('select topic sent-a'));
        sendReply.mockClear();
        const command = msg('list todos');
        await router.handle(command);
        const parts = replies();
        expect(parts.length).toBeGreaterThan(1);
        for (const part of parts) expect(part.length).toBeLessThanOrEqual(3000);
        for (const call of sendReply.mock.calls) expect(call[1]).toBe(command.messageId);
        const text = parts.join('');
        expect(text).toContain('— 71 not done');
        expect(text).toContain('70. [To do] Active 69 ');
        expect(text).toContain('71. [To do] Manual open');
        expect(text).toContain('72. [Done] Closed 7');
        expect(text).toContain('76. [Done] Closed 3');
        expect(text).not.toContain('Closed 2');
        expect(text.match(/^\d+\. \[/gm) ?? []).toHaveLength(76);
        expect(text).toContain('…3 older Done items not shown.');
    });

    it('routes to the sender\'s own selection in the selected repo, or answers truthfully', async () => {
        create(ownerA, 'Alpha item');
        await router.handle(msg('list todos'));
        expect(replies().at(-1)).toBe(TODOS_NO_TARGET_REPLY);
        await router.handle(msg('select repo Alpha'));
        await router.handle(msg('list todos'));
        expect(replies().at(-1)).toBe(TODOS_NO_TARGET_REPLY);
        await router.handle(msg('select topic sent-a'));
        // Another channel member's selection is separate.
        await router.handle(msg('list todos', { senderAadId: 'user-2' }));
        expect(replies().at(-1)).toBe(TODOS_NO_TARGET_REPLY);
        await router.handle(msg('list todos'));
        expect(replies().at(-1)).toContain('1. [To do] Alpha item');
        await router.handle(msg('select topic chat-a'));
        await router.handle(msg('list todos'));
        expect(replies().at(-1)).toContain('not a Sentinel chat');
        await router.handle(msg('select topic sent-a'));
        available = false;
        await router.handle(msg('list todos'));
        expect(replies().at(-1)).toBe(TODOS_UNAVAILABLE_REPLY);
        noTurnStarted();
    });

    it('lists a bound thread\'s own chat over the sender\'s selection and stays silent during replay', async () => {
        create(ownerA, 'Alpha item');
        for (let i = 0; i < 7; i++) create(ownerB, `Beta done ${i}`, { status: 'done' });
        const bindings: Record<string, { process?: { id: string }; workspaceId: string }> = {
            'root-b': { process: { id: 'sent-b' }, workspaceId: 'ws-b' },
            'root-new': { workspaceId: 'ws-a' },
            'root-plain': { process: { id: 'chat-a' }, workspaceId: 'ws-a' },
            // A thread can only read the ledger of its bound workspace.
            'root-cross': { process: { id: 'sent-a' }, workspaceId: 'ws-b' },
        };
        deps.isAnswerRelayEnabled = () => true;
        deps.recordThreadCommand = vi.fn();
        deps.hasThreadCommand = vi.fn().mockReturnValue(false);
        deps.resolveThreadReply = vi.fn(async (message: InboundTeamsMessage) => bindings[message.replyToMessageId!] as never ?? null);
        router = new TeamsCommandRouter(deps);
        await router.handle(msg('select topic sent-a'));
        const reply = msg('list todos', { replyToMessageId: 'root-b' });
        await router.handle(reply);
        expect(deps.recordThreadCommand).toHaveBeenCalledWith(reply);
        expect(sendReply).toHaveBeenLastCalledWith([
            '📋 To-do · "Plan B" — 0 not done',
            '',
            'Done:',
            '1. [Done] Beta done 6',
            '2. [Done] Beta done 5',
            '3. [Done] Beta done 4',
            '4. [Done] Beta done 3',
            '5. [Done] Beta done 2',
            '',
            '…2 older Done items not shown. Open the chat\'s To-do tab in CoC for the full list.',
        ].join('\n'), 'root-b');
        await router.handle(msg('/todo', { replyToMessageId: 'root-new' }));
        expect(sendReply).toHaveBeenLastCalledWith(expect.stringContaining('No topic selected in this thread'), 'root-new');
        await router.handle(msg('todos', { replyToMessageId: 'root-plain' }));
        expect(sendReply).toHaveBeenLastCalledWith(expect.stringContaining('not a Sentinel chat'), 'root-plain');
        await router.handle(msg('todos', { replyToMessageId: 'root-cross' }));
        expect(sendReply).toHaveBeenLastCalledWith(expect.stringContaining('not a Sentinel chat'), 'root-cross');
        const calls = sendReply.mock.calls.length;
        await router.handle(msg('list todos', { replyToMessageId: 'root-b', historicalSelectionReplay: true }));
        expect(sendReply).toHaveBeenCalledTimes(calls);
        noTurnStarted();
        expect(deps.admitFollowUp).toBeUndefined();
    });

    it('advertises list todos in Teams help', async () => {
        await router.handle(msg('help'));
        expect(replies().at(-1)).toContain('list todos');
    });
});
