import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { AIInvoker, AIInvokerResult, AIInvokerOptions } from '../../src/ai/types';
import type { MemoryStore, MemoryLevel } from '../../src/memory/types';

vi.mock('../../src/memory/memory-prompt-builder');
vi.mock('../../src/memory/memory-tool');
vi.mock('../../src/memory/memory-aggregator');
const mockWarnFn = vi.fn();
const mockLoggerInstance = { warn: mockWarnFn, debug: vi.fn(), info: vi.fn(), error: vi.fn() };
vi.mock('../../src/ai-logger', () => ({
    getAIServiceLogger: vi.fn(() => mockLoggerInstance),
    createSessionLogger: vi.fn(() => mockLoggerInstance),
    initAIServiceLogger: vi.fn(),
}));

import { withMemory, type WithMemoryOptions } from '../../src/memory/with-memory';
import { MemoryPromptBuilder } from '../../src/memory/memory-prompt-builder';
import { createMemoryTool } from '../../src/memory/memory-tool';
import { MemoryAggregator } from '../../src/memory/memory-aggregator';

function makeResult(response = 'AI response'): AIInvokerResult {
    return { success: true, response, error: undefined };
}

function makeMockStore(): MemoryStore {
    return {
        readConsolidated: vi.fn(),
        writeConsolidated: vi.fn(),
        readRaw: vi.fn(),
        writeRaw: vi.fn(),
        listRaw: vi.fn(),
        deleteRaw: vi.fn(),
        readIndex: vi.fn(),
        updateIndex: vi.fn(),
        getStats: vi.fn(),
        getConfig: vi.fn(),
    } as unknown as MemoryStore;
}

const mockMemoryTool = { name: 'memory' } as any;

function makeMockBoundedStore() {
    return {
        read: vi.fn().mockReturnValue([]),
        getUsage: vi.fn().mockReturnValue({ current: 0, limit: 3000, percent: 0, entryCount: 0 }),
        load: vi.fn(),
        add: vi.fn(),
        replace: vi.fn(),
        remove: vi.fn(),
        getSnapshot: vi.fn().mockReturnValue(null),
    } as any;
}

describe('withMemory', () => {
    let mockInvoker: Mock<AIInvoker>;
    let mockStore: MemoryStore;
    let baseOpts: AIInvokerOptions;
    let memOpts: WithMemoryOptions;
    let mockGetSystemPromptBlock: Mock;
    let mockAggregateIfNeeded: Mock;

    beforeEach(() => {
        vi.clearAllMocks();

        mockInvoker = vi.fn<AIInvoker>().mockResolvedValue(makeResult());
        mockStore = makeMockStore();
        const boundedRepoStore = makeMockBoundedStore();
        const boundedSystemStore = makeMockBoundedStore();
        baseOpts = { model: 'test-model' };
        memOpts = {
            store: mockStore,
            source: 'test-pipeline',
            boundedStores: { memory: boundedRepoStore, system: boundedSystemStore },
            boundedRepoStore,
            boundedSystemStore,
        };

        // Setup MemoryPromptBuilder mock
        mockGetSystemPromptBlock = vi.fn().mockReturnValue(null);
        (MemoryPromptBuilder as unknown as Mock).mockImplementation(() => ({
            getSystemPromptBlock: mockGetSystemPromptBlock,
            getGuidance: vi.fn().mockReturnValue('guidance'),
        }));

        // Setup createMemoryTool mock
        (createMemoryTool as Mock).mockReturnValue({
            tool: mockMemoryTool,
            getWrittenFacts: vi.fn().mockReturnValue([]),
        });

        // Setup MemoryAggregator mock
        mockAggregateIfNeeded = vi.fn().mockResolvedValue(false);
        (MemoryAggregator as unknown as Mock).mockImplementation(() => ({
            aggregateIfNeeded: mockAggregateIfNeeded,
        }));
    });

    it('prepends memory block to prompt when present', async () => {
        mockGetSystemPromptBlock.mockReturnValue('══════\nMEMORY block\n══════\ncontent');

        await withMemory(mockInvoker, 'original prompt', baseOpts, memOpts);

        expect(mockInvoker).toHaveBeenCalledWith(
            '══════\nMEMORY block\n══════\ncontent\n\noriginal prompt',
            expect.any(Object),
        );
    });

    it('injects memory tool into AI call when boundedStores provided', async () => {
        await withMemory(mockInvoker, 'prompt', baseOpts, memOpts);

        const calledOpts = mockInvoker.mock.calls[0][1] as AIInvokerOptions;
        expect(calledOpts.tools).toContain(mockMemoryTool);
    });

    it('passes through when no memory exists', async () => {
        mockGetSystemPromptBlock.mockReturnValue(null);

        await withMemory(mockInvoker, 'original prompt', baseOpts, memOpts);

        expect(mockInvoker).toHaveBeenCalledWith('original prompt', expect.any(Object));
    });

    it('does not modify prompt when builder returns null', async () => {
        mockGetSystemPromptBlock.mockReturnValue(null);

        await withMemory(mockInvoker, 'my prompt', baseOpts, memOpts);

        expect(mockInvoker).toHaveBeenCalledWith('my prompt', expect.any(Object));
    });

    it('calls aggregateIfNeeded after AI call', async () => {
        await withMemory(mockInvoker, 'prompt', baseOpts, {
            ...memOpts,
            repoHash: 'abc123',
        });

        expect(mockAggregateIfNeeded).toHaveBeenCalledWith(mockInvoker, 'both', 'abc123');
    });

    it('returns original AIInvokerResult unchanged', async () => {
        const expectedResult = makeResult('specific response');
        mockInvoker.mockResolvedValue(expectedResult);

        const result = await withMemory(mockInvoker, 'prompt', baseOpts, memOpts);

        expect(result).toBe(expectedResult);
    });

    it('handles prompt builder failure gracefully', async () => {
        (MemoryPromptBuilder as unknown as Mock).mockImplementation(() => {
            throw new Error('disk');
        });

        const result = await withMemory(mockInvoker, 'original prompt', baseOpts, memOpts);

        expect(result).toBeDefined();
        expect(mockInvoker).toHaveBeenCalledWith('original prompt', expect.any(Object));
        expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
            expect.objectContaining({ err: expect.any(Error) }),
            expect.stringContaining('prompt builder failed'),
        );
    });

    it('handles aggregate failure gracefully', async () => {
        const expectedResult = makeResult();
        mockInvoker.mockResolvedValue(expectedResult);
        mockAggregateIfNeeded.mockRejectedValue(new Error('timeout'));

        const result = await withMemory(mockInvoker, 'prompt', baseOpts, memOpts);

        expect(result).toBe(expectedResult);
        expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
            expect.objectContaining({ err: expect.any(Error) }),
            expect.stringContaining('aggregation check failed'),
        );
    });

    it('preserves existing tools in invokerOptions', async () => {
        const existingTool = { name: 'existing_tool' } as any;
        const optsWithTools: AIInvokerOptions = { ...baseOpts, tools: [existingTool] };

        await withMemory(mockInvoker, 'prompt', optsWithTools, memOpts);

        const calledOpts = mockInvoker.mock.calls[0][1] as AIInvokerOptions;
        expect(calledOpts.tools).toEqual([existingTool, mockMemoryTool]);
    });

    it('does not inject tool when boundedStores is not provided', async () => {
        const optsWithoutBounded: WithMemoryOptions = { store: mockStore, source: 'test-pipeline' };
        await withMemory(mockInvoker, 'prompt', baseOpts, optsWithoutBounded);

        const calledOpts = mockInvoker.mock.calls[0][1] as AIInvokerOptions;
        expect(calledOpts.tools ?? []).toEqual([]);
    });

    it('skips prompt builder when boundedRepoStore is not provided', async () => {
        const optsNoBounded: WithMemoryOptions = { store: mockStore, source: 'test-pipeline' };
        await withMemory(mockInvoker, 'prompt', baseOpts, optsNoBounded);

        expect(MemoryPromptBuilder).not.toHaveBeenCalled();
        expect(mockInvoker).toHaveBeenCalledWith('prompt', expect.any(Object));
    });

    it('aggregation uses correct level and repoHash', async () => {
        const repoOpts: WithMemoryOptions = {
            ...memOpts,
            level: 'repo',
            repoHash: 'abc123',
        };

        await withMemory(mockInvoker, 'prompt', baseOpts, repoOpts);

        expect(mockAggregateIfNeeded).toHaveBeenCalledWith(mockInvoker, 'repo', 'abc123');
    });

    it('full cycle with level: system → aggregation called at system level', async () => {
        const sysOpts: WithMemoryOptions = { ...memOpts, level: 'system' };

        await withMemory(mockInvoker, 'prompt', baseOpts, sysOpts);

        expect(mockAggregateIfNeeded).toHaveBeenCalledWith(mockInvoker, 'system', undefined);
    });

    it('full cycle with level: both (default) → aggregation called with both', async () => {
        await withMemory(mockInvoker, 'prompt', baseOpts, { ...memOpts, repoHash: 'xyz' });

        expect(mockAggregateIfNeeded).toHaveBeenCalledWith(mockInvoker, 'both', 'xyz');
    });

    it('AI call fails → error propagated, not swallowed', async () => {
        const aiError = new Error('AI service down');
        mockInvoker.mockRejectedValue(aiError);

        await expect(withMemory(mockInvoker, 'prompt', baseOpts, memOpts)).rejects.toThrow(
            'AI service down',
        );
    });
});
