/**
 * Tests for the Teams command router and user state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TeamsCommandRouter, type TeamsCommandRouterDeps } from '../../../src/server/messaging/teams-command-router';
import { TeamsUserStateStore } from '../../../src/server/messaging/teams-user-state';
import { formatTeamsOutbound } from '../../../src/server/messaging/teams-outbound-format';
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
                    { id: 'global-workspace-00', name: 'Global', rootPath: '/coc/global-workspace' },
                ]),
                getAllProcesses: vi.fn().mockResolvedValue([
                    { id: 'proc-111', status: 'completed', title: 'Fix bug', startTime: new Date(Date.now() - 1000), promptPreview: 'Fix the bug', metadata: { workspaceId: 'ws-1' } },
                    { id: 'proc-222', status: 'running', title: 'Add feature', startTime: new Date(Date.now() - 2000), promptPreview: 'Add a feature', metadata: { workspaceId: 'ws-1' } },
                ]),
                getProcess: vi.fn().mockImplementation(async (id: string) => {
                    if (id === 'proc-111') return { id: 'proc-111', status: 'completed', title: 'Fix bug', startTime: new Date(Date.now() - 1000), promptPreview: 'Fix the bug', metadata: { workspaceId: 'ws-1' } };
                    if (id === 'proc-222') return { id: 'proc-222', status: 'running', title: 'Add feature', startTime: new Date(Date.now() - 2000), promptPreview: 'Add feature', metadata: { workspaceId: 'ws-1' } };
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

    it('dispatches Git status through the shared path for roots and bound threads without changing targets', async () => {
        const readGitStatus = vi.fn().mockResolvedValue({
            branch: { branch: 'main', isDetached: false, dirty: false, ahead: 8, behind: 0, trackingBranch: 'origin/main', unborn: false },
            entries: [], conflicts: 0, trackingAvailable: true,
        });
        const selectThreadTarget = vi.fn(), resolveThreadReply = vi.fn(), recordThreadCommand = vi.fn();
        router = new TeamsCommandRouter({
            ...deps, readGitStatus, selectThreadTarget, resolveThreadReply, recordThreadCommand,
            isAnswerRelayEnabled: () => true, hasThreadCommand: () => false,
        });
        await router.handle(makeMsg('git status', { botAuthored: true }));
        await router.handle(makeMsg('git status', { replyToMessageId: 'root', historicalSelectionReplay: true }));
        expect(readGitStatus).not.toHaveBeenCalled();
        await router.handle(makeMsg('select repo 1'));
        sendReplySpy.mockClear();
        await router.handle(makeMsg('/GIT STATUS', { messageId: 'root-command' }));
        await router.handle(makeMsg('git status', { replyToMessageId: 'bound-root' }));
        expect(readGitStatus).toHaveBeenCalledTimes(6);
        expect(sendReplySpy).toHaveBeenCalledWith(expect.stringContaining('ProjectA - clean\n'), 'root-command');
        expect(sendReplySpy).toHaveBeenCalledWith(expect.stringContaining('ProjectB - clean'), 'bound-root');
        expect(recordThreadCommand).toHaveBeenCalledTimes(1);
        expect(selectThreadTarget).not.toHaveBeenCalled();
        expect(resolveThreadReply).not.toHaveBeenCalled();
        expect(deps.enqueueChat).not.toHaveBeenCalled();
        expect(deps.executeFollowUp).not.toHaveBeenCalled();
        const state = new TeamsUserStateStore(tmpDir).get('user-aad-1');
        expect(state.selectedRepo).toBe('ws-1');
        expect(state.selectedTopic).toBeNull();
    });

    it('preserves disabled-thread admission for Git status', async () => {
        const readGitStatus = vi.fn();
        router = new TeamsCommandRouter({ ...deps, readGitStatus, resolveThreadReply: vi.fn(), isAnswerRelayEnabled: () => false });
        await router.handle(makeMsg('git status', { replyToMessageId: 'root' }));
        expect(sendReplySpy).toHaveBeenCalledWith('❌ Teams thread follow-ups are unavailable.', 'root');
        expect(readGitStatus).not.toHaveBeenCalled();
    });

    it('sends every repo in ordered phone-sized chunks, preserving escaping and thread routing', async () => {
        vi.mocked(deps.store.getWorkspaces).mockResolvedValue(Array.from({ length: 400 }, (_, i) => ({
            id: `repo-${i}`, name: `Repo_* <${i}>`, rootPath: path.join(tmpDir, `repo-${i}`),
        })));
        router = new TeamsCommandRouter({
            ...deps, isAnswerRelayEnabled: () => true, recordThreadCommand: vi.fn(),
            readGitStatus: async () => ({
                branch: { branch: 'feature_*', isDetached: false, dirty: false, ahead: 0, behind: 0, unborn: false },
                entries: [], conflicts: 0, trackingAvailable: false,
            }),
        });
        await router.handle(makeMsg('git status', { replyToMessageId: 'root' }));
        expect(sendReplySpy.mock.calls.length).toBeGreaterThan(1);
        const text = sendReplySpy.mock.calls.map(([part]) => part).join('');
        for (let i = 0; i < 400; i++) expect(text).toContain(`Repo\\_\\* <${i}> - clean`);
        const html = sendReplySpy.mock.calls.map(([part]) => formatTeamsOutbound(part)).join('');
        expect(html).toContain('&lt;0&gt;');
        expect(html).not.toContain('<0>');
        for (const [part, root] of sendReplySpy.mock.calls) {
            expect(part.length).toBeLessThanOrEqual(3000);
            expect(root).toBe('root');
        }
        expect(deps.enqueueChat).not.toHaveBeenCalled();
        expect(deps.executeFollowUp).not.toHaveBeenCalled();
    });

    it('lists remote servers and a remote repo\'s topics read-only (shared grammar smoke)', async () => {
        const remotes = {
            list: vi.fn().mockResolvedValue({
                entries: [{ id: 'remote:srv-1:w1', name: 'shortcuts', type: 'repo', server: 'devbox', serverKind: 'ssh', online: true }],
                servers: [{ serverId: 'srv-1', server: 'devbox', serverKind: 'ssh', online: true }],
            }),
            listRemoteChats: vi.fn().mockResolvedValue([{ id: 'r-chat', status: 'completed', title: 'Remote chat' }]),
        };
        router = new TeamsCommandRouter({ ...deps, remotes });
        await router.handle(makeMsg('/list remotes'));
        expect(sendReplySpy.mock.calls[0][0]).toContain('1.1 shortcuts');
        await router.handle(makeMsg('/list topics 1.1'));
        expect(remotes.listRemoteChats).toHaveBeenCalledWith('srv-1', 'w1', 10);
        expect(sendReplySpy.mock.calls[1][0]).toContain('Read-only');
        expect(sendReplySpy.mock.calls[1][0]).toContain('✅ Remote chat');
        expect(sendReplySpy.mock.calls[1][0]).not.toContain('r-chat');
        await router.handle(makeMsg('/list topics 1.1 -v'));
        expect(sendReplySpy.mock.calls[2][0]).toContain('✅ Remote chat · `r-chat`');
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
        expect(sendReplySpy.mock.calls[0][0]).toContain('Repos (3)');
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
        expect(reply.split('\n')).toEqual([
            '**Topics · all repos · last24hours · top5**',
            expect.stringMatching(/^\u2002\u20021\. ⏳ Add feature · ProjectA · now$/),
            expect.stringMatching(/^\u2002\u20022\. ✅ Fix bug · ProjectA · now$/),
            'Reply `select topic <n>` · `list topics -v` for ids',
        ]);
        expect(reply).not.toContain('proc-');
    });

    it('lists topics with ids on -v, escaped titles, and the current-topic marker', async () => {
        (deps.store.getAllProcesses as any).mockResolvedValue([
            { id: 'proc-111', status: 'failed', title: 'Fix *the* <b>bug</b>', startTime: new Date(), metadata: { workspaceId: 'ws-1' } },
        ]);
        await router.handle(makeMsg('/select repo ProjectA'));
        await router.handle(makeMsg('/select topic proc-111'));
        sendReplySpy.mockClear();
        await router.handle(makeMsg('/list topics -v'));
        const reply = sendReplySpy.mock.calls[0][0] as string;
        expect(reply.split('\n')[1]).toBe('▶ 1. ❌ Fix \\*the\\* <b>bug</b> · ProjectA · now · `ws-1/proc-111`');
        expect(reply.split('\n')[2]).toBe('Reply `select topic <n>`');
    });

    it('renders the topic list as safe Teams HTML lines, not a renumbered Markdown list', async () => {
        (deps.store.getAllProcesses as any).mockResolvedValue([
            { id: 'p1', status: 'running', title: 'One', startTime: new Date(), metadata: { workspaceId: 'ws-1' } },
            { id: 'p2', status: 'queued', title: 'Two <script>', startTime: new Date(Date.now() - 2000), metadata: { workspaceId: 'ws-1' } },
            { id: 'p3', status: 'cancelled', title: 'Three', startTime: new Date(Date.now() - 3000), metadata: { workspaceId: 'ws-1' } },
        ]);
        await router.handle(makeMsg('/select repo ProjectA'));
        vi.mocked(deps.store.getProcess).mockResolvedValue({ id: 'p2', status: 'queued', metadata: { workspaceId: 'ws-1' } } as any);
        await router.handle(makeMsg('/select topic 2'));
        sendReplySpy.mockClear();
        await router.handle(makeMsg('/list topics'));
        const html = formatTeamsOutbound(sendReplySpy.mock.calls[0][0] as string, 'markdown');
        expect(html.startsWith('<p>CoC · ')).toBe(true);
        expect(html).not.toMatch(/<ol|<li/);
        expect(html).not.toContain('<script>');
        expect(html).toContain('▶ 2. 🕒 Two &lt;script&gt;');
        expect(html).toContain('\u2002\u20023. ⏹ Three');
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

    it('creates a topic in Global when no repo is selected', async () => {
        await router.handle(makeMsg('/create topic'));
        expect(sendReplySpy.mock.calls[0][0]).toContain('Ready for a new topic');
        await router.handle(makeMsg('Fresh question'));
        expect(deps.enqueueChat).toHaveBeenCalledWith('global-workspace-00', 'Fresh question', undefined);
    });

    // ── select topic ──────────────────────────────────────────

    it('selects an existing topic by ID', async () => {
        await router.handle(makeMsg('/select repo ProjectA'));
        sendReplySpy.mockClear();
        await router.handle(makeMsg('/select topic proc-111'));
        expect(sendReplySpy.mock.calls[0][0]).toContain('Selected topic');
        expect(sendReplySpy.mock.calls[0][0]).toContain('Fix bug');
    });

    it('selects a topic by numeric index', async () => {
        await router.handle(makeMsg('/select repo ProjectA'));
        sendReplySpy.mockClear();
        // Running topics sort before completed topics.
        await router.handle(makeMsg('/select topic 1'));
        expect(sendReplySpy.mock.calls[0][0]).toContain('Selected topic');
        expect(sendReplySpy.mock.calls[0][0]).toContain('Add feature');
    });

    it('selects second topic by numeric index', async () => {
        await router.handle(makeMsg('/select repo ProjectA'));
        sendReplySpy.mockClear();
        await router.handle(makeMsg('/select topic 2'));
        expect(sendReplySpy.mock.calls[0][0]).toContain('Selected topic');
        expect(sendReplySpy.mock.calls[0][0]).toContain('Fix bug');
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
        expect(getAllProcesses).toHaveBeenCalledTimes(2);
        for (const [filter] of getAllProcesses.mock.calls) {
            expect(filter).toEqual({ since: expect.any(Date), limit: 100, offset: 0, exclude: ['conversation', 'toolCalls'] });
        }
        expect(sendReplySpy).toHaveBeenLastCalledWith(expect.stringContaining('Fix bug'), expect.anything());
    });

    // ── explicit chat [chatid] message ────────────────────────

    it('sends message to explicit chat ID', async () => {
        await router.handle(makeMsg('[proc-111] What is the status?'));
        expect(deps.executeFollowUp).toHaveBeenCalledWith('proc-111', 'What is the status?', undefined);
        expect(sendReplySpy.mock.calls[0][0]).toContain('Message sent');
    });

    it('errors on explicit chat with non-existent ID', async () => {
        await router.handle(makeMsg('[bad-id] Hello'));
        expect(sendReplySpy.mock.calls[0][0]).toContain('not found');
    });

    // ── chat (follow-up or create new) ────────────────────────

    it('follows up on selected topic', async () => {
        await router.handle(makeMsg('/select repo ProjectA'));
        await router.handle(makeMsg('/select topic proc-222'));
        sendReplySpy.mockClear();

        await router.handle(makeMsg('How is it going?'));
        expect(deps.executeFollowUp).toHaveBeenCalledWith('proc-222', 'How is it going?', undefined);
    });

    it('creates new topic when no active topic and repo is selected', async () => {
        await router.handle(makeMsg('/select repo ProjectA'));
        sendReplySpy.mockClear();

        await router.handle(makeMsg('Start something new'));
        expect(deps.enqueueChat).toHaveBeenCalledWith('ws-1', 'Start something new', undefined);
        expect(sendReplySpy.mock.calls[0][0]).toContain('New topic created');
    });

    it('starts new chats in Global when no repo is selected, without persisting a selection', async () => {
        await router.handle(makeMsg('Hello world'));
        expect(deps.enqueueChat).toHaveBeenCalledWith('global-workspace-00', 'Hello world', undefined);
        expect(sendReplySpy.mock.calls[0][0]).toContain('New topic created in **Global**');
        expect(new TeamsUserStateStore(tmpDir).get('user-aad-1').selectedRepo).toBeNull();
    });

    it('falls back to Global when the selected repo no longer exists', async () => {
        await router.handle(makeMsg('/select repo ProjectB'));
        (deps.store.getWorkspaces as any).mockResolvedValue([
            { id: 'ws-1', name: 'ProjectA' }, { id: 'global-workspace-00', name: 'Global' },
        ]);
        await router.handle(makeMsg('Hello'));
        expect(deps.enqueueChat).toHaveBeenCalledWith('global-workspace-00', 'Hello', undefined);
        sendReplySpy.mockClear();
        await router.handle(makeMsg('/list topics'));
        expect(sendReplySpy.mock.calls[0][0]).toContain('all repos · last24hours · top5');
    });

    it('replies with a fixed error when neither the selected repo nor Global exists', async () => {
        (deps.store.getWorkspaces as any).mockResolvedValue([{ id: 'ws-1', name: 'ProjectA' }]);
        for (const text of ['Hello', '/create topic']) {
            await router.handle(makeMsg(text));
        }
        expect(sendReplySpy.mock.calls.map(([reply]) => reply)).toEqual(Array(2).fill(
            '❌ The Global workspace is unavailable. Use `list repos`, then `select repo <n|name>`.'));
        expect(deps.enqueueChat).not.toHaveBeenCalled();
    });

    it('selects Global by name, case-insensitively, at its list position', async () => {
        await router.handle(makeMsg('/select repo global'));
        await router.handle(makeMsg('/select repo 3'));
        expect(sendReplySpy.mock.calls.map(([reply]) => reply)).toEqual(Array(2).fill(
            '✅ Selected repo: **Global**. Your next message starts a new chat.'));
    });

    it('select repo starts a fresh chat, even when re-selecting the current repo', async () => {
        await router.handle(makeMsg('/select repo ProjectA'));
        await router.handle(makeMsg('/select topic proc-111'));
        await router.handle(makeMsg('/select repo ProjectA'));
        await router.handle(makeMsg('First'));
        expect(deps.executeFollowUp).not.toHaveBeenCalled();
        expect(deps.enqueueChat).toHaveBeenLastCalledWith('ws-1', 'First', undefined);
        // The new chat becomes the last active topic; switching repo must not resume it.
        await router.handle(makeMsg('/select repo ProjectB'));
        await router.handle(makeMsg('Second'));
        expect(deps.executeFollowUp).not.toHaveBeenCalled();
        expect(deps.enqueueChat).toHaveBeenLastCalledWith('ws-2', 'Second', undefined);
        expect(new TeamsUserStateStore(tmpDir).get('user-aad-1')).toMatchObject({ selectedRepo: 'ws-2', selectedTopic: null });
        // Explicit targeting still wins over the fresh-start selection.
        await router.handle(makeMsg('/select repo ProjectB'));
        await router.handle(makeMsg('[proc-111] Back to the old chat'));
        expect(deps.executeFollowUp).toHaveBeenCalledWith('proc-111', 'Back to the old chat', undefined);
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
        expect(sendReplySpy.mock.calls[1][0]).toContain('Repos (3)');
        expect(deps.enqueueChat).not.toHaveBeenCalled();
    });

    it('replies with help generated from the shared command table', async () => {
        await router.handle(makeMsg('/help'));
        await router.handle(makeMsg('help'));
        for (const [reply] of sendReplySpy.mock.calls) {
            expect(reply).toContain('select repo <n|name|id>');
            expect(reply).toContain('`quota`\nShow AI provider quota');
            const html = formatTeamsOutbound(String(reply), 'markdown');
            for (const group of ['Repos', 'Topics', 'Tools', 'Chat', 'Modes (/ required)']) {
                expect(html).toContain(`<strong>${group}</strong>`);
            }
            expect(html).toContain('<code>select repo &lt;n|name|id&gt;</code>');
            expect(html).toContain('<code>/ask [chatid] What changed?</code>');
            expect(html).not.toMatch(/<table|<pre|`|\*\*|&lt;br/);
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

    it.each([undefined, 'root-quota'])('reports both quota windows in the channel or thread %s without changing selection', async root => {
        deps.getQuota = vi.fn().mockResolvedValue({ lastUpdated: null, providers: [{
            id: 'codex', quotaTypes: [
                { type: 'five_hour', isUnlimitedEntitlement: false, usedRequests: 28,
                    entitlementRequests: 100, remainingPercentage: 0.72, usageAllowedWithExhaustedQuota: false, overage: 0 },
                { type: 'seven_day', isUnlimitedEntitlement: false, usedRequests: 81,
                    entitlementRequests: 100, remainingPercentage: 0.19, usageAllowedWithExhaustedQuota: false, overage: 0 },
            ],
        }] });
        deps.isAnswerRelayEnabled = () => true;
        deps.selectThreadTarget = vi.fn();
        deps.resolveThreadReply = vi.fn().mockResolvedValue({
            process: { id: 'sentinel-b', metadata: { workspaceId: 'ws-2', mode: 'sentinel' } }, workspaceId: 'ws-2',
        });
        router = new TeamsCommandRouter(deps);
        await router.handle(makeMsg('/select repo ProjectB'));
        await router.handle(makeMsg('/select topic proc-222'));
        const selection = new TeamsUserStateStore(tmpDir).get('user-aad-1');
        sendReplySpy.mockClear();
        await router.handle(makeMsg('/quota', { replyToMessageId: root, messageId: 'quota-windows' }));
        expect(sendReplySpy).toHaveBeenCalledOnce();
        expect(sendReplySpy).toHaveBeenCalledWith('codex: 72% left (5h); 19% left (7d)', root ?? 'quota-windows');
        expect(new TeamsUserStateStore(tmpDir).get('user-aad-1')).toEqual(selection);
        expect(deps.selectThreadTarget).not.toHaveBeenCalled();
        expect(deps.enqueueChat).not.toHaveBeenCalled();
        expect(deps.executeFollowUp).not.toHaveBeenCalled();
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
        expect(deps.enqueueChat).toHaveBeenCalledWith('global-workspace-00', 'fix the build', 'autopilot');
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
        expect(deps.enqueueChat).toHaveBeenCalledWith('ws-1', 'Fix the bug', undefined);
    });

    describe('compact', () => {
        let compact: ReturnType<typeof vi.fn>;
        const noTurnStarted = () => {
            expect(deps.enqueueChat).not.toHaveBeenCalled();
            expect(deps.executeFollowUp).not.toHaveBeenCalled();
            expect(deps.admitFollowUp ?? vi.fn()).not.toHaveBeenCalled();
            expect(deps.admitPendingFollowUp ?? vi.fn()).not.toHaveBeenCalled();
        };

        beforeEach(() => {
            compact = vi.fn().mockResolvedValue({ result: { success: true }, tokensBefore: 82_000, tokensAfter: 14_000 });
            deps.compact = compact;
            router = new TeamsCommandRouter(deps);
        });

        it('asks for a topic when none is selected', async () => {
            await router.handle(makeMsg('/compact'));
            expect(sendReplySpy).toHaveBeenLastCalledWith('❌ No topic selected. Use `list topics`, then `select topic <n>`.', expect.any(String));
            expect(compact).not.toHaveBeenCalled();
        });

        it('compacts the selected topic with instructions and keeps the selection', async () => {
            await router.handle(makeMsg('/select repo ProjectA'));
            await router.handle(makeMsg('/select topic proc-111'));
            await router.handle(makeMsg('COMPACT keep the *plan*'));
            expect(compact).toHaveBeenCalledWith(expect.objectContaining({ id: 'proc-111' }), 'keep the *plan*');
            expect(sendReplySpy).toHaveBeenLastCalledWith('🗜️ Compacted "Fix bug" — context 82k → 14k tokens', expect.any(String));
            noTurnStarted();
            await router.handle(makeMsg('/list topics'));
            expect(sendReplySpy.mock.lastCall?.[0]).toMatch(/^▶ 2\. ✅ Fix bug · /m);
        });

        it('maps busy, unsupported, no-session and unknown failures to short replies', async () => {
            const { APIError } = await import('../../../src/server/errors');
            await router.handle(makeMsg('/select repo ProjectA'));
            await router.handle(makeMsg('/select topic proc-111'));
            const error = vi.spyOn(console, 'error').mockImplementation(() => {});
            const cases: Array<[unknown, string]> = [
                [new APIError(409, 'x', 'CONVERSATION_NOT_IDLE'), 'Chat is busy — try compact again when the current turn finishes.'],
                [new APIError(422, 'x', 'COMPACT_UNSUPPORTED'), "This chat's provider doesn't support compaction."],
                [new APIError(400, 'x', 'BAD_REQUEST'), 'This chat has no active session to compact yet.'],
                [new Error('private provider detail'), 'Could not compact this chat. Please try again later.'],
            ];
            for (const [failure, text] of cases) {
                compact.mockRejectedValueOnce(failure);
                await router.handle(makeMsg('compact'));
                expect(sendReplySpy).toHaveBeenLastCalledWith(text, expect.any(String));
            }
            error.mockRestore();
            noTurnStarted();
        });

        it('compacts the bound thread chat, records the command, and never dispatches to AI', async () => {
            deps.isAnswerRelayEnabled = () => true;
            deps.recordThreadCommand = vi.fn();
            deps.hasThreadCommand = vi.fn().mockReturnValue(false);
            deps.admitFollowUp = vi.fn();
            deps.admitPendingFollowUp = vi.fn();
            deps.resolveThreadReply = vi.fn().mockImplementation(async (msg: InboundTeamsMessage) =>
                msg.replyToMessageId === 'root-a'
                    ? { process: { id: 'proc-111', metadata: { workspaceId: 'ws-1' } }, workspaceId: 'ws-1' }
                    : msg.replyToMessageId === 'root-new' ? { workspaceId: 'ws-1' } : null);
            router = new TeamsCommandRouter(deps);
            // A different selected topic must not win over the thread's chat.
            await router.handle(makeMsg('/select topic proc-222'));
            const reply = makeMsg('/compact', { replyToMessageId: 'root-a' });
            await router.handle(reply);
            expect(compact).toHaveBeenCalledWith(expect.objectContaining({ id: 'proc-111' }), undefined);
            expect(deps.recordThreadCommand).toHaveBeenCalledWith(reply);
            expect(sendReplySpy).toHaveBeenLastCalledWith('🗜️ Compacted "Fix bug" — context 82k → 14k tokens', 'root-a');
            await router.handle(makeMsg('compact', { replyToMessageId: 'root-new' }));
            expect(sendReplySpy).toHaveBeenLastCalledWith(expect.stringContaining('No topic selected in this thread'), 'root-new');
            expect(compact).toHaveBeenCalledTimes(1);
            noTurnStarted();
        });
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
            expect(getAllProcesses).toHaveBeenCalledOnce();
            expect(getAllProcesses).toHaveBeenCalledWith({ since: expect.any(Date), limit: 100, offset: 0, exclude: ['conversation', 'toolCalls'] });
            expect(deps.selectThreadTarget).toHaveBeenCalledWith(expect.any(Object), 'ws-1', 'proc-222');
        });

        it('shares cross-repo ranking with channel commands while keeping each thread numbering isolated', async () => {
            const beta = { id: 'beta', title: 'Beta pinned', status: 'completed', startTime: new Date(), pinnedAt: new Date().toISOString(), metadata: { workspaceId: 'ws-2' } };
            const alpha = { id: 'alpha', title: 'Alpha running', status: 'running', startTime: new Date(), metadata: { workspaceId: 'ws-1' } };
            vi.mocked(deps.store.getAllProcesses).mockResolvedValue([alpha, beta] as any);
            vi.mocked(deps.store.getProcess).mockImplementation(async (id, workspaceId) => [alpha, beta].find(p => p.id === id && p.metadata.workspaceId === workspaceId) as any);
            await router.handle(makeMsg('/list topics -v'));
            await router.handle(makeMsg('/list topics -v', { replyToMessageId: 'root-a' }));
            const channel = sendReplySpy.mock.calls[0][0];
            const thread = sendReplySpy.mock.calls[1][0];
            expect(channel.split('\n').slice(0, 3)).toEqual(thread.split('\n').slice(0, 3));
            expect(thread).toContain('1. ✅ Beta pinned · ProjectB · now · `ws-2/beta`');
            vi.mocked(deps.store.getAllProcesses).mockResolvedValue([alpha] as any);
            await router.handle(makeMsg('/list topics', { replyToMessageId: 'root-b' }));
            await router.handle(makeMsg('/select topic 1', { replyToMessageId: 'root-a' }));
            expect(deps.selectThreadTarget).toHaveBeenLastCalledWith(expect.objectContaining({ replyToMessageId: 'root-a' }), 'ws-2', 'beta');
            await router.handle(makeMsg('/select topic 1', { replyToMessageId: 'root-b' }));
            expect(deps.selectThreadTarget).toHaveBeenLastCalledWith(expect.objectContaining({ replyToMessageId: 'root-b' }), 'ws-1', 'alpha');
            await router.handle(makeMsg('/select topic ws-2/beta', { replyToMessageId: 'root-b' }));
            expect(deps.selectThreadTarget).toHaveBeenLastCalledWith(expect.objectContaining({ replyToMessageId: 'root-b' }), 'ws-2', 'beta');
        });

        it('lists thread topics in the shared format, marking the bound chat, with / footer commands', async () => {
            deps.resolveThreadReply = vi.fn().mockResolvedValue({ process: { id: 'proc-222', metadata: { workspaceId: 'ws-1' } }, workspaceId: 'ws-1' });
            router = new TeamsCommandRouter(deps);
            await router.handle(makeMsg('/list topics', { replyToMessageId: 'root-a' }));
            expect(sendReplySpy.mock.calls[0][0].split('\n')).toEqual([
                '**Topics · all repos · last24hours · top5**',
                expect.stringMatching(/^▶ 1\. ⏳ Add feature · ProjectA · now$/),
                expect.stringMatching(/^\u2002\u20022\. ✅ Fix bug · ProjectA · now$/),
                'Reply `/select topic <n>` · `/list topics -v` for ids',
            ]);
            await router.handle(makeMsg('/list topics -v', { replyToMessageId: 'root-a' }));
            expect(sendReplySpy.mock.calls[1][0]).toContain('Fix bug · ');
            expect(sendReplySpy.mock.calls[1][0]).toMatch(/Add feature · ProjectA · now · `ws-1\/proc-222`/);
            expect(sendReplySpy.mock.calls[1][0].split('\n').at(-1)).toBe('Reply `/select topic <n>`');
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
                expect.any(Object), expect.objectContaining({ id: 'proc-b' }), '[proc-111] explicit chat', undefined);
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
            expect(sendReplySpy.mock.calls.map(([, root]) => root)).toEqual(['root-a', 'root-a', 'root-a']);
            expect(sendReplySpy.mock.calls[0][0]).toContain('**CoC help**');
            expect(sendReplySpy.mock.calls[2][0]).toContain(sendReplySpy.mock.calls[0][0]);
            const html = formatTeamsOutbound(sendReplySpy.mock.calls[0][0], 'markdown');
            expect(html).toContain('<strong>Topics</strong>');
            expect(html).toContain('<code>list topics [ref] [-v]</code>');
            expect(sendReplySpy.mock.calls[1][0]).toBe('copilot: no quota data');
            expect(sendReplySpy.mock.calls[2][0]).toContain('Unknown command');
            expect(recordThreadCommand).toHaveBeenCalledTimes(3);
            expect(deps.admitFollowUp).toHaveBeenCalledTimes(1);
            expect(deps.admitFollowUp).toHaveBeenCalledWith(
                expect.any(Object), expect.objectContaining({ id: 'proc-a' }), 'ship it', 'autopilot');
            expect(deps.acknowledgeFollowUp).toHaveBeenCalledWith(expect.objectContaining({ text: '/autopilot ship it' }));
        });

        it('rejects mismatched workspace ownership and missing topics without changing the thread', async () => {
            const msg = (text: string) => makeMsg(text, { replyToMessageId: 'root-a' });
            vi.mocked(deps.store.getProcess).mockResolvedValueOnce({ id: 'proc-other', status: 'completed', metadata: { workspaceId: 'ws-2' } } as any);
            await router.handle(msg('/select topic proc-other'));
            await router.handle(msg('/select topic missing'));
            expect(sendReplySpy.mock.calls[0][0]).toContain('not found or unavailable');
            expect(sendReplySpy.mock.calls[1][0]).toContain('not found or unavailable');
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
            await router.handle(makeMsg('/select repo ProjectA'));
            await router.handle(makeMsg('/select topic proc-111'));
            sendReplySpy.mockClear();
            const reply = makeMsg('queued reply', { replyToMessageId: 'pending' });
            await router.handle(reply);
            expect(deps.admitPendingFollowUp).toHaveBeenCalledWith(reply, 'task-pending', 'queued reply', undefined);
            expect(sendReplySpy).not.toHaveBeenCalled();
            expect(deps.acknowledgeFollowUp).toHaveBeenCalledWith(reply);
            await router.handle(makeMsg('ordinary message'));
            expect(deps.admitFollowUp).toHaveBeenCalledWith(
                expect.any(Object), expect.objectContaining({ id: 'proc-111' }), 'ordinary message', undefined);
        });

        it('passes the follow-up mode through as typed so plain text keeps the chat mode', async () => {
            await router.handle(makeMsg('/select repo ProjectA'));
            await router.handle(makeMsg('/select topic proc-111'));
            const modes: Array<[string, string | undefined]> = [
                ['keep going', undefined], ['/ask just look', 'ask'], ['/autopilot fix it', 'autopilot'],
            ];
            for (const [text, mode] of modes) {
                await router.handle(makeMsg(text));
                expect(deps.admitFollowUp).toHaveBeenLastCalledWith(
                    expect.any(Object), expect.objectContaining({ id: 'proc-111' }), expect.any(String), mode);
                await router.handle(makeMsg(text, { replyToMessageId: 'pending' }));
                expect(deps.admitPendingFollowUp).toHaveBeenLastCalledWith(
                    expect.any(Object), 'task-pending', expect.any(String), mode);
            }
        });

        it.each([
            ['root-a', 'proc-a', 'ws-1'],
            ['root-b', 'proc-b', 'ws-2'],
        ])('silently acknowledges an accepted follow-up in %s', async (root, processId, workspaceId) => {
            const reply = makeMsg('Continue', { replyToMessageId: root });
            const observe = vi.fn();
            await router.handle(reply, observe);
            expect(deps.admitFollowUp).toHaveBeenCalledExactlyOnceWith(
                reply, expect.objectContaining({ id: processId, metadata: { workspaceId } }), 'Continue', undefined);
            expect(deps.acknowledgeFollowUp).toHaveBeenCalledExactlyOnceWith(reply);
            expect(observe).toHaveBeenCalledExactlyOnceWith('dispatch-follow-up');
            expect(sendReplySpy).not.toHaveBeenCalled();
        });

        it('preserves new-chat confirmations and acknowledges even if the confirmation fails', async () => {
            deps.resolveThreadReply = vi.fn().mockResolvedValue({ workspaceId: 'ws-2' });
            deps.admitThreadNew = vi.fn().mockResolvedValue({ taskId: 'thread-new', duplicate: false });
            deps.acknowledgeNewChat = vi.fn().mockResolvedValue(undefined);
            const reply = makeMsg('Start a chat', { replyToMessageId: 'root-b' });
            await router.handle(reply);
            expect(deps.admitThreadNew).toHaveBeenCalledExactlyOnceWith(reply, 'ws-2', 'Start a chat', undefined);
            expect(sendReplySpy).toHaveBeenCalledExactlyOnceWith(
                expect.stringContaining('New chat started in the selected repo'), 'root-b');
            expect(deps.acknowledgeNewChat).toHaveBeenCalledExactlyOnceWith('thread-new');
            expect(deps.acknowledgeFollowUp).not.toHaveBeenCalled();

            sendReplySpy.mockRejectedValueOnce(new Error('confirmation failed'));
            await router.handle(makeMsg('Another chat', { replyToMessageId: 'root-b' }));
            expect(deps.acknowledgeNewChat).toHaveBeenCalledTimes(2);
            expect(sendReplySpy).toHaveBeenLastCalledWith(expect.stringContaining('unavailable'), 'root-b');
        });

        it('reports follow-up admission and acknowledgment failures in the thread', async () => {
            vi.mocked(deps.admitFollowUp!).mockRejectedValueOnce(new Error('private admission failure'));
            await router.handle(makeMsg('Continue', { replyToMessageId: 'root-a' }));
            expect(deps.acknowledgeFollowUp).not.toHaveBeenCalled();
            expect(sendReplySpy).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('unavailable'), 'root-a');

            sendReplySpy.mockClear();
            vi.mocked(deps.acknowledgeFollowUp!).mockRejectedValueOnce(new Error('private persistence failure'));
            await router.handle(makeMsg('Continue again', { replyToMessageId: 'root-b' }));
            expect(deps.acknowledgeFollowUp).toHaveBeenCalledOnce();
            expect(sendReplySpy).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('unavailable'), 'root-b');
            expect(sendReplySpy.mock.lastCall?.[0]).not.toContain('private');
        });

        it('ignores historical questions without admission, acknowledgment or confirmation', async () => {
            await router.handle({
                ...makeMsg('Old question', { replyToMessageId: 'root-a' }),
                historicalSelectionReplay: true,
            });
            expect(deps.admitFollowUp).not.toHaveBeenCalled();
            expect(deps.acknowledgeFollowUp).not.toHaveBeenCalled();
            expect(sendReplySpy).not.toHaveBeenCalled();
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

            vi.mocked(deps.admitPendingFollowUp!).mockResolvedValueOnce({ duplicate: true });
            await router.handle(makeMsg('duplicate pending', { replyToMessageId: 'pending' }));
            expect(sendReplySpy).not.toHaveBeenCalled();
            expect(deps.acknowledgeFollowUp).not.toHaveBeenCalled();

            deps.isAnswerRelayEnabled = () => false;
            await router.handle(makeMsg('new topic', { replyToMessageId: 'root-a' }));
            expect(deps.resolveThreadReply).toHaveBeenCalledTimes(2);
            expect(deps.enqueueChat).not.toHaveBeenCalled();
            expect(sendReplySpy).toHaveBeenCalledWith(expect.stringContaining('unavailable'), 'root-a');
        });
    });
});
