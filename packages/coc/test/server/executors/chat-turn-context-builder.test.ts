/**
 * Tests for buildChatTurnContext
 *
 * Covers:
 * - Memory V2 tools and excludedTools wired when enabled
 * - includeMemoryV2: false → no memory tools, no excludedTools
 * - dispose() delegates to memoryV2.dispose()
 * - askUser handles forwarded from tool bundle
 * - Tools from tool bundle are passed through correctly
 * - excludeTools context exclusion respected
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildChatTurnContext } from '../../../src/server/executors/chat-turn-context-builder';
import { MEMORY_V2_STORE_TOOL_NAME, MEMORY_V2_RECALL_TOOL_NAME } from '../../../src/server/llm-tools/memory-v2-tools';

// ============================================================================
// Mocks
// ============================================================================

const mockDispose = vi.fn();
const mockActiveMemoryAddon = {
    systemMessageSuffix: '<memory_snapshot>some facts</memory_snapshot>',
    tools: [
        { name: MEMORY_V2_STORE_TOOL_NAME },
        { name: MEMORY_V2_RECALL_TOOL_NAME },
    ],
    suffix: '\n\nYou have a persistent `memory` tool.',
    excludedBuiltinTools: ['vote_memory', 'store_memory'],
    dispose: mockDispose,
};

const mockEmptyMemoryAddon = {
    systemMessageSuffix: undefined,
    tools: [],
    suffix: '',
    excludedBuiltinTools: [],
    dispose: vi.fn(),
};

const mockBuildMemoryV2Addon = vi.fn();
vi.mock('../../../src/server/executors/memory-v2-addon', () => ({
    buildMemoryV2Addon: (...args: any[]) => mockBuildMemoryV2Addon(...args),
}));

const mockAskUserAddon = {
    tools: [{ name: 'ask_user' }],
    suffix: '\n\nask_user guidance',
    answerQuestion: vi.fn(),
    skipQuestion: vi.fn(),
    cancelAll: vi.fn(),
    hasPending: vi.fn(),
    answerQuestions: vi.fn(),
};

const mockBuildChatToolBundle = vi.fn();
vi.mock('../../../src/server/executors/chat-tool-builder', () => ({
    buildChatToolBundle: (...args: any[]) => mockBuildChatToolBundle(...args),
}));

// ============================================================================
// Helpers
// ============================================================================

function makeStore() {
    return { searchConversations: vi.fn() } as any;
}

function makeBundleResult(overrides?: Record<string, any>) {
    return {
        tools: [{ name: 'search_conversations' }, { name: 'suggest_follow_ups' }],
        toolGuidance: 'search_conversations guidance',
        askUser: undefined,
        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('buildChatTurnContext', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockBuildMemoryV2Addon.mockResolvedValue(mockEmptyMemoryAddon);
        mockBuildChatToolBundle.mockReturnValue(makeBundleResult());
    });

    // -------------------------------------------------------------------------
    // Memory V2 enabled
    // -------------------------------------------------------------------------

    it('includes Memory V2 tools and excludedTools when addon is active', async () => {
        mockBuildMemoryV2Addon.mockResolvedValue(mockActiveMemoryAddon);
        mockBuildChatToolBundle.mockReturnValue(makeBundleResult({
            tools: [
                { name: 'search_conversations' },
                { name: MEMORY_V2_STORE_TOOL_NAME },
                { name: MEMORY_V2_RECALL_TOOL_NAME },
            ],
        }));

        const ctx = await buildChatTurnContext({
            dataDir: '/mock/data',
            store: makeStore(),
            workspaceId: 'ws-1',
            processId: 'proc-1',
            query: 'test prompt',
        });

        expect(ctx.tools.map(t => t.name)).toContain(MEMORY_V2_STORE_TOOL_NAME);
        expect(ctx.tools.map(t => t.name)).toContain(MEMORY_V2_RECALL_TOOL_NAME);
        expect(ctx.excludedTools).toContain('vote_memory');
        expect(ctx.excludedTools).toContain('store_memory');
    });

    it('calls buildMemoryV2Addon with correct arguments', async () => {
        await buildChatTurnContext({
            dataDir: '/data',
            store: makeStore(),
            workspaceId: 'ws-abc',
            processId: 'proc-xyz',
            query: 'my question',
        });

        expect(mockBuildMemoryV2Addon).toHaveBeenCalledWith('/data', 'ws-abc', 'my question', 'proc-xyz');
    });

    it('passes memoryV2 into buildChatToolBundle when includeMemoryV2 is true (default)', async () => {
        mockBuildMemoryV2Addon.mockResolvedValue(mockActiveMemoryAddon);

        await buildChatTurnContext({
            dataDir: '/data',
            store: makeStore(),
            workspaceId: 'ws-1',
            processId: 'proc-1',
        });

        expect(mockBuildChatToolBundle).toHaveBeenCalledWith(
            expect.objectContaining({ memoryV2: mockActiveMemoryAddon }),
        );
    });

    it('exposes the memoryV2 addon on the returned context', async () => {
        mockBuildMemoryV2Addon.mockResolvedValue(mockActiveMemoryAddon);

        const ctx = await buildChatTurnContext({
            dataDir: '/data',
            store: makeStore(),
            workspaceId: 'ws-1',
        });

        expect(ctx.memoryV2).toBe(mockActiveMemoryAddon);
        expect(ctx.memoryV2.systemMessageSuffix).toContain('memory_snapshot');
    });

    // -------------------------------------------------------------------------
    // includeMemoryV2: false
    // -------------------------------------------------------------------------

    it('does not call buildMemoryV2Addon when includeMemoryV2 is false', async () => {
        await buildChatTurnContext({
            dataDir: '/data',
            store: makeStore(),
            workspaceId: 'ws-1',
            includeMemoryV2: false,
        });

        expect(mockBuildMemoryV2Addon).not.toHaveBeenCalled();
    });

    it('returns empty excludedTools when includeMemoryV2 is false', async () => {
        const ctx = await buildChatTurnContext({
            dataDir: '/data',
            store: makeStore(),
            workspaceId: 'ws-1',
            includeMemoryV2: false,
        });

        expect(ctx.excludedTools).toEqual([]);
    });

    it('passes undefined memoryV2 into buildChatToolBundle when includeMemoryV2 is false', async () => {
        await buildChatTurnContext({
            dataDir: '/data',
            store: makeStore(),
            workspaceId: 'ws-1',
            includeMemoryV2: false,
        });

        expect(mockBuildChatToolBundle).toHaveBeenCalledWith(
            expect.objectContaining({ memoryV2: undefined }),
        );
    });

    it('returns empty excludedTools when Memory V2 addon is inactive (empty addon)', async () => {
        mockBuildMemoryV2Addon.mockResolvedValue(mockEmptyMemoryAddon);

        const ctx = await buildChatTurnContext({
            dataDir: '/data',
            store: makeStore(),
            workspaceId: 'ws-1',
        });

        expect(ctx.excludedTools).toEqual([]);
    });

    // -------------------------------------------------------------------------
    // dispose
    // -------------------------------------------------------------------------

    it('dispose() delegates to memoryV2.dispose()', async () => {
        mockBuildMemoryV2Addon.mockResolvedValue(mockActiveMemoryAddon);

        const ctx = await buildChatTurnContext({
            dataDir: '/data',
            store: makeStore(),
            workspaceId: 'ws-1',
        });

        ctx.dispose();

        expect(mockDispose).toHaveBeenCalledOnce();
    });

    it('dispose() is safe to call when Memory V2 is opted out', async () => {
        const ctx = await buildChatTurnContext({
            dataDir: '/data',
            store: makeStore(),
            workspaceId: 'ws-1',
            includeMemoryV2: false,
        });

        expect(() => ctx.dispose()).not.toThrow();
    });

    // -------------------------------------------------------------------------
    // Tool bundle passthrough
    // -------------------------------------------------------------------------

    it('forwards tools from the tool bundle', async () => {
        mockBuildChatToolBundle.mockReturnValue(makeBundleResult({
            tools: [{ name: 'search_conversations' }, { name: 'tavily_web_search' }],
        }));

        const ctx = await buildChatTurnContext({
            store: makeStore(),
        });

        expect(ctx.tools.map(t => t.name)).toContain('search_conversations');
        expect(ctx.tools.map(t => t.name)).toContain('tavily_web_search');
    });

    it('forwards toolGuidance from the tool bundle', async () => {
        mockBuildChatToolBundle.mockReturnValue(makeBundleResult({
            toolGuidance: 'custom tool guidance prose',
        }));

        const ctx = await buildChatTurnContext({
            store: makeStore(),
        });

        expect(ctx.toolGuidance).toBe('custom tool guidance prose');
    });

    it('forwards askUser handles when present', async () => {
        mockBuildChatToolBundle.mockReturnValue(makeBundleResult({
            askUser: mockAskUserAddon,
        }));

        const ctx = await buildChatTurnContext({
            store: makeStore(),
            askUser: {
                enabled: true,
                deps: {
                    emitQuestions: vi.fn(),
                    computeTurnIndex: () => 0,
                },
            },
        });

        expect(ctx.askUser).toBe(mockAskUserAddon);
    });

    it('askUser is undefined when not configured', async () => {
        mockBuildChatToolBundle.mockReturnValue(makeBundleResult({ askUser: undefined }));

        const ctx = await buildChatTurnContext({
            store: makeStore(),
        });

        expect(ctx.askUser).toBeUndefined();
    });

    // -------------------------------------------------------------------------
    // buildChatToolBundle options passthrough
    // -------------------------------------------------------------------------

    it('passes all input options through to buildChatToolBundle', async () => {
        const store = makeStore();
        const broadcastWorkItem = vi.fn();
        const scheduleWakeup = { executor: {} as any, processId: 'p', resolveWorkspaceId: vi.fn(), enqueueWakeup: vi.fn() };
        const loopTools = { store: {} as any, executor: {} as any, processId: 'p', resolveWorkspaceId: vi.fn() };

        await buildChatTurnContext({
            dataDir: '/d',
            store,
            workspaceId: 'ws-2',
            processId: 'proc-2',
            followUpSuggestions: { enabled: true, count: 3 },
            broadcastWorkItem,
            scheduleWakeup,
            loopTools,
            excludeTools: ['some_tool'],
        });

        expect(mockBuildChatToolBundle).toHaveBeenCalledWith(
            expect.objectContaining({
                dataDir: '/d',
                store,
                workspaceId: 'ws-2',
                processId: 'proc-2',
                followUpSuggestions: { enabled: true, count: 3 },
                broadcastWorkItem,
                scheduleWakeup,
                loopTools,
                excludeTools: ['some_tool'],
            }),
        );
    });
});
