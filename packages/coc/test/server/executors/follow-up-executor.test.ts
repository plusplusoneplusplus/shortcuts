/**
 * FollowUpExecutor Unit Tests
 *
 * Verifies FollowUpExecutor.executeFollowUp():
 * - Throws when process not found
 * - Happy path: sends follow-up message, updates process status to completed,
 *   appends assistant turn to conversationTurns
 * - Failure: AI sendMessage failure → status 'failed', error turn appended
 * - Streaming: chunks forwarded via store.emitProcessOutput
 * - Mode metadata updated when mode changes
 * - onTitleNeeded callback invoked on success
 * - Session ID forwarded when process has sdkSessionId
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AIProcess } from '@plusplusoneplusplus/forge';
import { FollowUpExecutor } from '../../../src/server/executors/follow-up-executor';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

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
        },
    };
});

const mockBuildModeSystemMessage = vi.fn().mockReturnValue({ mode: 'replace', content: 'system' });
const mockWithRepoInstructions = vi.fn().mockImplementation(async (sm: any) => sm);
const mockBuildConversationHistoryContext = vi.fn().mockReturnValue(undefined);
const mockBuildFollowUpSuggestionsAddon = vi.fn().mockReturnValue({ tools: [], suffix: '' });
const mockApplyLlmToolPreferences = vi.fn().mockImplementation((addons: Array<{ tools: any[]; suffix: string }>, disabled?: string[]) => {
    const tools: any[] = [];
    let toolGuidance = '';
    for (const addon of addons) {
        const filtered = disabled
            ? addon.tools.filter(tool => !disabled.includes(tool.name))
            : addon.tools;
        if (filtered.length > 0) {
            tools.push(...filtered);
            toolGuidance += addon.suffix;
        }
    }
    return { tools, toolGuidance };
});
function makeMockToolBundle(overrides?: Partial<ReturnType<typeof makeMockToolBundle>>) {
    return {
        tools: [],
        toolGuidance: '',
        askUser: {
            answerQuestion: vi.fn(() => false),
            skipQuestion: vi.fn(() => false),
            cancelAll: vi.fn(),
            hasPending: vi.fn(() => false),
        },
        ...overrides,
    };
}
const mockBuildChatToolBundle = vi.fn().mockReturnValue(makeMockToolBundle());

vi.mock('../../../src/server/executors/prompt-builder', () => ({
    buildModeSystemMessage: (...args: any[]) => mockBuildModeSystemMessage(...args),
    appendAutoFolderBlock: (msg: any, _ctx: any) => msg,
    appendBoundedMemoryContext: (msg: any, _addon: any) => msg,
    buildBoundedMemoryAddon: () => Promise.resolve({ systemMessageSuffix: undefined, tools: [], suffix: '' }),
    buildAskUserAddon: () => ({
        tools: [],
        suffix: '',
        answerQuestion: () => false,
        skipQuestion: () => false,
        cancelAll: () => {},
        hasPending: () => false,
    }),
    buildCreateWorkItemAddon: () => ({ tools: [], suffix: '' }),
    buildSearchConversationsAddon: () => ({ tools: [], suffix: '' }),
    buildTavilyWebSearchAddon: () => ({ tools: [], suffix: '' }),
    withRepoInstructions: (...args: any[]) => mockWithRepoInstructions(...args),
    buildConversationHistoryContext: (...args: any[]) => mockBuildConversationHistoryContext(...args),
    buildFollowUpSuggestionsAddon: (...args: any[]) => mockBuildFollowUpSuggestionsAddon(...args),
    applyLlmToolPreferences: (...args: any[]) => mockApplyLlmToolPreferences(...args),
    assertNoAskUserConflict: () => {},
    prependSelectedSkillsDirective: (prompt: string, selectedSkills?: string[]) =>
        selectedSkills && selectedSkills.length > 0
            ? `<selected_skills>\nThe user explicitly selected these skills: ${selectedSkills.join(', ')}.\nUse the native skill system and invoke each selected skill immediately before proceeding with the request.\nDo not inline or restate the skill bodies yourself.\n</selected_skills>\n\n${prompt}`
            : prompt,
}));

vi.mock('../../../src/server/executors/chat-tool-builder', () => ({
    buildChatToolBundle: (...args: any[]) => mockBuildChatToolBundle(...args),
}));

const mockEmitMessageSteering = vi.fn();
vi.mock('../../../src/server/streaming/sse-handler', () => ({
    emitMessageSteering: (...args: any[]) => mockEmitMessageSteering(...args),
}));

const mockResolveTaskRoot = vi.fn().mockReturnValue({ absolutePath: '/tasks-root' });
vi.mock('../../../src/server/tasks/task-root-resolver', () => ({
    resolveTaskRoot: (...args: any[]) => mockResolveTaskRoot(...args),
}));

const mockReadNoteContent = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../src/server/executors/note-chat-executor', () => ({
    readNoteContent: (...args: any[]) => mockReadNoteContent(...args),
    appendNoteEditSnapshot: vi.fn().mockResolvedValue(undefined),
    SNAPSHOT_SIZE_LIMIT: 200_000,
}));

// ============================================================================
// Helpers
// ============================================================================

const sdkMocks = createMockSDKService();

function makeExecutor(
    store: ReturnType<typeof createMockProcessStore>,
    overrides?: Partial<ConstructorParameters<typeof FollowUpExecutor>[1]>,
    dataDir?: string,
) {
    return new FollowUpExecutor(store, {
        aiService: sdkMocks.service as any,
        defaultTimeoutMs: 30_000,
        followUpSuggestions: { enabled: false, count: 3 },
        toolCallCacheStore: { options: {} } as any,
        resolveWorkspaceIdForPath: vi.fn().mockResolvedValue('ws-id'),
        resolveSkillConfig: vi.fn().mockResolvedValue({ skillDirectories: undefined, disabledSkills: undefined }),
        ...overrides,
    }, dataDir);
}

function makeProcess(overrides?: Partial<AIProcess>): AIProcess {
    return {
        id: 'proc-1',
        type: 'chat',
        status: 'completed',
        startTime: new Date(),
        promptPreview: 'initial prompt',
        conversationTurns: [
            { role: 'user', content: 'Hello', timestamp: new Date(), turnIndex: 0, timeline: [] },
            { role: 'assistant', content: 'Hi there', timestamp: new Date(), turnIndex: 1, timeline: [] },
        ],
        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('FollowUpExecutor', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        mockBuildFollowUpSuggestionsAddon.mockReset().mockReturnValue({ tools: [], suffix: '' });
        mockApplyLlmToolPreferences.mockClear();
        mockBuildChatToolBundle.mockReset().mockReturnValue(makeMockToolBundle());
        mockBuildConversationHistoryContext.mockReset().mockReturnValue(undefined);
        mockWithRepoInstructions.mockReset().mockImplementation(async (sm: any) => sm);
        mockBuildModeSystemMessage.mockReset().mockReturnValue({ mode: 'replace', content: 'system' });
        mockReadNoteContent.mockReset().mockResolvedValue(undefined);
    });

    // -------------------------------------------------------------------------
    // Error: process not found
    // -------------------------------------------------------------------------

    it('throws when process is not found', async () => {
        const executor = makeExecutor(store);
        await expect(executor.executeFollowUp('non-existent', 'msg')).rejects.toThrow(
            'Process not found: non-existent',
        );
    });

    // -------------------------------------------------------------------------
    // Happy path
    // -------------------------------------------------------------------------

    it('updates process status to completed on success', async () => {
        const proc = makeProcess();
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        await executor.executeFollowUp('proc-1', 'follow-up message');

        const updated = store.processes.get('proc-1');
        expect(updated?.status).toBe('completed');
    });

    it('appends assistant turn to conversationTurns', async () => {
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'Assistant reply',
            sessionId: 'sess-1',
        });
        const proc = makeProcess();
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        await executor.executeFollowUp('proc-1', 'next question');

        const updated = store.processes.get('proc-1');
        const assistantTurns = updated?.conversationTurns?.filter(t => t.role === 'assistant') ?? [];
        expect(assistantTurns.length).toBeGreaterThanOrEqual(1);
        const lastAssistant = assistantTurns[assistantTurns.length - 1];
        expect(lastAssistant.content).toBe('Assistant reply');
    });

    it('emits process-complete event on success', async () => {
        const proc = makeProcess();
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        await executor.executeFollowUp('proc-1', 'msg');

        expect(store.emitProcessComplete).toHaveBeenCalledWith('proc-1', 'completed', expect.stringMatching(/\d+ms/));
    });

    it('forwards sessionId to the next sendMessage call', async () => {
        const proc = makeProcess({ id: 'proc-sess', sdkSessionId: 'sdk-session-abc' });
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        await executor.executeFollowUp('proc-sess', 'msg');

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ sessionId: 'sdk-session-abc' }),
        );
    });

    it('passes infiniteSessions enabled to sendMessage', async () => {
        const proc = makeProcess({ id: 'proc-inf', sdkSessionId: 'sdk-inf' });
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        await executor.executeFollowUp('proc-inf', 'msg');

        const callArg = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        expect(callArg.infiniteSessions).toEqual({ enabled: true });
    });

    it('prepends a selected-skills directive without inlining skill bodies', async () => {
        const proc = makeProcess({ id: 'proc-skills', sdkSessionId: 'sdk-session-skills' });
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        await executor.executeFollowUp('proc-skills', 'msg', undefined, undefined, undefined, undefined, ['impl', 'review']);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: expect.stringContaining('<selected_skills>'),
            }),
        );
        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        expect(call.prompt).toContain('The user explicitly selected these skills: impl, review.');
        expect(call.prompt).not.toContain('<skill name=');
    });

    // -------------------------------------------------------------------------
    // Failure path
    // -------------------------------------------------------------------------

    it('sets process status to failed when sendMessage returns success=false', async () => {
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: false,
            error: 'Session expired',
        });
        const proc = makeProcess({ id: 'proc-fail' });
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        await executor.executeFollowUp('proc-fail', 'msg');

        const updated = store.processes.get('proc-fail');
        expect(updated?.status).toBe('failed');
    });

    it('appends error turn when sendMessage throws', async () => {
        sdkMocks.mockSendMessage.mockRejectedValue(new Error('Network error'));
        const proc = makeProcess({ id: 'proc-throw' });
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        await executor.executeFollowUp('proc-throw', 'msg');

        const updated = store.processes.get('proc-throw');
        const lastTurn = updated?.conversationTurns?.[updated.conversationTurns.length - 1];
        expect(lastTurn?.role).toBe('assistant');
        expect(lastTurn?.content).toContain('Network error');
        expect(updated?.status).toBe('failed');
    });

    // -------------------------------------------------------------------------
    // Streaming
    // -------------------------------------------------------------------------

    it('forwards streaming chunks via emitProcessOutput', async () => {
        let capturedChunkHandler: ((chunk: string) => void) | undefined;
        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            capturedChunkHandler = opts.onStreamingChunk;
            capturedChunkHandler?.('Hello');
            capturedChunkHandler?.(' World');
            return { success: true, response: 'Hello World', sessionId: 'sess' };
        });

        const proc = makeProcess({ id: 'proc-stream' });
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        await executor.executeFollowUp('proc-stream', 'stream test');

        expect(store.emitProcessOutput).toHaveBeenCalledWith('proc-stream', 'Hello');
        expect(store.emitProcessOutput).toHaveBeenCalledWith('proc-stream', ' World');
    });

    // -------------------------------------------------------------------------
    // Mode metadata
    // -------------------------------------------------------------------------

    it('updates process metadata when mode changes', async () => {
        const proc = makeProcess({
            id: 'proc-mode',
            metadata: { type: 'chat', mode: 'ask' },
        });
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        await executor.executeFollowUp('proc-mode', 'msg', undefined, 'autopilot');

        expect(store.updateProcess).toHaveBeenCalledWith('proc-mode', expect.objectContaining({
            metadata: expect.objectContaining({
                mode: 'autopilot',
                previousMode: 'ask',
            }),
        }));
    });

    it('does not update metadata when mode is unchanged', async () => {
        const proc = makeProcess({
            id: 'proc-same-mode',
            metadata: { type: 'chat', mode: 'ask' },
        });
        await store.addProcess(proc);
        const updateSpy = vi.mocked(store.updateProcess);
        updateSpy.mockClear();

        const executor = makeExecutor(store);
        await executor.executeFollowUp('proc-same-mode', 'msg', undefined, 'ask');

        const metadataUpdateCall = updateSpy.mock.calls.find(
            ([, updates]) => 'metadata' in updates && (updates as any).metadata?.previousMode !== undefined,
        );
        expect(metadataUpdateCall).toBeUndefined();
    });

    it('preserves process mode when follow-up supplies no mode override', async () => {
        // Regression: loop ticks invoke executeFollowUp without a mode.
        // The process's existing mode (e.g. Ask) must not be overwritten,
        // and `previousMode` must not be recorded.
        const proc = makeProcess({
            id: 'proc-preserve-ask',
            metadata: { type: 'chat', mode: 'ask' },
        });
        await store.addProcess(proc);
        const updateSpy = vi.mocked(store.updateProcess);
        updateSpy.mockClear();

        const executor = makeExecutor(store);
        await executor.executeFollowUp('proc-preserve-ask', 'msg');

        const metadataUpdateCall = updateSpy.mock.calls.find(
            ([, updates]) =>
                'metadata' in updates &&
                ((updates as any).metadata?.previousMode !== undefined ||
                    ((updates as any).metadata?.mode !== undefined &&
                        (updates as any).metadata?.mode !== 'ask')),
        );
        expect(metadataUpdateCall).toBeUndefined();

        // Process metadata mode remains 'ask' and no previousMode field added
        const final = store.processes.get('proc-preserve-ask');
        expect(final?.metadata?.mode).toBe('ask');
        expect(final?.metadata?.previousMode).toBeUndefined();

        // sendMessage receives Ask's agent mode ('interactive')
        expect(sdkMocks.mockSendMessage).toHaveBeenCalled();
        const sendOpts = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(sendOpts.mode).toBe('interactive');
    });

    // -------------------------------------------------------------------------
    // onTitleNeeded callback
    // -------------------------------------------------------------------------

    it('calls onTitleNeeded callback after successful follow-up', async () => {
        const proc = makeProcess({ id: 'proc-title' });
        await store.addProcess(proc);

        const onTitleNeeded = vi.fn();
        const executor = makeExecutor(store, { onTitleNeeded });
        await executor.executeFollowUp('proc-title', 'msg');

        expect(onTitleNeeded).toHaveBeenCalledWith('proc-title', expect.any(Array));
    });

    it('does not call onTitleNeeded when sendMessage fails', async () => {
        sdkMocks.mockSendMessage.mockRejectedValue(new Error('boom'));
        const proc = makeProcess({ id: 'proc-no-title' });
        await store.addProcess(proc);

        const onTitleNeeded = vi.fn();
        const executor = makeExecutor(store, { onTitleNeeded });
        await executor.executeFollowUp('proc-no-title', 'msg');

        expect(onTitleNeeded).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // History context (no session resume)
    // -------------------------------------------------------------------------

    it('builds conversation history context when process has no sdkSessionId', async () => {
        const proc = makeProcess({ id: 'proc-history', sdkSessionId: undefined });
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        await executor.executeFollowUp('proc-history', 'msg');

        expect(mockBuildConversationHistoryContext).toHaveBeenCalledWith(proc.conversationTurns);
    });

    it('skips conversation history context when process has sdkSessionId', async () => {
        const proc = makeProcess({ id: 'proc-resume', sdkSessionId: 'existing-session' });
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        await executor.executeFollowUp('proc-resume', 'msg');

        expect(mockBuildConversationHistoryContext).not.toHaveBeenCalled();
    });

    it('prepends cold history to the system message when session cannot resume', async () => {
        mockBuildConversationHistoryContext.mockReturnValue('HISTORY: prior turns');
        const proc = makeProcess({ id: 'proc-cold-history', sdkSessionId: undefined });
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        await executor.executeFollowUp('proc-cold-history', 'msg');

        const callArg = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        expect(callArg.sessionId).toBeUndefined();
        expect(callArg.systemMessage.content).toContain('HISTORY: prior turns');
        expect(callArg.systemMessage.content).toContain('system');
    });

    it('keeps resumable sessions on the SDK session without prepending history', async () => {
        mockBuildConversationHistoryContext.mockReturnValue('HISTORY: prior turns');
        const proc = makeProcess({ id: 'proc-warm-history', sdkSessionId: 'existing-session' });
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        await executor.executeFollowUp('proc-warm-history', 'msg');

        const callArg = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        expect(callArg.sessionId).toBe('existing-session');
        expect(callArg.systemMessage.content).not.toContain('HISTORY: prior turns');
        expect(mockBuildConversationHistoryContext).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // User turn serialization (regression: turn ordering race)
    // -------------------------------------------------------------------------

    it('appends only assistant turn (user turn pre-persisted by route handler)', async () => {
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI reply',
            sessionId: 'sess-order',
        });

        const proc = makeProcess({
            id: 'proc-order',
            conversationTurns: [
                { role: 'user', content: 'initial', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'first reply', timestamp: new Date(), turnIndex: 1, timeline: [] },
                // User turn pre-persisted by the POST /message handler
                { role: 'user', content: 'follow-up question', timestamp: new Date(), turnIndex: 2, timeline: [] },
            ],
        });
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        await executor.executeFollowUp('proc-order', 'follow-up question');

        const updated = store.processes.get('proc-order');
        const turns = updated?.conversationTurns ?? [];
        // Pre-existing user turn preserved, executor only adds assistant turn
        expect(turns).toHaveLength(4);
        expect(turns[2].role).toBe('user');
        expect(turns[2].content).toBe('follow-up question');
        expect(turns[3].role).toBe('assistant');
        expect(turns[3].content).toBe('AI reply');
        expect(turns[2].turnIndex).toBeLessThan(turns[3].turnIndex);
    });

    it('preserves pre-existing user turn images when appending assistant turn', async () => {
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'seen image',
            sessionId: 'sess-img',
        });

        const images = ['data:image/png;base64,abc123'];
        const proc = makeProcess({
            id: 'proc-img',
            conversationTurns: [
                // User turn with images pre-persisted by the POST /message handler
                { role: 'user', content: 'look at this', timestamp: new Date(), turnIndex: 0, timeline: [], images },
            ],
        });
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        await executor.executeFollowUp('proc-img', 'look at this');

        const updated = store.processes.get('proc-img');
        const userTurn = updated?.conversationTurns?.find(
            t => t.role === 'user' && t.content === 'look at this',
        );
        expect(userTurn).toBeDefined();
        expect(userTurn!.images).toEqual(images);
        // Assistant turn also added
        const assistantTurn = updated?.conversationTurns?.find(t => t.role === 'assistant');
        expect(assistantTurn).toBeDefined();
        expect(assistantTurn!.content).toBe('seen image');
    });

    // -------------------------------------------------------------------------
    // Regression: suggest_follow_ups tool must be available on every turn
    // -------------------------------------------------------------------------

    it('uses the shared chat tool bundle on follow-up turns', async () => {
        const proc = makeProcess({
            id: 'proc-suggest',
            metadata: { type: 'chat', workspaceId: 'ws-id' },
            conversationTurns: [
                { role: 'user', content: 'Hello', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'Hi there', timestamp: new Date(), turnIndex: 1, timeline: [] },
            ],
        });
        await store.addProcess(proc);

        const executor = makeExecutor(store, {
            followUpSuggestions: { enabled: true, count: 3 },
        });
        await executor.executeFollowUp('proc-suggest', 'another question');

        expect(mockBuildChatToolBundle).toHaveBeenCalledWith(expect.objectContaining({
            dataDir: undefined,
            store,
            workspaceId: 'ws-id',
            processId: 'proc-suggest',
            followUpSuggestions: { enabled: true, count: 3 },
        }));
    });

    it('passes shared chat tools and routes tool guidance into the system message on follow-up turns', async () => {
        mockBuildChatToolBundle.mockReturnValue(makeMockToolBundle({
            tools: [{ name: 'tavily_web_search' }],
            toolGuidance: '\n\nTavily tool guidance prose',
        }));
        const proc = makeProcess({
            id: 'proc-shared-tools',
            metadata: { type: 'chat', workspaceId: 'ws-tools' },
        });
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        await executor.executeFollowUp('proc-shared-tools', 'another question');

        const callArg = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        expect(callArg.tools.map((tool: any) => tool.name)).toContain('tavily_web_search');
        // After the refactor: the tool-guidance prose lives in systemMessage
        // (sent once at SDK session creation), not stapled onto every user
        // turn. The user prompt should remain the raw message.
        expect(callArg.prompt).toContain('another question');
        expect(callArg.prompt).not.toContain('Tavily tool guidance prose');
        expect(callArg.systemMessage.content).toContain('Tavily tool guidance prose');
    });

    it('passes enabled ask_user configuration on ask follow-up turns', async () => {
        const proc = makeProcess({
            id: 'proc-ask-user',
            metadata: { type: 'chat', workspaceId: 'ws-ask', mode: 'ask' },
        });
        await store.addProcess(proc);

        const executor = makeExecutor(store, {
            askUser: { enabled: true },
        });
        await executor.executeFollowUp('proc-ask-user', 'ask another question');

        expect(mockBuildChatToolBundle).toHaveBeenCalledWith(expect.objectContaining({
            askUser: expect.objectContaining({
                enabled: true,
                deps: expect.objectContaining({
                    emitQuestions: expect.any(Function),
                    computeTurnIndex: expect.any(Function),
                }),
            }),
        }));
    });

    it('keeps ask_user disabled on autopilot follow-up turns', async () => {
        const proc = makeProcess({
            id: 'proc-autopilot-user',
            metadata: { type: 'chat', workspaceId: 'ws-auto', mode: 'autopilot' },
        });
        await store.addProcess(proc);

        const executor = makeExecutor(store, {
            askUser: { enabled: true },
        });
        // After the single-source-of-truth fix, callers must pass mode
        // explicitly; the executor no longer infers it from process metadata.
        await executor.executeFollowUp('proc-autopilot-user', 'continue autonomously', undefined, 'autopilot');

        expect(mockBuildChatToolBundle).toHaveBeenCalledWith(expect.objectContaining({
            askUser: expect.objectContaining({
                enabled: false,
            }),
        }));
    });

    it('emits follow-up ask_user questions with the next assistant turn index', async () => {
        const proc = makeProcess({
            id: 'proc-ask-user-event',
            metadata: { type: 'chat', workspaceId: 'ws-ask', mode: 'ask' },
            conversationTurns: [
                { role: 'user', content: 'Hello', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'Hi there', timestamp: new Date(), turnIndex: 1, timeline: [] },
                { role: 'user', content: 'follow up', timestamp: new Date(), turnIndex: 2, timeline: [] },
            ],
        });
        await store.addProcess(proc);

        const executor = makeExecutor(store, {
            askUser: { enabled: true },
        });
        await executor.executeFollowUp('proc-ask-user-event', 'ask for approval');

        const askUser = mockBuildChatToolBundle.mock.calls[0][0].askUser;
        expect(askUser.deps.computeTurnIndex()).toBe(3);

        const questionPayload = {
            batchId: 'batch-1',
            questionId: 'question-1',
            question: 'Approve?',
            type: 'confirm',
            turnIndex: askUser.deps.computeTurnIndex(),
            index: 0,
            batchSize: 1,
        };
        await askUser.deps.emitQuestions([questionPayload]);

        expect(store.updateProcess).toHaveBeenCalledWith('proc-ask-user-event', {
            pendingAskUser: [questionPayload],
        });
        expect(store.emitProcessEvent).toHaveBeenCalledWith('proc-ask-user-event', {
            type: 'ask-user',
            askUser: questionPayload,
        });
    });

    // -------------------------------------------------------------------------
    // Model override
    // -------------------------------------------------------------------------

    it('passes model to sendMessage when model override is provided', async () => {
        const proc = makeProcess({ id: 'proc-model', sdkSessionId: 'sess-model' });
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        await executor.executeFollowUp('proc-model', 'msg', undefined, undefined, undefined, undefined, undefined, 'gpt-5.4');

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ model: 'gpt-5.4' }),
        );
    });

    it('does not include model in sendMessage when no override', async () => {
        const proc = makeProcess({ id: 'proc-no-model', sdkSessionId: 'sess-no-model' });
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        await executor.executeFollowUp('proc-no-model', 'msg');

        const callArg = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        expect(callArg.model).toBeUndefined();
    });

    it('updates process metadata with new model', async () => {
        const proc = makeProcess({
            id: 'proc-model-meta',
            metadata: { type: 'chat', model: 'claude-sonnet-4.6' },
        });
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        await executor.executeFollowUp('proc-model-meta', 'msg', undefined, undefined, undefined, undefined, undefined, 'gpt-5.4');

        expect(store.updateProcess).toHaveBeenCalledWith('proc-model-meta', expect.objectContaining({
            metadata: expect.objectContaining({
                model: 'gpt-5.4',
            }),
        }));
    });

    it('does not update model metadata when model unchanged', async () => {
        const proc = makeProcess({
            id: 'proc-same-model',
            metadata: { type: 'chat', model: 'gpt-5.4' },
        });
        await store.addProcess(proc);
        const updateSpy = vi.mocked(store.updateProcess);
        updateSpy.mockClear();

        const executor = makeExecutor(store);
        await executor.executeFollowUp('proc-same-model', 'msg', undefined, undefined, undefined, undefined, undefined, 'gpt-5.4');

        // Should not have a metadata update that is solely dedicated to changing the model
        // (system-prompt persistence calls are expected and also spread model, so we
        // distinguish by checking that no call contains model but lacks systemPrompt)
        const modelOnlyUpdateCall = updateSpy.mock.calls.find(
            ([, updates]) => 'metadata' in updates
                && (updates as any).metadata?.model === 'gpt-5.4'
                && (updates as any).metadata?.systemPrompt == null,
        );
        expect(modelOnlyUpdateCall).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    // System prompt persistence
    // -------------------------------------------------------------------------

    it('persists system prompt to process metadata after follow-up', async () => {
        const proc = makeProcess({ id: 'proc-sysprompt', metadata: { type: 'chat' } });
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        await executor.executeFollowUp('proc-sysprompt', 'msg');

        // Wait for the fire-and-forget IIFE to complete
        await Promise.resolve();
        await Promise.resolve();

        const systemPromptCall = vi.mocked(store.updateProcess).mock.calls.find(
            ([, updates]) => 'metadata' in updates && (updates as any).metadata?.systemPrompt != null,
        );
        expect(systemPromptCall).toBeDefined();
        expect(systemPromptCall![1]).toMatchObject({
            metadata: expect.objectContaining({ systemPrompt: expect.any(String) }),
        });
    });

    it('persists system prompt without overwriting mode update', async () => {
        const proc = makeProcess({
            id: 'proc-mode-sysprompt',
            metadata: { type: 'chat', mode: 'ask' },
        });
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        // Transition from ask → autopilot: mode is the 4th parameter
        await executor.executeFollowUp('proc-mode-sysprompt', 'msg', undefined, 'autopilot');

        // Wait for the fire-and-forget IIFE to complete
        await Promise.resolve();
        await Promise.resolve();

        const final = store.processes.get('proc-mode-sysprompt');
        // Mode update must not be reverted by system prompt persistence
        expect(final?.metadata?.mode).toBe('autopilot');
        expect(final?.metadata?.previousMode).toBe('ask');
        expect(final?.metadata?.systemPrompt).toBeDefined();
    });

    // -------------------------------------------------------------------------
    // turnSource — loop/wakeup follow-up user turn creation
    // -------------------------------------------------------------------------

    it('creates user turn with turnSource for loop-triggered follow-ups', async () => {
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'Loop check result',
            sessionId: 'sess-loop',
        });
        const proc = makeProcess({
            id: 'proc-loop',
            conversationTurns: [
                { role: 'user', content: 'initial', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'reply', timestamp: new Date(), turnIndex: 1, timeline: [] },
            ],
        });
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        const turnSource = { source: 'loop' as const, loopId: 'loop_abc' };
        await executor.executeFollowUp('proc-loop', 'Check status', undefined, undefined, undefined, undefined, undefined, undefined, turnSource);

        const updated = store.processes.get('proc-loop');
        const turns = updated?.conversationTurns ?? [];
        // Should have: original user + assistant + loop user turn + loop assistant turn
        expect(turns.length).toBeGreaterThanOrEqual(4);
        const loopUserTurn = turns.find(t => t.role === 'user' && t.turnSource?.source === 'loop');
        expect(loopUserTurn).toBeDefined();
        expect(loopUserTurn!.content).toBe('Check status');
        expect(loopUserTurn!.turnSource).toEqual({ source: 'loop', loopId: 'loop_abc' });
    });

    it('tags assistant turn with turnSource for loop follow-ups', async () => {
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'Loop response',
            sessionId: 'sess-loop-assist',
        });
        const proc = makeProcess({ id: 'proc-loop-assist' });
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        const turnSource = { source: 'loop' as const, loopId: 'loop_xyz' };
        await executor.executeFollowUp('proc-loop-assist', 'Check', undefined, undefined, undefined, undefined, undefined, undefined, turnSource);

        const updated = store.processes.get('proc-loop-assist');
        const turns = updated?.conversationTurns ?? [];
        const assistantTurns = turns.filter(t => t.role === 'assistant' && t.turnSource?.source === 'loop');
        expect(assistantTurns.length).toBeGreaterThanOrEqual(1);
        expect(assistantTurns[assistantTurns.length - 1].turnSource).toEqual({ source: 'loop', loopId: 'loop_xyz' });
    });

    it('does not create extra user turn for normal follow-ups (no turnSource)', async () => {
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'Normal reply',
            sessionId: 'sess-normal',
        });
        const proc = makeProcess({
            id: 'proc-normal',
            conversationTurns: [
                { role: 'user', content: 'q', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'a', timestamp: new Date(), turnIndex: 1, timeline: [] },
                { role: 'user', content: 'follow-up', timestamp: new Date(), turnIndex: 2, timeline: [] },
            ],
        });
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        // No turnSource — normal follow-up
        await executor.executeFollowUp('proc-normal', 'follow-up');

        const updated = store.processes.get('proc-normal');
        const turns = updated?.conversationTurns ?? [];
        // Should have original 3 + 1 assistant = 4 (no extra user turn created)
        expect(turns).toHaveLength(4);
        expect(turns[3].role).toBe('assistant');
        expect(turns[3].turnSource).toBeUndefined();
    });

    it('tags error turn with turnSource for wakeup follow-ups', async () => {
        sdkMocks.mockSendMessage.mockRejectedValue(new Error('AI failed'));
        const proc = makeProcess({ id: 'proc-wakeup-err' });
        await store.addProcess(proc);

        const executor = makeExecutor(store);
        const turnSource = { source: 'wakeup' as const, wakeupId: 'w_123' };
        await executor.executeFollowUp('proc-wakeup-err', 'Wake up', undefined, undefined, undefined, undefined, undefined, undefined, turnSource);

        const updated = store.processes.get('proc-wakeup-err');
        const turns = updated?.conversationTurns ?? [];
        const errorTurn = turns.find(t => t.role === 'assistant' && t.content.startsWith('Error:'));
        expect(errorTurn).toBeDefined();
        expect(errorTurn!.turnSource).toEqual({ source: 'wakeup', wakeupId: 'w_123' });
    });
});
