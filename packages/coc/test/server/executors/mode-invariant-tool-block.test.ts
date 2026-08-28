/**
 * Mode-invariant tool block
 *
 * The Anthropic API serializes `tools` → `system` → `messages`, so the tool
 * block sits before everything else in the cached prefix. A single tool that
 * differs between `ask` and `autopilot` therefore invalidates the entire
 * conversation's prefix cache the moment a user toggles the mode pill on a
 * follow-up turn — which resumes the same SDK session.
 *
 * `ask_user` used to be that tool. These tests are the regression fence:
 * registration must depend on the global `askUser.enabled` config and never on
 * chat mode.
 *
 * Known exceptions, deliberately not asserted here:
 * - The Ralph grill terminal branch strips `ask_user` mid-turn to end the
 *   questioning phase (chat-base-executor). Covered separately below.
 * - Autopilot initial turns opt out of Memory V2 while ask turns do not, so
 *   initial-turn tool blocks still differ for an unrelated reason. The
 *   initial-turn test stubs the Memory V2 addon to a constant so the
 *   assertion stays about `ask_user`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AIProcess, QueuedTask } from '@plusplusoneplusplus/forge';
import { RALPH_GRILL_MAX_ROUNDS } from '../../../src/server/ralph/grill-planning';
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

// Memory V2 stubbed to a constant so the initial-turn assertion can compare the
// full tool list. Without this, autopilot's `includeMemoryV2: false` masks the
// property under test.
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

function makeChatTask(mode: 'ask' | 'autopilot', id: string): QueuedTask {
    return {
        id,
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: { kind: 'chat', mode, prompt: 'Hello' },
        config: {},
        displayName: 'Hello',
    } as QueuedTask;
}

function makeProcess(id: string, mode: 'ask' | 'autopilot'): AIProcess {
    return {
        id,
        type: 'chat',
        status: 'completed',
        startTime: new Date(),
        promptPreview: 'initial prompt',
        metadata: { type: 'chat', workspaceId: 'ws-1', mode },
        conversationTurns: [
            { role: 'user', content: 'Hello', timestamp: new Date(), turnIndex: 0, timeline: [] },
            { role: 'assistant', content: 'Hi there', timestamp: new Date(), turnIndex: 1, timeline: [] },
        ],
    } as AIProcess;
}

function sortedToolNames(callIndex: number): string[] {
    const call = sdkMocks.mockSendMessage.mock.calls[callIndex][0] as any;
    return (call.tools ?? []).map((tool: any) => tool.name).sort();
}

// ============================================================================
// Tests
// ============================================================================

describe('mode-invariant tool block', () => {
    beforeEach(() => {
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({ success: true, response: 'ok', sessionId: 's1' });
    });

    it('initial turns send identical tool blocks for ask and autopilot', async () => {
        const askStore = createMockProcessStore();
        await new ChatExecutor(askStore, makeOptions()).execute(makeChatTask('ask', 'task-inv-ask'), 'Hello');
        const askTools = sortedToolNames(0);

        const autoStore = createMockProcessStore();
        await new AutopilotExecutor(autoStore, makeOptions()).execute(makeChatTask('autopilot', 'task-inv-auto'), 'Hello');
        const autopilotTools = sortedToolNames(1);

        expect(askTools).toContain('ask_user');
        expect(autopilotTools).toEqual(askTools);
    });

    it('follow-up turns send identical tool blocks across a mid-chat mode switch', async () => {
        // The load-bearing case: follow-ups resume the stored SDK session, so
        // this is the only path where a mode toggle can rewrite the prefix of a
        // live conversation.
        const askStore = createMockProcessStore();
        await askStore.addProcess(makeProcess('proc-inv-ask', 'ask'));
        await new FollowUpExecutor(askStore, makeOptions()).executeFollowUp('proc-inv-ask', 'next', undefined, 'ask');
        const askTools = sortedToolNames(0);

        const autoStore = createMockProcessStore();
        await autoStore.addProcess(makeProcess('proc-inv-auto', 'ask'));
        await new FollowUpExecutor(autoStore, makeOptions()).executeFollowUp('proc-inv-auto', 'next', undefined, 'autopilot');
        const autopilotTools = sortedToolNames(1);

        expect(askTools).toContain('ask_user');
        expect(autopilotTools).toEqual(askTools);
    });

    it('still strips ask_user on the Ralph grill terminal round (documented exception)', async () => {
        // The one path that mutates the already-built tool array mid-turn.
        // Grilling deliberately ends the questioning phase, so this exemption
        // from the invariant is intentional — it is Ralph-grill-only and does
        // not vary with the ask/autopilot pill.
        const store = createMockProcessStore();
        const executor = new ChatExecutor(store, makeOptions({ ralphMultiAgentGrillEnabled: true }));
        const task = makeChatTask('ask', 'task-grill-terminal');
        (task.payload as any).context = {
            ralph: {
                phase: 'grilling',
                grill: { enabled: true, depth: 'light', agents: [{ role: 'product' }] },
            },
        };
        const processId = `queue_${task.id}`;
        // roundsRun at the cap makes the planner return terminal before it runs
        // any grill agent.
        (executor as any).sessions.setRalphGrillState(processId, {
            roundsRun: RALPH_GRILL_MAX_ROUNDS,
            maxRounds: RALPH_GRILL_MAX_ROUNDS,
            terminal: false,
            agents: {},
            askedQuestions: [],
            promptHistory: [],
        });

        await executor.execute(task, 'Grill me');

        const call = sdkMocks.mockSendMessage.mock.calls.at(-1)![0] as any;
        expect((call.tools ?? []).map((tool: any) => tool.name)).not.toContain('ask_user');
    });

    it('drops ask_user from both modes when the global config disables it', async () => {
        const opts = makeOptions({ askUser: { enabled: false } });

        const askStore = createMockProcessStore();
        await new ChatExecutor(askStore, opts).execute(makeChatTask('ask', 'task-inv-off-ask'), 'Hello');

        const autoStore = createMockProcessStore();
        await new AutopilotExecutor(autoStore, opts).execute(makeChatTask('autopilot', 'task-inv-off-auto'), 'Hello');

        expect(sortedToolNames(0)).not.toContain('ask_user');
        expect(sortedToolNames(1)).toEqual(sortedToolNames(0));
    });
});
