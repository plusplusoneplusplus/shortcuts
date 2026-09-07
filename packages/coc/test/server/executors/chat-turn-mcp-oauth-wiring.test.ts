/**
 * MCP OAuth wiring across both chat turn paths.
 *
 * An MCP server can demand interactive OAuth on any turn, not just the one
 * that opened the session. `onMcpOAuthRequired` used to be wired on the
 * first-turn path only, so a server that asked mid-conversation was silently
 * untracked: no pending entry, no `mcp-oauth-required` event, no dashboard
 * prompt — the turn just failed to reach that server.
 *
 * Both paths now take the handler from `buildChatTurnSendOptions`, and these
 * tests are the fence.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AIProcess, QueuedTask } from '@plusplusoneplusplus/forge';
import { ChatExecutor } from '../../../src/server/executors/chat-executor';
import { FollowUpExecutor } from '../../../src/server/executors/follow-up-executor';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { nestRuntime } from './runtime-options-helper';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        promises: {
            ...actual.promises,
            readdir: vi.fn().mockResolvedValue([]),
            mkdir: vi.fn().mockResolvedValue(undefined),
        },
    };
});

vi.mock('../../../src/server/executors/image-store', () => ({
    saveImagesToTempFiles: vi.fn().mockReturnValue({ tempDir: undefined, attachments: [] }),
    cleanupTempDir: vi.fn(),
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/server/tasks/task-root-resolver', () => ({
    resolveTaskRoot: vi.fn().mockReturnValue({ absolutePath: '/tasks-root' }),
}));

vi.mock('../../../src/server/processes/output-file-manager', () => ({
    OutputFileManager: {
        saveOutput: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../../src/server/streaming/sse-handler', () => ({
    emitMessageSteering: vi.fn(),
}));

// ============================================================================
// Fixtures
// ============================================================================

const sdkMocks = createMockSDKService();

const OAUTH_EVENT = {
    serverName: 'github',
    serverUrl: 'https://mcp.example/github',
    authorizationUrl: 'https://mcp.example/authorize',
    requestId: 'req-1',
    sessionId: 'sess-1',
};

function makeManager() {
    const addPending = vi.fn().mockReturnValue({ id: 'entry-1', status: 'pending' });
    return { manager: { addPending } as any, addPending };
}

function makeOptions(manager: unknown) {
    return nestRuntime({
        aiService: sdkMocks.service as any,
        defaultTimeoutMs: 30_000,
        followUpSuggestions: { enabled: false, count: 3 },
        askUser: { enabled: false },
        resolveSkillConfig: vi.fn().mockResolvedValue({ skillDirectories: undefined, disabledSkills: undefined }),
        resolveWorkspaceIdForPath: vi.fn().mockResolvedValue('ws-1'),
        resolveAiServiceForProvider: () => sdkMocks.service as any,
        getMcpOauthManager: () => manager,
    }) as any;
}

function makeChatTask(id: string): QueuedTask {
    return {
        id,
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: { kind: 'chat', mode: 'ask', prompt: 'open the server', workspaceId: 'ws-1' },
        config: {},
        displayName: 'open the server',
    } as QueuedTask;
}

function makeProcess(id: string): AIProcess {
    return {
        id,
        type: 'chat',
        status: 'completed',
        startTime: new Date(),
        promptPreview: 'initial prompt',
        sdkSessionId: 'sess-1',
        metadata: { type: 'chat', workspaceId: 'ws-1', mode: 'ask' },
        conversationTurns: [
            { role: 'user', content: 'Hello', timestamp: new Date(), turnIndex: 0, timeline: [] },
            { role: 'assistant', content: 'Hi there', timestamp: new Date(), turnIndex: 1, timeline: [] },
        ],
    } as AIProcess;
}

/** Fire the SDK's OAuth event from inside the turn, as a real session would. */
function replyWithOAuthEvent() {
    sdkMocks.mockSendMessage.mockImplementation(async (options: any) => {
        options.onMcpOAuthRequired?.(OAUTH_EVENT);
        return { success: true, response: 'ok', sessionId: 'sess-1' };
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('MCP OAuth wiring', () => {
    beforeEach(() => {
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        replyWithOAuthEvent();
    });

    it('registers the pending entry and emits the event on a first turn', async () => {
        const { manager, addPending } = makeManager();
        const store = createMockProcessStore();

        await new ChatExecutor(store, makeOptions(manager)).execute(makeChatTask('task-oauth'), 'open the server');

        expect(addPending).toHaveBeenCalledWith(expect.objectContaining({
            requestId: 'req-1',
            serverName: 'github',
            processId: 'queue_task-oauth',
            workspaceId: 'ws-1',
            originalMessage: 'open the server',
        }));
        const emitted = (store.emitProcessEvent as any).mock.calls
            .find((call: any[]) => call[1]?.type === 'mcp-oauth-required');
        expect(emitted?.[1].mcpOAuth).toEqual({
            requestId: 'entry-1',
            serverName: 'github',
            serverUrl: 'https://mcp.example/github',
            authorizationUrl: 'https://mcp.example/authorize',
        });
    });

    it('registers the pending entry and emits the event on a follow-up turn', async () => {
        const { manager, addPending } = makeManager();
        const store = createMockProcessStore();
        await store.addProcess(makeProcess('proc-oauth'));

        await new FollowUpExecutor(store, makeOptions(manager))
            .executeFollowUp('proc-oauth', 'now use the server', undefined, 'ask');

        expect(addPending).toHaveBeenCalledWith(expect.objectContaining({
            requestId: 'req-1',
            serverName: 'github',
            processId: 'proc-oauth',
            workspaceId: 'ws-1',
            // The follow-up message is what gets replayed after authorization,
            // not the prompt that opened the chat.
            originalMessage: 'now use the server',
        }));
        const emitted = (store.emitProcessEvent as any).mock.calls
            .find((call: any[]) => call[1]?.type === 'mcp-oauth-required');
        expect(emitted?.[1].mcpOAuth.requestId).toBe('entry-1');
    });

    it('leaves the handler unset on both paths when no manager is wired', async () => {
        const chatStore = createMockProcessStore();
        await new ChatExecutor(chatStore, makeOptions(undefined)).execute(makeChatTask('task-no-mgr'), 'hi');
        expect((sdkMocks.mockSendMessage.mock.calls[0][0] as any).onMcpOAuthRequired).toBeUndefined();

        const followUpStore = createMockProcessStore();
        await followUpStore.addProcess(makeProcess('proc-no-mgr'));
        await new FollowUpExecutor(followUpStore, makeOptions(undefined))
            .executeFollowUp('proc-no-mgr', 'next', undefined, 'ask');
        expect((sdkMocks.mockSendMessage.mock.calls[1][0] as any).onMcpOAuthRequired).toBeUndefined();
    });
});
