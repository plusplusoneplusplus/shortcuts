/**
 * Tests for the Teams command router and user state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseCommand, TeamsCommandRouter, type TeamsCommandRouterDeps } from '../../../src/server/messaging/teams-command-router';
import { TeamsUserStateStore } from '../../../src/server/messaging/teams-user-state';
import type { InboundTeamsMessage } from '@plusplusoneplusplus/teams-bot';

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

    it('creates topic when repo is selected', async () => {
        await router.handle(makeMsg('/select repo ProjectA'));
        sendReplySpy.mockClear();

        await router.handle(makeMsg('/create topic'));
        expect(deps.enqueueChat).toHaveBeenCalledWith('ws-1', '(New topic created from Teams)');
        expect(sendReplySpy.mock.calls[0][0]).toContain('Created new chat topic');
    });

    it('errors on create topic without repo', async () => {
        await router.handle(makeMsg('/create topic'));
        expect(sendReplySpy.mock.calls[0][0]).toContain('No repo selected');
    });

    // ── select topic ──────────────────────────────────────────

    it('selects an existing topic', async () => {
        await router.handle(makeMsg('/select topic proc-111'));
        expect(sendReplySpy.mock.calls[0][0]).toContain('Selected topic');
        expect(sendReplySpy.mock.calls[0][0]).toContain('Fix bug');
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

        // user-A creates topic in ProjectA
        await router.handle(makeMsg('/create topic', { senderAadId: 'user-A' }));
        expect(deps.enqueueChat).toHaveBeenCalledWith('ws-1', expect.any(String));
    });
});
