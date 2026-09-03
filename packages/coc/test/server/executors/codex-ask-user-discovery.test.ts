/**
 * Codex `ask_user` discovery
 *
 * Codex models in `code_mode_only` (e.g. `gpt-5.6-sol`) never see a bare
 * top-level `ask_user` declaration — CoC's MCP tools are deferred behind
 * `functions.exec` under the `mcp__coc_llm_tools__` prefix. Skills name the
 * tool as plain `ask_user`, so without a mapping the model reported the tool as
 * missing, confused it with the Codex built-in `request_user_input`, and asked
 * the user to switch to Plan mode instead of opening the structured widget.
 *
 * These tests are the executor-level fence: whenever a Codex turn actually
 * carries `ask_user`, it must also carry the discovery block — and when a
 * workspace preference removes the tool, neither may be sent.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AIProcess, QueuedTask } from '@plusplusoneplusplus/forge';
import { ChatExecutor } from '../../../src/server/executors/chat-executor';
import { AutopilotExecutor } from '../../../src/server/executors/autopilot-executor';
import { FollowUpExecutor } from '../../../src/server/executors/follow-up-executor';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { nestRuntime, type FlatExecutorOptions } from './runtime-options-helper';

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

// Autopilot opts out of Memory V2 while ask does not; stub it to a constant so
// the ask/autopilot byte-equality assertion stays about the discovery block.
vi.mock('../../../src/server/executors/memory-v2-addon', () => ({
    buildMemoryV2Addon: vi.fn().mockResolvedValue({
        tools: [],
        suffix: '',
        systemMessageSuffix: undefined,
        excludedBuiltinTools: [],
        dispose: vi.fn(),
    }),
}));

// ============================================================================
// Helpers
// ============================================================================

const MARKER = '<codex-ask-user-discovery>';
const DEFERRED_NAME = 'mcp__coc_llm_tools__ask_user';

const sdkMocks = createMockSDKService();

function makeOptions(overrides?: FlatExecutorOptions) {
    return nestRuntime({
        aiService: sdkMocks.service as any,
        defaultTimeoutMs: 30_000,
        followUpSuggestions: { enabled: false, count: 3 },
        askUser: { enabled: true },
        resolveSkillConfig: vi.fn().mockResolvedValue({ skillDirectories: undefined, disabledSkills: undefined }),
        resolveWorkspaceIdForPath: vi.fn().mockResolvedValue('ws-id'),
        resolveAiServiceForProvider: (_provider: any) => sdkMocks.service as any,
        ...overrides,
    }) as any;
}

function makeChatTask(
    id: string,
    opts: { mode?: 'ask' | 'autopilot'; provider?: string; grilling?: boolean } = {},
): QueuedTask {
    return {
        id,
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            mode: opts.mode ?? 'ask',
            prompt: 'Hello',
            provider: opts.provider ?? 'codex',
            ...(opts.grilling ? { context: { ralph: { phase: 'grilling' } } } : {}),
        },
        config: {},
        displayName: 'Hello',
    } as unknown as QueuedTask;
}

function makeProcess(id: string, provider: string): AIProcess {
    return {
        id,
        type: 'chat',
        status: 'completed',
        startTime: new Date(),
        promptPreview: 'initial prompt',
        metadata: { type: 'chat', workspaceId: 'ws-1', mode: 'ask', provider },
        conversationTurns: [
            { role: 'user', content: 'Hello', timestamp: new Date(), turnIndex: 0, timeline: [] },
            { role: 'assistant', content: 'Hi there', timestamp: new Date(), turnIndex: 1, timeline: [] },
        ],
    } as unknown as AIProcess;
}

function sentCall(callIndex: number): { tools: string[]; systemMessage: string } {
    const call = sdkMocks.mockSendMessage.mock.calls[callIndex][0] as any;
    return {
        tools: (call.tools ?? []).map((tool: any) => tool.name),
        systemMessage: call.systemMessage?.content ?? '',
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('Codex ask_user discovery block (executor wiring)', () => {
    beforeEach(() => {
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({ success: true, response: 'ok', sessionId: 's1' });
    });

    it('sends the block and the tool on a Codex ask-mode first turn', async () => {
        const store = createMockProcessStore();
        await new ChatExecutor(store, makeOptions()).execute(makeChatTask('task-codex-ask'), 'Hello');

        const { tools, systemMessage } = sentCall(0);
        expect(tools).toContain('ask_user');
        expect(systemMessage).toContain(MARKER);
        expect(systemMessage).toContain(DEFERRED_NAME);
    });

    it('sends the block on a Codex Ralph grilling turn, where a skill demands ask_user', async () => {
        const store = createMockProcessStore();
        await new ChatExecutor(store, makeOptions())
            .execute(makeChatTask('task-codex-grill', { grilling: true }), 'Grill me');

        const { tools, systemMessage } = sentCall(0);
        expect(tools).toContain('ask_user');
        expect(systemMessage).toContain(MARKER);
    });

    it('sends the block on a Codex interactive follow-up', async () => {
        const store = createMockProcessStore();
        await store.addProcess(makeProcess('proc-codex-follow', 'codex'));
        await new FollowUpExecutor(store, makeOptions())
            .executeFollowUp('proc-codex-follow', 'next', undefined, 'ask');

        const { tools, systemMessage } = sentCall(0);
        expect(tools).toContain('ask_user');
        expect(systemMessage).toContain(MARKER);
        expect(systemMessage).toContain(DEFERRED_NAME);
    });

    it('omits both the tool and the block when ask_user is disabled', async () => {
        const opts = makeOptions({ askUser: { enabled: false } });
        const store = createMockProcessStore();
        await new ChatExecutor(store, opts).execute(makeChatTask('task-codex-off'), 'Hello');

        const { tools, systemMessage } = sentCall(0);
        expect(tools).not.toContain('ask_user');
        expect(systemMessage).not.toContain(MARKER);
    });

    it('omits the block for a non-Codex provider that still gets the tool', async () => {
        const store = createMockProcessStore();
        await new ChatExecutor(store, makeOptions())
            .execute(makeChatTask('task-claude-ask', { provider: 'claude' }), 'Hello');

        const { tools, systemMessage } = sentCall(0);
        expect(tools).toContain('ask_user');
        expect(systemMessage).not.toContain(MARKER);
    });

    it('sends byte-identical discovery text on Codex ask and autopilot first turns', async () => {
        // A mid-chat mode toggle must not rewrite the cached prefix, so both
        // first-turn builders have to emit the same bytes.
        const askStore = createMockProcessStore();
        await new ChatExecutor(askStore, makeOptions())
            .execute(makeChatTask('task-codex-inv-ask'), 'Hello');

        const autoStore = createMockProcessStore();
        await new AutopilotExecutor(autoStore, makeOptions())
            .execute(makeChatTask('task-codex-inv-auto', { mode: 'autopilot' }), 'Hello');

        const askBlock = sentCall(0).systemMessage.slice(sentCall(0).systemMessage.indexOf(MARKER));
        const autoBlock = sentCall(1).systemMessage.slice(sentCall(1).systemMessage.indexOf(MARKER));

        expect(askBlock).toContain(DEFERRED_NAME);
        expect(autoBlock).toBe(askBlock);
    });
});
