/**
 * Tests for the Teams command router and user state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseCommand, TeamsCommandRouter, type TeamsCommandRouterDeps } from '../../../src/server/messaging/teams-command-router';
import { TeamsUserStateStore } from '../../../src/server/messaging/teams-user-state';
import type { InboundTeamsMessage } from '@plusplusoneplusplus/coc-connector/teams';

// ============================================================================
// parseCommand
// ============================================================================

describe('parseCommand', () => {
    it('parses "/list agents"', () => {
        expect(parseCommand('/list agents')).toEqual({ type: 'list-agents', args: '' });
        expect(parseCommand('/LIST AGENTS')).toEqual({ type: 'list-agents', args: '' });
        expect(parseCommand('/list agent')).toEqual({ type: 'list-agents', args: '' });
    });

    it('parses "/list repos"', () => {
        expect(parseCommand('/list repos')).toEqual({ type: 'list-repos', args: '' });
        expect(parseCommand('/list repo')).toEqual({ type: 'list-repos', args: '' });
    });

    it('parses "/select repo <name>"', () => {
        expect(parseCommand('/select repo my-project')).toEqual({ type: 'select-repo', args: 'my-project' });
        expect(parseCommand('/select repos My Repo')).toEqual({ type: 'select-repo', args: 'My Repo' });
    });

    it('parses "/list topics"', () => {
        expect(parseCommand('/list topics')).toEqual({ type: 'list-topics', args: '' });
        expect(parseCommand('/list chat topics')).toEqual({ type: 'list-topics', args: '' });
        expect(parseCommand('/list topic')).toEqual({ type: 'list-topics', args: '' });
    });

    it('parses "/create topic"', () => {
        expect(parseCommand('/create topic')).toEqual({ type: 'create-topic', args: '' });
        expect(parseCommand('/create chat topic')).toEqual({ type: 'create-topic', args: '' });
    });

    it('parses "/select topic <id>"', () => {
        expect(parseCommand('/select topic abc123')).toEqual({ type: 'select-topic', args: 'abc123' });
        expect(parseCommand('/select chat topic abc123')).toEqual({ type: 'select-topic', args: 'abc123' });
    });

    it('parses "[chatid] message" syntax', () => {
        const result = parseCommand('[abc-123] Hello world');
        expect(result.type).toBe('chat-explicit');
        expect(result.args).toBe('abc-123\0Hello world');
    });

    it('treats unrecognized text as plain chat', () => {
        expect(parseCommand('Hello, how are you?')).toEqual({ type: 'chat', args: 'Hello, how are you?' });
    });

    it('treats commands without / prefix as plain chat', () => {
        expect(parseCommand('list agents')).toEqual({ type: 'chat', args: 'list agents' });
        expect(parseCommand('select repo foo')).toEqual({ type: 'chat', args: 'select repo foo' });
    });

    it('trims whitespace', () => {
        expect(parseCommand('  /list agents  ')).toEqual({ type: 'list-agents', args: '' });
    });
});

// ============================================================================
// TeamsUserStateStore
// ============================================================================

describe('TeamsUserStateStore', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-state-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns default state for unknown user', () => {
        const store = new TeamsUserStateStore(tmpDir);
        const state = store.get('user1');
        expect(state).toEqual({ selectedRepo: null, selectedTopic: null, lastActiveTopic: null });
    });

    it('persists state updates to disk', () => {
        const store = new TeamsUserStateStore(tmpDir);
        store.update('user1', { selectedRepo: 'repo-1' });

        // Re-create store from disk
        const store2 = new TeamsUserStateStore(tmpDir);
        expect(store2.get('user1').selectedRepo).toBe('repo-1');
    });

    it('tracks separate state per user', () => {
        const store = new TeamsUserStateStore(tmpDir);
        store.update('user1', { selectedRepo: 'repo-1' });
        store.update('user2', { selectedRepo: 'repo-2' });

        expect(store.get('user1').selectedRepo).toBe('repo-1');
        expect(store.get('user2').selectedRepo).toBe('repo-2');
    });

    it('merges partial updates', () => {
        const store = new TeamsUserStateStore(tmpDir);
        store.update('user1', { selectedRepo: 'repo-1' });
        store.update('user1', { selectedTopic: 'topic-1' });

        const state = store.get('user1');
        expect(state.selectedRepo).toBe('repo-1');
        expect(state.selectedTopic).toBe('topic-1');
    });
});

// ============================================================================
// TeamsCommandRouter
// ============================================================================

describe('TeamsCommandRouter', () => {
    let tmpDir: string;
    let deps: TeamsCommandRouterDeps;
    let router: TeamsCommandRouter;
    let sendReplySpy: ReturnType<typeof vi.fn>;

    function makeMsg(text: string, overrides: Partial<InboundTeamsMessage> = {}): InboundTeamsMessage {
        return {
            channelId: 'ch-1',
            messageId: 'msg-' + Math.random().toString(36).slice(2, 8),
            text,
            senderAadId: 'user-aad-1',
            senderName: 'Test User',
            ...overrides,
        };
    }

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-router-test-'));
        sendReplySpy = vi.fn().mockResolvedValue(undefined);

        deps = {
            store: {
                getWorkspaces: vi.fn().mockResolvedValue([
                    { id: 'ws-1', name: 'ProjectA', rootPath: '/repo/projectA' },
                    { id: 'ws-2', name: 'ProjectB', rootPath: '/repo/projectB' },
                ]),
                getAllProcesses: vi.fn().mockResolvedValue([
                    { id: 'proc-111', status: 'completed', title: 'Fix bug', startTime: '2025-01-02T00:00:00Z', promptPreview: 'Fix the bug' },
                    { id: 'proc-222', status: 'running', title: 'Add feature', startTime: '2025-01-01T00:00:00Z', promptPreview: 'Add a feature' },
                ]),
                getProcess: vi.fn().mockImplementation(async (id: string) => {
                    if (id === 'proc-111') return { id: 'proc-111', status: 'completed', title: 'Fix bug', startTime: '2025-01-02T00:00:00Z', promptPreview: 'Fix the bug' };
                    if (id === 'proc-222') return { id: 'proc-222', status: 'running', title: 'Add feature', startTime: '2025-01-01T00:00:00Z', promptPreview: 'Add feature' };
                    return undefined;
                }),
            } as any,
            enqueueChat: vi.fn().mockResolvedValue('task-new-123'),
            executeFollowUp: vi.fn().mockResolvedValue(undefined),
            sendReply: sendReplySpy,
            dataDir: tmpDir,
        };

        router = new TeamsCommandRouter(deps);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ── list agents / list repos ──────────────────────────────

    it('lists agents/repos', async () => {
        await router.handle(makeMsg('/list agents'));
        expect(sendReplySpy).toHaveBeenCalledTimes(1);
        const reply = sendReplySpy.mock.calls[0][0] as string;
        expect(reply).toContain('ProjectA');
        expect(reply).toContain('ProjectB');
        expect(reply).toContain('2');
    });

    it('reports safe command, queue, follow-up and dispatch failure categories', async () => {
        const observe = vi.fn();
        await router.handle(makeMsg('/list agents'), observe);
        await router.handle(makeMsg('Start a topic'), observe);
        await router.handle(makeMsg('[proc-111] Continue'), observe);
        vi.mocked(deps.executeFollowUp).mockRejectedValueOnce(new Error('private workspace path'));
        await router.handle(makeMsg('[proc-111] Retry'), observe);
        expect(observe.mock.calls.map(([type]) => type)).toEqual([
            'dispatch-command', 'dispatch-queued', 'dispatch-follow-up', 'dispatch-failed',
        ]);
    });

    it('lists repos (alias)', async () => {
        await router.handle(makeMsg('/list repos'));
        expect(sendReplySpy).toHaveBeenCalledTimes(1);
        expect(sendReplySpy.mock.calls[0][0]).toContain('Agents / Repos');
    });

    it('handles empty workspace list', async () => {
        (deps.store.getWorkspaces as any).mockResolvedValue([]);
        await router.handle(makeMsg('/list agents'));
        expect(sendReplySpy.mock.calls[0][0]).toContain('No agents');
    });

    // ── select repo ───────────────────────────────────────────

    it('selects repo by name', async () => {
        await router.handle(makeMsg('/select repo ProjectA'));
        expect(sendReplySpy.mock.calls[0][0]).toContain('Selected repo');
        expect(sendReplySpy.mock.calls[0][0]).toContain('ProjectA');
    });

    it('selects repo by numeric index', async () => {
        await router.handle(makeMsg('/select repo 2'));
        expect(sendReplySpy.mock.calls[0][0]).toContain('ProjectB');
    });

    it('errors on unknown repo', async () => {
        await router.handle(makeMsg('/select repo NonExistent'));
        expect(sendReplySpy.mock.calls[0][0]).toContain('not found');
    });

    // ── list topics ───────────────────────────────────────────

    it('lists topics', async () => {
        await router.handle(makeMsg('/select repo ProjectA'));
        sendReplySpy.mockClear();

        await router.handle(makeMsg('/list topics'));
        const reply = sendReplySpy.mock.calls[0][0] as string;
        expect(reply).toContain('Chat Topics');
        expect(reply).toContain('Fix bug');
    });

    it('handles no topics', async () => {
        (deps.store.getAllProcesses as any).mockResolvedValue([]);
        await router.handle(makeMsg('/list topics'));
        expect(sendReplySpy.mock.calls[0][0]).toContain('No chat topics');
    });

    // ── create topic ──────────────────────────────────────────

    it('creates topic (clears selection for next message)', async () => {
        await router.handle(makeMsg('/select repo ProjectA'));
        sendReplySpy.mockClear();

        await router.handle(makeMsg('/create topic'));
        expect(deps.enqueueChat).not.toHaveBeenCalled();
        expect(sendReplySpy.mock.calls[0][0]).toContain('Ready for a new topic');
    });

    it('errors on create topic without repo', async () => {
        await router.handle(makeMsg('/create topic'));
        expect(sendReplySpy.mock.calls[0][0]).toContain('No repo selected');
    });

    // ── select topic ──────────────────────────────────────────

    it('selects an existing topic by ID', async () => {
        await router.handle(makeMsg('/select topic proc-111'));
        expect(sendReplySpy.mock.calls[0][0]).toContain('Selected topic');
        expect(sendReplySpy.mock.calls[0][0]).toContain('Fix bug');
    });

    it('selects a topic by numeric index', async () => {
        // proc-111 (2025-01-02) sorts first, proc-222 (2025-01-01) second
        await router.handle(makeMsg('/select topic 1'));
        expect(sendReplySpy.mock.calls[0][0]).toContain('Selected topic');
        expect(sendReplySpy.mock.calls[0][0]).toContain('Fix bug');
    });

    it('selects second topic by numeric index', async () => {
        await router.handle(makeMsg('/select topic 2'));
        expect(sendReplySpy.mock.calls[0][0]).toContain('Selected topic');
        expect(sendReplySpy.mock.calls[0][0]).toContain('Add feature');
    });

    it('errors on out-of-range numeric index', async () => {
        await router.handle(makeMsg('/select topic 99'));
        expect(sendReplySpy.mock.calls[0][0]).toContain('not found');
    });

    it('errors on selecting non-existent topic', async () => {
        await router.handle(makeMsg('/select topic bad-id'));
        expect(sendReplySpy.mock.calls[0][0]).toContain('not found');
    });

    // ── explicit chat [chatid] message ────────────────────────

    it('sends message to explicit chat ID', async () => {
        await router.handle(makeMsg('[proc-111] What is the status?'));
        expect(deps.executeFollowUp).toHaveBeenCalledWith('proc-111', 'What is the status?');
        expect(sendReplySpy.mock.calls[0][0]).toContain('Message sent');
    });

    it('errors on explicit chat with non-existent ID', async () => {
        await router.handle(makeMsg('[bad-id] Hello'));
        expect(sendReplySpy.mock.calls[0][0]).toContain('not found');
    });

    // ── chat (follow-up or create new) ────────────────────────

    it('follows up on selected topic', async () => {
        await router.handle(makeMsg('/select topic proc-222'));
        sendReplySpy.mockClear();

        await router.handle(makeMsg('How is it going?'));
        expect(deps.executeFollowUp).toHaveBeenCalledWith('proc-222', 'How is it going?');
    });

    it('creates new topic when no active topic and repo is selected', async () => {
        await router.handle(makeMsg('/select repo ProjectA'));
        sendReplySpy.mockClear();

        await router.handle(makeMsg('Start something new'));
        expect(deps.enqueueChat).toHaveBeenCalledWith('ws-1', 'Start something new');
        expect(sendReplySpy.mock.calls[0][0]).toContain('New topic created');
    });

    it('auto-selects first repo when no repo selected', async () => {
        await router.handle(makeMsg('Hello world'));
        expect(deps.enqueueChat).toHaveBeenCalledWith('ws-1', 'Hello world');
        expect(sendReplySpy.mock.calls[0][0]).toContain('ProjectA');
    });

    it('errors when no repos available and no topic selected', async () => {
        (deps.store.getWorkspaces as any).mockResolvedValue([]);
        await router.handle(makeMsg('Hello'));
        expect(sendReplySpy.mock.calls[0][0]).toContain('No repo available');
    });

    // ── error handling ────────────────────────────────────────

    it('catches and reports errors', async () => {
        (deps.store.getWorkspaces as any).mockRejectedValue(new Error('DB error'));
        await router.handle(makeMsg('/list agents'));
        expect(sendReplySpy.mock.calls[0][0]).toContain('DB error');
    });

    // ── per-user isolation ────────────────────────────────────

    it('isolates state between users', async () => {
        await router.handle(makeMsg('/select repo ProjectA', { senderAadId: 'user-A' }));
        await router.handle(makeMsg('/select repo ProjectB', { senderAadId: 'user-B' }));
        sendReplySpy.mockClear();

        // user-A sends a message — should enqueue in ProjectA (ws-1), not ProjectB
        await router.handle(makeMsg('Fix the bug', { senderAadId: 'user-A' }));
        expect(deps.enqueueChat).toHaveBeenCalledWith('ws-1', 'Fix the bug');
    });

    describe('channel-thread replies', () => {
        beforeEach(() => {
            deps.isAnswerRelayEnabled = () => true;
            deps.selectThreadTarget = vi.fn().mockResolvedValue(undefined);
            deps.admitFollowUp = vi.fn().mockResolvedValue({ duplicate: false });
            deps.admitPendingFollowUp = vi.fn().mockResolvedValue({ duplicate: false });
            deps.acknowledgeFollowUp = vi.fn().mockResolvedValue(undefined);
            deps.resolveThreadReply = vi.fn().mockImplementation(async (msg: InboundTeamsMessage) => {
                if (msg.replyToMessageId === 'root-a') {
                    return { process: { id: 'proc-a', metadata: { workspaceId: 'ws-1' } }, workspaceId: 'ws-1' };
                }
                if (msg.replyToMessageId === 'root-b') {
                    return { process: { id: 'proc-b', metadata: { workspaceId: 'ws-2' } }, workspaceId: 'ws-2' };
                }
                if (msg.replyToMessageId === 'pending') return { taskId: 'task-pending', workspaceId: 'ws-1' };
                return null;
            });
            router = new TeamsCommandRouter(deps);
        });

        it('dispatches control commands in the shared thread without sending them to AI', async () => {
            await router.handle(makeMsg('/select topic proc-111'));
            await router.handle(makeMsg('/select repo ProjectB'));
            sendReplySpy.mockClear();

            const command = (text: string, senderAadId = 'user-aad-1') =>
                makeMsg(text, { replyToMessageId: 'root-a', senderAadId });
            await router.handle(command('/list repos'));
            await router.handle(command('/list topics'));
            await router.handle(command('/select repo ProjectB', 'another-user'));
            await router.handle(command('/create topic'));
            expect(deps.selectThreadTarget).toHaveBeenCalledWith(expect.objectContaining({ replyToMessageId: 'root-a' }), 'ws-2', null);
            expect(deps.selectThreadTarget).toHaveBeenCalledWith(expect.any(Object), 'ws-1', null);
            expect(sendReplySpy.mock.calls.map(([, root]) => root)).toEqual(['root-a', 'root-a', 'root-a', 'root-a']);
            expect(sendReplySpy.mock.calls[2][0]).toContain('next question starts a new chat');
            expect(deps.admitFollowUp).not.toHaveBeenCalled();
            expect(deps.executeFollowUp).not.toHaveBeenCalled();
            expect(deps.enqueueChat).not.toHaveBeenCalled();
            await router.handle(makeMsg('[proc-111] explicit chat', { replyToMessageId: 'root-b' }));
            expect(deps.admitFollowUp).toHaveBeenCalledWith(
                expect.any(Object), expect.objectContaining({ id: 'proc-b' }), '[proc-111] explicit chat');
            await router.handle(makeMsg('still selected', { replyToMessageId: 'unrelated-root' }));
            expect(sendReplySpy).toHaveBeenLastCalledWith(expect.stringContaining('unavailable'), 'unrelated-root');
            expect(deps.admitFollowUp).toHaveBeenCalledTimes(1);
        });

        it('rejects cross-workspace and missing topics without changing the thread', async () => {
            const msg = (text: string) => makeMsg(text, { replyToMessageId: 'root-a' });
            await router.handle(msg('/select topic proc-222'));
            await router.handle(msg('/select topic missing'));
            expect(sendReplySpy.mock.calls[0][0]).toContain('not found in the selected repo');
            expect(sendReplySpy.mock.calls[1][0]).toContain('not found in the selected repo');
            expect(deps.selectThreadTarget).not.toHaveBeenCalled();
            expect(deps.admitFollowUp).not.toHaveBeenCalled();
        });

        it('selects a valid topic within the current thread workspace', async () => {
            vi.mocked(deps.store.getProcess).mockResolvedValueOnce({
                id: 'proc-111', status: 'completed', title: 'Fix bug',
                metadata: { workspaceId: 'ws-1' },
            } as Awaited<ReturnType<typeof deps.store.getProcess>>);
            await router.handle(makeMsg('/select topic proc-111', { replyToMessageId: 'root-a' }));
            expect(deps.selectThreadTarget).toHaveBeenCalledWith(expect.any(Object), 'ws-1', 'proc-111');
            expect(sendReplySpy).toHaveBeenCalledWith(expect.stringContaining('next question continues'), 'root-a');
        });

        it('admits pending thread replies by the bound task ID without changing the selected topic', async () => {
            await router.handle(makeMsg('/select topic proc-111'));
            sendReplySpy.mockClear();
            const reply = makeMsg('queued reply', { replyToMessageId: 'pending' });
            await router.handle(reply);
            expect(deps.admitPendingFollowUp).toHaveBeenCalledWith(reply, 'task-pending', 'queued reply');
            expect(sendReplySpy).toHaveBeenCalledWith(expect.stringContaining('Message sent'), 'pending');
            expect(deps.acknowledgeFollowUp).toHaveBeenCalledWith(reply);
            await router.handle(makeMsg('ordinary message'));
            expect(deps.admitFollowUp).toHaveBeenCalledWith(
                expect.any(Object), expect.objectContaining({ id: 'proc-111' }), 'ordinary message');
        });

        it('reports missing bound targets in the same thread and never falls back', async () => {
            await router.handle(makeMsg('/select topic proc-111'));
            sendReplySpy.mockClear();
            vi.mocked(deps.admitPendingFollowUp!).mockResolvedValueOnce(null);
            await router.handle(makeMsg('lost task', { replyToMessageId: 'pending' }));
            expect(sendReplySpy).toHaveBeenCalledWith(expect.stringContaining('unavailable'), 'pending');
            expect(deps.enqueueChat).not.toHaveBeenCalled();
            expect(deps.executeFollowUp).not.toHaveBeenCalled();

            vi.mocked(deps.resolveThreadReply!).mockRejectedValueOnce(new Error('private store details'));
            await router.handle(makeMsg('lost binding', { replyToMessageId: 'root-a' }));
            expect(sendReplySpy).toHaveBeenLastCalledWith(expect.stringContaining('unavailable'), 'root-a');
            expect(sendReplySpy.mock.lastCall?.[0]).not.toContain('private store details');
            expect(deps.admitFollowUp).not.toHaveBeenCalled();
        });

        it('ignores already-admitted replies and rejects thread replies when disabled', async () => {
            vi.mocked(deps.admitFollowUp!).mockResolvedValueOnce({ duplicate: true });
            await router.handle(makeMsg('duplicate', { replyToMessageId: 'root-a' }));
            expect(sendReplySpy).not.toHaveBeenCalled();
            expect(deps.acknowledgeFollowUp).not.toHaveBeenCalled();

            deps.isAnswerRelayEnabled = () => false;
            await router.handle(makeMsg('new topic', { replyToMessageId: 'root-a' }));
            expect(deps.resolveThreadReply).toHaveBeenCalledTimes(1);
            expect(deps.enqueueChat).not.toHaveBeenCalled();
            expect(sendReplySpy).toHaveBeenCalledWith(expect.stringContaining('unavailable'), 'root-a');
        });
    });
});
