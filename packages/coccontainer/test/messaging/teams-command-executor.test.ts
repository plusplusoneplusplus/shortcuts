/**
 * Tests for the Teams command executor (container-side).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamsCommandExecutor, type TeamsCommandExecutorDeps, type ProcessInfo } from '../../src/messaging/teams-command-executor';
import type { InboundTeamsMessage } from '@plusplusoneplusplus/teams-bot';

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

function createMockDeps(): TeamsCommandExecutorDeps {
    const mockAgents = [
        {
            id: 'agent-1',
            name: 'Agent-Dev1',
            ws: {} as any,
            lastHeartbeat: Date.now(),
            workspaces: [
                { id: 'ws-1', name: 'ProjectA', rootPath: '/repo/projectA' },
                { id: 'ws-2', name: 'ProjectB', rootPath: '/repo/projectB' },
            ],
        },
        {
            id: 'agent-2',
            name: 'Agent-Dev2',
            ws: {} as any,
            lastHeartbeat: Date.now(),
            workspaces: [
                { id: 'ws-3', name: 'ProjectC', rootPath: '/repo/projectC' },
            ],
        },
    ];

    const mockProcesses: ProcessInfo[] = [
        { id: 'proc-111', status: 'completed', title: 'Fix bug', promptPreview: 'Fix the bug', startTime: '2025-01-02T00:00:00Z' },
        { id: 'proc-222', status: 'running', title: 'Add feature', promptPreview: 'Add a feature', startTime: '2025-01-01T00:00:00Z' },
    ];

    return {
        inboundManager: {
            listAgents: vi.fn().mockReturnValue(mockAgents),
        } as any,
        agentStore: {
            list: vi.fn().mockReturnValue([]),
        } as any,
        messagingStore: {} as any,
        fetchProcess: vi.fn().mockImplementation(async (_agentId: string, processId: string) => {
            return mockProcesses.find(p => p.id === processId) ?? null;
        }),
        listProcesses: vi.fn().mockResolvedValue(mockProcesses),
    };
}

describe('TeamsCommandExecutor', () => {
    let deps: TeamsCommandExecutorDeps;
    let executor: TeamsCommandExecutor;

    beforeEach(() => {
        deps = createMockDeps();
        executor = new TeamsCommandExecutor(deps);
    });

    // ── Non-commands are not handled ──────────────────────

    it('does not handle plain messages', async () => {
        const result = await executor.tryExecute(makeMsg('Hello world'));
        expect(result.handled).toBe(false);
    });

    it('does not handle messages without / prefix', async () => {
        const result = await executor.tryExecute(makeMsg('list agents'));
        expect(result.handled).toBe(false);
    });

    // ── /list agents ─────────────────────────────────────

    it('lists connected agents without repo names', async () => {
        const result = await executor.tryExecute(makeMsg('/list agents'));
        expect(result.handled).toBe(true);
        expect(result.response).toContain('Agent-Dev1');
        expect(result.response).toContain('Agent-Dev2');
        expect(result.response).toContain('connected');
        // Should NOT include repo names in agent listing
        expect(result.response).not.toContain('ProjectA');
        expect(result.response).not.toContain('repo(s)');
    });

    it('handles no agents', async () => {
        (deps.inboundManager.listAgents as any).mockReturnValue([]);
        const result = await executor.tryExecute(makeMsg('/list agents'));
        expect(result.handled).toBe(true);
        expect(result.response).toContain('No agents');
    });

    // ── /list repos ──────────────────────────────────────

    it('lists repos with agent name', async () => {
        const result = await executor.tryExecute(makeMsg('/list repos'));
        expect(result.handled).toBe(true);
        expect(result.response).toContain('**ProjectA**, agent:Agent-Dev1');
        expect(result.response).toContain('**ProjectB**, agent:Agent-Dev1');
        expect(result.response).toContain('**ProjectC**, agent:Agent-Dev2');
        expect(result.response).toContain('3');
    });

    // ── /select repo ─────────────────────────────────────

    it('selects repo by name', async () => {
        const result = await executor.tryExecute(makeMsg('/select repo ProjectA'));
        expect(result.handled).toBe(true);
        expect(result.response).toContain('Selected repo');
        expect(result.response).toContain('ProjectA');

        const state = executor.getUserState('user-aad-1');
        expect(state.selectedAgentId).toBe('agent-1');
        expect(state.selectedWorkspaceId).toBe('ws-1');
    });

    it('selects repo by numeric index', async () => {
        const result = await executor.tryExecute(makeMsg('/select repo 3'));
        expect(result.handled).toBe(true);
        expect(result.response).toContain('ProjectC');
    });

    it('errors on unknown repo', async () => {
        const result = await executor.tryExecute(makeMsg('/select repo NonExistent'));
        expect(result.handled).toBe(true);
        expect(result.response).toContain('not found');
    });

    // ── /list topics ─────────────────────────────────────

    it('lists topics after selecting repo', async () => {
        await executor.tryExecute(makeMsg('/select repo ProjectA'));
        const result = await executor.tryExecute(makeMsg('/list topics'));
        expect(result.handled).toBe(true);
        expect(result.response).toContain('Fix bug');
        expect(result.response).toContain('Add feature');
    });

    it('requires agent selection for list topics', async () => {
        const result = await executor.tryExecute(makeMsg('/list topics'));
        expect(result.handled).toBe(true);
        expect(result.response).toContain('No agent selected');
    });

    // ── /create topic ────────────────────────────────────

    it('creates topic (clears selection)', async () => {
        await executor.tryExecute(makeMsg('/select repo ProjectA'));
        // Select a topic first
        executor.updateUserState('user-aad-1', { selectedTopicId: 'old-topic' });

        const result = await executor.tryExecute(makeMsg('/create topic'));
        expect(result.handled).toBe(true);
        expect(result.response).toContain('Ready for a new topic');

        const state = executor.getUserState('user-aad-1');
        expect(state.selectedTopicId).toBeNull();
        expect(state.lastActiveTopicId).toBeNull();
    });

    it('errors on create topic without repo', async () => {
        const result = await executor.tryExecute(makeMsg('/create topic'));
        expect(result.handled).toBe(true);
        expect(result.response).toContain('No repo selected');
    });

    // ── /select topic ────────────────────────────────────

    it('selects topic by ID', async () => {
        await executor.tryExecute(makeMsg('/select repo ProjectA'));
        const result = await executor.tryExecute(makeMsg('/select topic proc-111'));
        expect(result.handled).toBe(true);
        expect(result.response).toContain('Selected topic');
        expect(result.response).toContain('Fix bug');
    });

    it('selects topic by numeric index', async () => {
        await executor.tryExecute(makeMsg('/select repo ProjectA'));
        const result = await executor.tryExecute(makeMsg('/select topic 2'));
        expect(result.handled).toBe(true);
        expect(result.response).toContain('Add feature');
    });

    it('errors on non-existent topic', async () => {
        await executor.tryExecute(makeMsg('/select repo ProjectA'));
        (deps.fetchProcess as any).mockResolvedValue(null);
        const result = await executor.tryExecute(makeMsg('/select topic bad-id'));
        expect(result.handled).toBe(true);
        expect(result.response).toContain('not found');
    });

    // ── /help ────────────────────────────────────────────

    it('shows help', async () => {
        const result = await executor.tryExecute(makeMsg('/help'));
        expect(result.handled).toBe(true);
        expect(result.response).toContain('Available Commands');
        expect(result.response).toContain('/list agents');
        expect(result.response).toContain('/select repo');
    });

    // ── Unknown /commands ────────────────────────────────

    it('does not handle unknown /commands', async () => {
        const result = await executor.tryExecute(makeMsg('/unknown-command'));
        expect(result.handled).toBe(false);
    });

    // ── Per-user isolation ───────────────────────────────

    it('isolates state between users', async () => {
        await executor.tryExecute(makeMsg('/select repo ProjectA', { senderAadId: 'user-A' }));
        await executor.tryExecute(makeMsg('/select repo ProjectC', { senderAadId: 'user-B' }));

        const stateA = executor.getUserState('user-A');
        const stateB = executor.getUserState('user-B');
        expect(stateA.selectedWorkspaceId).toBe('ws-1');
        expect(stateB.selectedWorkspaceId).toBe('ws-3');
    });

    // ── Error handling ───────────────────────────────────

    it('catches and reports errors', async () => {
        (deps.inboundManager.listAgents as any).mockImplementation(() => { throw new Error('Connection failed'); });
        const result = await executor.tryExecute(makeMsg('/list agents'));
        expect(result.handled).toBe(true);
        expect(result.response).toContain('Connection failed');
    });
});
