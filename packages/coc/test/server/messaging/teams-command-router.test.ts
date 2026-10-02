/**
 * Tests for the Teams command router and user state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TeamsCommandRouter, type TeamsCommandRouterDeps } from '../../../src/server/messaging/teams-command-router';
import { TeamsUserStateStore } from '../../../src/server/messaging/teams-user-state';
import type { InboundTeamsMessage } from '@plusplusoneplusplus/coc-connector/teams';

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
                    { id: 'proc-111', status: 'completed', title: 'Fix bug', startTime: '2025-01-02T00:00:00Z', promptPreview: 'Fix the bug', metadata: { workspaceId: 'ws-1' } },
                    { id: 'proc-222', status: 'running', title: 'Add feature', startTime: '2025-01-01T00:00:00Z', promptPreview: 'Add a feature', metadata: { workspaceId: 'ws-1' } },
                ]),
                getProcess: vi.fn().mockImplementation(async (id: string) => {
                    if (id === 'proc-111') return { id: 'proc-111', status: 'completed', title: 'Fix bug', startTime: '2025-01-02T00:00:00Z', promptPreview: 'Fix the bug', metadata: { workspaceId: 'ws-1' } };
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
        expect(sendReplySpy.mock.calls[0][0]).toContain('Repos (2)');
        expect(sendReplySpy.mock.calls[0][0]).toContain('/repo/projectA');
    });

    it('handles empty workspace list', async () => {
        (deps.store.getWorkspaces as any).mockResolvedValue([]);
        await router.handle(makeMsg('/list agents'));
        expect(sendReplySpy.mock.calls[0][0]).toContain('No repos registered');
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
        expect(reply).toContain('Chat topics (repo: **ProjectA**)');
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

    it('reads topics with a bounded, conversation-free query so large stores cannot stall replies', async () => {
        const getAllProcesses = deps.store.getAllProcesses as ReturnType<typeof vi.fn>;
        await router.handle(makeMsg('/list topics'));
        await router.handle(makeMsg('/select topic 1'));
        await router.handle(makeMsg('/select repo ProjectA'));
        await router.handle(makeMsg('/list topics'));
        await router.handle(makeMsg('/select topic 2'));
        expect(getAllProcesses.mock.calls.map(([filter]) => filter)).toEqual([
            { limit: 10, exclude: ['conversation', 'toolCalls'] },
            { limit: 10, exclude: ['conversation', 'toolCalls'] },
            { workspaceId: 'ws-1', limit: 10, exclude: ['conversation', 'toolCalls'] },
            { workspaceId: 'ws-1', limit: 10, exclude: ['conversation', 'toolCalls'] },
        ]);
        expect(sendReplySpy).toHaveBeenLastCalledWith(expect.stringContaining('Add feature'), expect.anything());
    });

    // ── explicit chat [chatid] message ────────────────────────

    it('sends message to explicit chat ID', async () => {
        await router.handle(makeMsg('[proc-111] What is the status?'));
        expect(deps.executeFollowUp).toHaveBeenCalledWith('proc-111', 'What is the status?', 'ask');
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
        expect(deps.executeFollowUp).toHaveBeenCalledWith('proc-222', 'How is it going?', 'ask');
    });

    it('creates new topic when no active topic and repo is selected', async () => {
        await router.handle(makeMsg('/select repo ProjectA'));
        sendReplySpy.mockClear();

        await router.handle(makeMsg('Start something new'));
        expect(deps.enqueueChat).toHaveBeenCalledWith('ws-1', 'Start something new', 'ask');
        expect(sendReplySpy.mock.calls[0][0]).toContain('New topic created');
    });

    it('auto-selects first repo when no repo selected', async () => {
        await router.handle(makeMsg('Hello world'));
        expect(deps.enqueueChat).toHaveBeenCalledWith('ws-1', 'Hello world', 'ask');
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

    // ── shared grammar: bare commands, help, quota, unknown, autopilot ──

    it('accepts commands without the leading slash, case-insensitively', async () => {
        await router.handle(makeMsg('SELECT REPO ProjectB'));
        await router.handle(makeMsg('list agents'));
        expect(sendReplySpy.mock.calls[0][0]).toContain('Selected repo');
        expect(sendReplySpy.mock.calls[1][0]).toContain('Repos (2)');
        expect(deps.enqueueChat).not.toHaveBeenCalled();
    });

    it('replies with help generated from the shared command table', async () => {
        await router.handle(makeMsg('/help'));
        await router.handle(makeMsg('help'));
        for (const [reply] of sendReplySpy.mock.calls) {
            expect(reply).toContain('select repo <n|name|id>');
            expect(reply).toContain('quota — show AI provider quota');
            expect(reply).toContain('/autopilot <message>');
        }
        expect(deps.enqueueChat).not.toHaveBeenCalled();
    });

    it('replies with per-provider quota and degrades when unavailable', async () => {
        await router.handle(makeMsg('quota'));
        expect(sendReplySpy.mock.lastCall?.[0]).toBe('Quota data is unavailable.');
        deps.getQuota = vi.fn().mockResolvedValue({
            lastUpdated: '2026-10-01T00:00:00Z',
            providers: [
                { id: 'copilot', quotaTypes: [{
                    type: 'premium_interactions', isUnlimitedEntitlement: false, usedRequests: 38,
                    entitlementRequests: 100, remainingPercentage: 0.62, usageAllowedWithExhaustedQuota: false,
                    overage: 0, resetDate: '2026-11-01T00:00:00Z',
                }] },
                { id: 'codex', quotaTypes: [], error: 'boom' },
            ],
        });
        router = new TeamsCommandRouter(deps);
        await router.handle(makeMsg('/QUOTA'));
        expect(sendReplySpy.mock.lastCall?.[0]).toBe(
            'copilot: 62% left (premium_interactions, resets 2026-11-01)\ncodex: unavailable');
        vi.mocked(deps.getQuota!).mockRejectedValueOnce(new Error('down'));
        await router.handle(makeMsg('quota'));
        expect(sendReplySpy.mock.lastCall?.[0]).toBe('Quota data is unavailable.');
    });

    it('replies "Unknown command" for an unknown /word instead of sending it to the AI', async () => {
        await router.handle(makeMsg('/frobnicate now'));
        await router.handle(makeMsg('/select repo'));
        expect(sendReplySpy.mock.calls.every(([reply]) => String(reply).includes('Unknown command'))).toBe(true);
        expect(deps.enqueueChat).not.toHaveBeenCalled();
        expect(deps.executeFollowUp).not.toHaveBeenCalled();
    });

    it('runs /autopilot messages in autopilot mode for new chats and explicit chats', async () => {
        await router.handle(makeMsg('/autopilot fix the build'));
        expect(deps.enqueueChat).toHaveBeenCalledWith('ws-1', 'fix the build', 'autopilot');
        await router.handle(makeMsg('/autopilot [proc-111] keep going'));
        expect(deps.executeFollowUp).toHaveBeenCalledWith('proc-111', 'keep going', 'autopilot');
    });

    // ── per-user isolation ────────────────────────────────────

    it('isolates state between users', async () => {
        await router.handle(makeMsg('/select repo ProjectA', { senderAadId: 'user-A' }));
        await router.handle(makeMsg('/select repo ProjectB', { senderAadId: 'user-B' }));
        sendReplySpy.mockClear();

        // user-A sends a message — should enqueue in ProjectA (ws-1), not ProjectB
        await router.handle(makeMsg('Fix the bug', { senderAadId: 'user-A' }));
        expect(deps.enqueueChat).toHaveBeenCalledWith('ws-1', 'Fix the bug', 'ask');
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

        it('reads thread topics with a bounded, conversation-free query', async () => {
            const getAllProcesses = deps.store.getAllProcesses as ReturnType<typeof vi.fn>;
            await router.handle(makeMsg('/list topics', { replyToMessageId: 'root-a' }));
            await router.handle(makeMsg('/select topic 1', { replyToMessageId: 'root-a' }));
            expect(getAllProcesses.mock.calls.map(([filter]) => filter)).toEqual([
                { workspaceId: 'ws-1', limit: 10, exclude: ['conversation', 'toolCalls'] },
                { workspaceId: 'ws-1', limit: 10, exclude: ['conversation', 'toolCalls'] },
            ]);
            expect(deps.selectThreadTarget).toHaveBeenCalledWith(expect.any(Object), 'ws-1', 'proc-111');
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
                expect.any(Object), expect.objectContaining({ id: 'proc-b' }), '[proc-111] explicit chat', 'ask');
            await router.handle(makeMsg('still selected', { replyToMessageId: 'unrelated-root' }));
            expect(sendReplySpy).toHaveBeenLastCalledWith(expect.stringContaining('/select repo <name>'), 'unrelated-root');
            expect(deps.admitFollowUp).toHaveBeenCalledTimes(1);
        });

        it('answers help, quota and unknown commands in the thread root without dispatching to AI', async () => {
            const recordThreadCommand = vi.fn();
            deps.recordThreadCommand = recordThreadCommand;
            deps.getQuota = vi.fn().mockResolvedValue({ lastUpdated: null, providers: [{ id: 'copilot', quotaTypes: [] }] });
            router = new TeamsCommandRouter(deps);
            const msg = (text: string) => makeMsg(text, { replyToMessageId: 'root-a' });
            await router.handle(msg('help'));
            await router.handle(msg('/quota'));
            await router.handle(msg('/nope'));
            await router.handle(msg('/autopilot ship it'));
            expect(sendReplySpy.mock.calls.map(([, root]) => root)).toEqual(['root-a', 'root-a', 'root-a', 'root-a']);
            expect(sendReplySpy.mock.calls[0][0]).toContain('Commands (case-insensitive');
            expect(sendReplySpy.mock.calls[1][0]).toBe('copilot: no quota data');
            expect(sendReplySpy.mock.calls[2][0]).toContain('Unknown command');
            expect(recordThreadCommand).toHaveBeenCalledTimes(3);
            expect(deps.admitFollowUp).toHaveBeenCalledTimes(1);
            expect(deps.admitFollowUp).toHaveBeenCalledWith(
                expect.any(Object), expect.objectContaining({ id: 'proc-a' }), 'ship it', 'autopilot');
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

        it('does not interpret a malformed thread repo index as a selection', async () => {
            await router.handle(makeMsg('/select repo 2extra', { replyToMessageId: 'root-a' }));
            expect(sendReplySpy).toHaveBeenCalledWith(expect.stringContaining('Repo not found'), 'root-a');
            expect(deps.selectThreadTarget).not.toHaveBeenCalled();
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

        it('serializes commands from different senders and suppresses duplicate deliveries', async () => {
            const admitted = new Set<string>();
            let release: (() => void) | undefined;
            deps.hasThreadCommand = msg => admitted.has(msg.messageId);
            deps.selectThreadTarget = vi.fn(async msg => {
                if (msg.messageId === 'switch-first') {
                    await new Promise<void>(resolve => { release = resolve; });
                }
                admitted.add(msg.messageId);
            });
            router = new TeamsCommandRouter(deps);
            const first = makeMsg('/select repo ProjectB', {
                replyToMessageId: 'root-a', messageId: 'switch-first', senderAadId: 'person-a',
            });
            const second = makeMsg('/select repo ProjectA', {
                replyToMessageId: 'root-a', messageId: 'switch-second', senderAadId: 'person-b',
            });
            const pending = Promise.all([router.handle(first), router.handle(second), router.handle(first)]);
            await vi.waitFor(() => expect(release).toBeDefined());
            expect(deps.selectThreadTarget).toHaveBeenCalledTimes(1);
            release!();
            await pending;
            expect(vi.mocked(deps.selectThreadTarget).mock.calls.map(([msg]) => msg.messageId))
                .toEqual(['switch-first', 'switch-second']);
            expect(sendReplySpy).toHaveBeenCalledTimes(2);
        });

        it('admits pending thread replies by the bound task ID without changing the selected topic', async () => {
            await router.handle(makeMsg('/select topic proc-111'));
            sendReplySpy.mockClear();
            const reply = makeMsg('queued reply', { replyToMessageId: 'pending' });
            await router.handle(reply);
            expect(deps.admitPendingFollowUp).toHaveBeenCalledWith(reply, 'task-pending', 'queued reply', 'ask');
            expect(sendReplySpy).toHaveBeenCalledWith(expect.stringContaining('Message sent'), 'pending');
            expect(deps.acknowledgeFollowUp).toHaveBeenCalledWith(reply);
            await router.handle(makeMsg('ordinary message'));
            expect(deps.admitFollowUp).toHaveBeenCalledWith(
                expect.any(Object), expect.objectContaining({ id: 'proc-111' }), 'ordinary message', 'ask');
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
