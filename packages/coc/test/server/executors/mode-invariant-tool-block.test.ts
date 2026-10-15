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
 * The same reasoning applies to the system message, which is serialized right
 * after the tool block — so it is asserted here too.
 *
 * Known exceptions:
 * - the Ralph grill terminal branch strips `ask_user` mid-turn to end the
 *   questioning phase (chat-base-executor). Covered separately below.
 * - `create_pull_request` is autopilot-only by product decision (ask mode is
 *   read-only and must never open PRs), so it is left out of the equality
 *   checks and asserted on its own below.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AIProcess, QueuedTask } from '@plusplusoneplusplus/forge';
import { RALPH_GRILL_MAX_ROUNDS } from '../../../src/server/ralph/grill-planning';
import { ChatExecutor } from '../../../src/server/executors/chat-executor';
import { AutopilotExecutor } from '../../../src/server/executors/autopilot-executor';
import { FollowUpExecutor } from '../../../src/server/executors/follow-up-executor';
import { BrowserToolStateStore } from '../../../src/server/llm-tools/browser-tools';
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

// Memory V2 stubbed to a constant so both modes compare against a fixed
// recall block. Both modes build it (autopilot's old `includeMemoryV2: false`
// opt-out is gone); pinning it keeps the assertions about mode, not about a
// recall that varies with the on-disk memory store.
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

function makeChatTask(mode: 'ask' | 'autopilot', id: string, workspaceId?: string): QueuedTask {
    return {
        id,
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: { kind: 'chat', mode, prompt: 'Hello', ...(workspaceId ? { workspaceId } : {}) },
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

/** Tools deliberately registered in autopilot only (see header). */
const AUTOPILOT_ONLY_TOOLS = new Set(['create_pull_request']);

function allToolNames(callIndex: number): string[] {
    const call = sdkMocks.mockSendMessage.mock.calls[callIndex][0] as any;
    return (call.tools ?? []).map((tool: any) => tool.name).sort();
}

function sortedToolNames(callIndex: number): string[] {
    return allToolNames(callIndex).filter(name => !AUTOPILOT_ONLY_TOOLS.has(name));
}

// ============================================================================
// Tests
// ============================================================================

describe('mode-invariant tool block', () => {
    it.each(['copilot', 'claude', 'codex', 'opencode'] as const)(
        'browser tool is live-gated in Ask and Autopilot on %s', async provider => {
            let enabled = false;
            const runtime = { getEnabled: () => enabled, execute: vi.fn().mockResolvedValue({}) };
            const state = new BrowserToolStateStore('.');
            const inFlightTurns = new Map();
            const options = () => makeOptions({ provider,
                getBrowserControlRuntime: () => runtime, getBrowserToolState: () => state, inFlightTurns });
            for (const mode of ['ask', 'autopilot'] as const) {
                const Executor = mode === 'ask' ? ChatExecutor : AutopilotExecutor;
                await new Executor(createMockProcessStore(), options()).execute(makeChatTask(mode, `off-${mode}`, 'ws-1'), '/browser open a page');
                expect(allToolNames(sdkMocks.mockSendMessage.mock.calls.length - 1)).not.toContain('browser');
            }
            enabled = true;
            for (const mode of ['ask', 'autopilot'] as const) {
                const Executor = mode === 'ask' ? ChatExecutor : AutopilotExecutor;
                await new Executor(createMockProcessStore(), options()).execute(makeChatTask(mode, `on-${mode}`, 'ws-1'), '/browser open a page');
                const call = sdkMocks.mockSendMessage.mock.calls.at(-1)![0] as any;
                expect(call.tools.some((tool: any) => tool.name === 'browser')).toBe(true);
                expect(call.prompt).toContain('Browser mode is active.');
                expect(call.systemMessage?.content ?? '').not.toContain('Browser mode is active.');
            }
        },
    );

    it('browser activation stays persisted across follow-ups and executor recreation, and clears', async () => {
        const store = createMockProcessStore();
        await store.addProcess(makeProcess('browser-sticky', 'ask'));
        const browserState = new BrowserToolStateStore('.');
        let enabled = true;
        const options = () => makeOptions({
            getBrowserControlRuntime: () => ({ getEnabled: () => enabled, execute: vi.fn().mockResolvedValue({}) }),
            getBrowserToolState: () => browserState,
        });
        await new FollowUpExecutor(store, options()).executeFollowUp('browser-sticky', '/browser browse', undefined, 'ask');
        expect((await store.getProcess('browser-sticky'))?.metadata?.browserMode).toBe(true);
        await new FollowUpExecutor(store, options()).executeFollowUp('browser-sticky', 'continue', undefined, 'autopilot');
        expect((sdkMocks.mockSendMessage.mock.calls.at(-1)![0] as any).prompt).toContain('Browser mode is active.');
        const process = (await store.getProcess('browser-sticky'))!;
        await store.updateProcess(process.id, { metadata: { ...process.metadata!, browserMode: false } });
        await new FollowUpExecutor(store, options()).executeFollowUp('browser-sticky', 'continue', undefined, 'ask');
        const cleared = sdkMocks.mockSendMessage.mock.calls.at(-1)![0] as any;
        expect(cleared.prompt).not.toContain('Browser mode is active.');
        expect(cleared.tools.some((tool: any) => tool.name === 'browser')).toBe(true);
        await store.updateProcess(process.id, { metadata: { ...process.metadata!, browserMode: true } });
        enabled = false;
        await new FollowUpExecutor(store, options()).executeFollowUp('browser-sticky', 'continue', undefined, 'ask');
        const disabled = sdkMocks.mockSendMessage.mock.calls.at(-1)![0] as any;
        expect(disabled.prompt).not.toContain('Browser mode is active.');
        expect(disabled.tools.some((tool: any) => tool.name === 'browser')).toBe(false);
    });

    it('browser execution is prompt-only and receives the current turn cancellation signal', async () => {
        const runtime = { getEnabled: () => true, execute: vi.fn().mockResolvedValue({ tabs: [] }) };
        const inFlightTurns = new Map();
        sdkMocks.mockSendMessage.mockImplementationOnce(async (call: any) => {
            const tool = call.tools.find((tool: any) => tool.name === 'browser');
            const result = await tool.handler({ action: 'tabs' }, {});
            expect(result.resultType).toBe('success');
            const signal = runtime.execute.mock.calls[0][4] as AbortSignal;
            expect(signal.aborted).toBe(false);
            const reason = new Error('Turn cancelled');
            inFlightTurns.get('queue_browser-no-activation').controller.abort(reason);
            expect(call.signal.aborted).toBe(true);
            expect(signal.aborted).toBe(true);
            expect(signal.reason).toBe(reason);
            return { success: true, response: 'ok', sessionId: 's1' };
        });
        await new ChatExecutor(createMockProcessStore(), makeOptions({
            getBrowserControlRuntime: () => runtime,
            getBrowserToolState: () => new BrowserToolStateStore('.'),
            inFlightTurns,
        })).execute(makeChatTask('ask', 'browser-no-activation', 'ws-1'), 'hello');
        expect(runtime.execute).toHaveBeenCalledTimes(1);
        expect((sdkMocks.mockSendMessage.mock.calls[0][0] as any).prompt).not.toContain('Browser mode is active.');
    });

    it('registers cancellation before building tools and releases it when bundle preparation fails', async () => {
        const inFlightTurns = new Map();
        class FailingChatExecutor extends ChatExecutor {
            protected async buildModeOptions(_task: QueuedTask, _prompt: string, _directory: string | undefined, signal?: AbortSignal): Promise<any> {
                expect(signal).toBeDefined();
                expect(inFlightTurns.get('queue_browser-prepare-failure').controller.signal).toBe(signal);
                throw new Error('Bundle preparation failed');
            }
        }
        await expect(new FailingChatExecutor(createMockProcessStore(), makeOptions({ inFlightTurns }))
            .execute(makeChatTask('ask', 'browser-prepare-failure', 'ws-1'), 'hello'))
            .rejects.toThrow('Bundle preparation failed');
        expect(inFlightTurns.size).toBe(0);
    });

    it('binds the turn signal even without invocation signals or a runtime turn registry', async () => {
        const runtime = { getEnabled: () => true, execute: vi.fn().mockResolvedValue({ tabs: [] }) };
        sdkMocks.mockSendMessage.mockImplementationOnce(async (call: any) => {
            const browser = call.tools.find((tool: any) => tool.name === 'browser');
            await browser.handler({ action: 'tabs' }, {});
            const signal = runtime.execute.mock.calls[0][4] as AbortSignal;
            expect(signal).toBeDefined();
            expect(signal.aborted).toBe(false);
            return { success: true, response: 'ok', sessionId: 's1' };
        });
        await new ChatExecutor(createMockProcessStore(), makeOptions({
            getBrowserControlRuntime: () => runtime,
            getBrowserToolState: () => new BrowserToolStateStore('.'),
        })).execute(makeChatTask('ask', 'browser-no-runtime-registry', 'ws-1'), 'hello');
        expect(runtime.execute).toHaveBeenCalledOnce();
    });

    it.each([false, true])('cold resume uses persisted browser mode %s, not historical slash tokens', async active => {
        const store = createMockProcessStore();
        const process = makeProcess('queue_browser-resume', 'ask');
        process.metadata = { ...process.metadata!, browserMode: active };
        await store.addProcess(process);
        const task = makeChatTask('ask', 'browser-resume', 'ws-1');
        (task.payload as any).resumedFrom = 'source';
        await new ChatExecutor(store, makeOptions({
            getBrowserControlRuntime: () => ({ getEnabled: () => true, execute: vi.fn() }),
            getBrowserToolState: () => new BrowserToolStateStore('.'),
        })).execute(task, 'Earlier user: /browser browse');
        expect((sdkMocks.mockSendMessage.mock.calls[0][0] as any).prompt.includes('Browser mode is active.')).toBe(active);
        expect((await store.getProcess(process.id))?.metadata?.browserMode).toBe(active);
    });

    it('adds browser context to specialized executor tool bundles through the shared base', async () => {
        class SpecializedChatExecutor extends ChatExecutor {
            protected async buildModeOptions(_task: QueuedTask, prompt: string): Promise<any> {
                return { tools: [], effectivePrompt: prompt, agentMode: 'interactive' };
            }
        }
        await new SpecializedChatExecutor(createMockProcessStore(), makeOptions({
            getBrowserControlRuntime: () => ({ getEnabled: () => true, execute: vi.fn() }),
            getBrowserToolState: () => new BrowserToolStateStore('.'),
        })).execute(makeChatTask('ask', 'specialized-browser', 'ws-1'), '/browser browse');
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        expect(call.tools.map((tool: any) => tool.name)).toEqual(['browser']);
        expect(call.prompt).toContain('Browser mode is active.');
    });
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

    it('registers list_workspaces with send_to_conversation in both ask and autopilot', async () => {
        const opts = () => makeOptions({ getEnqueueChat: () => vi.fn().mockResolvedValue('task-x') });
        const askStore = createMockProcessStore();
        await new ChatExecutor(askStore, opts()).execute(makeChatTask('ask', 'task-lw-ask'), 'Hello');
        const askTools = sortedToolNames(0);

        const autoStore = createMockProcessStore();
        await new AutopilotExecutor(autoStore, opts()).execute(makeChatTask('autopilot', 'task-lw-auto'), 'Hello');
        const autopilotTools = sortedToolNames(1);

        expect(askTools).toEqual(expect.arrayContaining(['list_workspaces', 'send_to_conversation']));
        expect(autopilotTools).toEqual(askTools);
    });

    it('initial turns send identical system messages for ask and autopilot', async () => {
        // The system message is serialized immediately after the tool block, so
        // a mode-dependent byte here costs the same prefix cache. Autopilot has
        // no mode input by design — see `chat-turn-system-message.ts`.
        const askStore = createMockProcessStore();
        await new ChatExecutor(askStore, makeOptions()).execute(makeChatTask('ask', 'task-sys-ask'), 'Hello');
        const askSystem = (sdkMocks.mockSendMessage.mock.calls[0][0] as any).systemMessage;

        const autoStore = createMockProcessStore();
        await new AutopilotExecutor(autoStore, makeOptions()).execute(makeChatTask('autopilot', 'task-sys-auto'), 'Hello');
        const autopilotSystem = (sdkMocks.mockSendMessage.mock.calls[1][0] as any).systemMessage;

        expect(autopilotSystem).toEqual(askSystem);
    });

    it('sends the mode-appropriate agentMode on initial turns', async () => {
        // The one first-turn field that must differ: protocol-level write
        // enforcement. It rides `messages`, not the cached prefix.
        const askStore = createMockProcessStore();
        await new ChatExecutor(askStore, makeOptions()).execute(makeChatTask('ask', 'task-agent-ask'), 'Hello');
        expect((sdkMocks.mockSendMessage.mock.calls[0][0] as any).mode).toBe('interactive');

        const autoStore = createMockProcessStore();
        await new AutopilotExecutor(autoStore, makeOptions()).execute(makeChatTask('autopilot', 'task-agent-auto'), 'Hello');
        expect((sdkMocks.mockSendMessage.mock.calls[1][0] as any).mode).toBe('autopilot');
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

    it('offers create_pull_request on autopilot initial turns only', async () => {
        const askStore = createMockProcessStore();
        await new ChatExecutor(askStore, makeOptions()).execute(makeChatTask('ask', 'task-pr-ask', 'ws-1'), 'Hello');

        const autoStore = createMockProcessStore();
        await new AutopilotExecutor(autoStore, makeOptions()).execute(makeChatTask('autopilot', 'task-pr-auto', 'ws-1'), 'Hello');

        expect(allToolNames(0)).not.toContain('create_pull_request');
        expect(allToolNames(1)).toContain('create_pull_request');
    });

    it('offers create_pull_request on autopilot follow-ups only', async () => {
        const askStore = createMockProcessStore();
        await askStore.addProcess(makeProcess('proc-pr-ask', 'ask'));
        await new FollowUpExecutor(askStore, makeOptions()).executeFollowUp('proc-pr-ask', 'next', undefined, 'ask');

        const autoStore = createMockProcessStore();
        await autoStore.addProcess(makeProcess('proc-pr-auto', 'ask'));
        await new FollowUpExecutor(autoStore, makeOptions()).executeFollowUp('proc-pr-auto', 'next', undefined, 'autopilot');

        expect(allToolNames(0)).not.toContain('create_pull_request');
        expect(allToolNames(1)).toContain('create_pull_request');
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
