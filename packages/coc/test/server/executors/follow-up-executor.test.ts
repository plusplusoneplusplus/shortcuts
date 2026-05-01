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
    let suffix = '';
    for (const addon of addons) {
        const filtered = disabled
            ? addon.tools.filter(tool => !disabled.includes(tool.name))
            : addon.tools;
        if (filtered.length > 0) {
            tools.push(...filtered);
            suffix += addon.suffix;
        }
    }
    return { tools, suffix };
});

vi.mock('../../../src/server/executors/prompt-builder', () => ({
    buildModeSystemMessage: (...args: any[]) => mockBuildModeSystemMessage(...args),
    appendAutoFolderBlock: (msg: any, _ctx: any) => msg,
    appendBoundedMemoryContext: (msg: any, _addon: any) => msg,
    buildBoundedMemoryAddon: () => Promise.resolve({ systemMessageSuffix: undefined, tools: [], suffix: '' }),
    withRepoInstructions: (...args: any[]) => mockWithRepoInstructions(...args),
    buildConversationHistoryContext: (...args: any[]) => mockBuildConversationHistoryContext(...args),
    buildFollowUpSuggestionsAddon: (...args: any[]) => mockBuildFollowUpSuggestionsAddon(...args),
    applyLlmToolPreferences: (...args: any[]) => mockApplyLlmToolPreferences(...args),
    prependSelectedSkillsDirective: (prompt: string, selectedSkills?: string[]) =>
        selectedSkills && selectedSkills.length > 0
            ? `<selected_skills>\nThe user explicitly selected these skills: ${selectedSkills.join(', ')}.\nUse the native skill system and invoke each selected skill immediately before proceeding with the request.\nDo not inline or restate the skill bodies yourself.\n</selected_skills>\n\n${prompt}`
            : prompt,
}));

const mockEmitMessageSteering = vi.fn();
vi.mock('../../../src/server/sse-handler', () => ({
    emitMessageSteering: (...args: any[]) => mockEmitMessageSteering(...args),
}));

const mockResolveTaskRoot = vi.fn().mockReturnValue({ absolutePath: '/tasks-root' });
vi.mock('../../../src/server/task-root-resolver', () => ({
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
        followUpSuggestions: { enabled: false, count: 3 },
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

    it('provides suggest_follow_ups tool on follow-up turns (not only first turn)', async () => {
        const proc = makeProcess({
            id: 'proc-suggest',
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

        // buildFollowUpSuggestionsAddon must be called with enabled=true even
        // when there are already assistant turns in the conversation.
        expect(mockBuildFollowUpSuggestionsAddon).toHaveBeenCalledWith(true, 3);
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
});
