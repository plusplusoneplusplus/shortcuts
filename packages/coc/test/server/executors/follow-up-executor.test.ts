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

vi.mock('../../../src/server/executors/prompt-builder', () => ({
    buildModeSystemMessage: (...args: any[]) => mockBuildModeSystemMessage(...args),
    appendAutoFolderBlock: (msg: any, _ctx: any) => msg,
    appendMemoryContext: (msg: any, _dataDir: any, _wsId: any) => msg,
    withRepoInstructions: (...args: any[]) => mockWithRepoInstructions(...args),
    buildConversationHistoryContext: (...args: any[]) => mockBuildConversationHistoryContext(...args),
    buildFollowUpSuggestionsAddon: (...args: any[]) => mockBuildFollowUpSuggestionsAddon(...args),
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

// ============================================================================
// Helpers
// ============================================================================

const sdkMocks = createMockSDKService();

function makeExecutor(
    store: ReturnType<typeof createMockProcessStore>,
    overrides?: Partial<ConstructorParameters<typeof FollowUpExecutor>[1]>,
) {
    return new FollowUpExecutor(store, {
        aiService: sdkMocks.service as any,
        followUpSuggestions: { enabled: false, count: 3 },
        resolveWorkspaceIdForPath: vi.fn().mockResolvedValue('ws-id'),
        resolveSkillConfig: vi.fn().mockResolvedValue({ skillDirectories: undefined, disabledSkills: undefined }),
        ...overrides,
    });
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
        mockBuildConversationHistoryContext.mockReset().mockReturnValue(undefined);
        mockWithRepoInstructions.mockReset().mockImplementation(async (sm: any) => sm);
        mockBuildModeSystemMessage.mockReset().mockReturnValue({ mode: 'replace', content: 'system' });
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
});
