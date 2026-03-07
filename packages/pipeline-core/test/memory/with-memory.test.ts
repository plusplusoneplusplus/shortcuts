import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { AIInvoker, AIInvokerResult, AIInvokerOptions } from '../../src/ai/types';
import type { MemoryStore, MemoryLevel } from '../../src/memory/types';

vi.mock('../../src/memory/memory-retriever');
vi.mock('../../src/memory/write-memory-tool');
vi.mock('../../src/memory/memory-aggregator');
const mockLoggerInstance = { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() };
vi.mock('../../src/logger', () => ({
    getLogger: vi.fn(() => mockLoggerInstance),
    LogCategory: { Memory: 'Memory' },
}));

import { withMemory, type WithMemoryOptions } from '../../src/memory/with-memory';
import { MemoryRetriever } from '../../src/memory/memory-retriever';
import { createWriteMemoryTool } from '../../src/memory/write-memory-tool';
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

const mockMemoryTool = { name: 'write_memory' } as any;

describe('withMemory', () => {
    let mockInvoker: Mock<AIInvoker>;
    let mockStore: MemoryStore;
    let baseOpts: AIInvokerOptions;
    let memOpts: WithMemoryOptions;
    let mockRetrieve: Mock;
    let mockAggregateIfNeeded: Mock;

    beforeEach(() => {
        vi.clearAllMocks();

        mockInvoker = vi.fn<AIInvoker>().mockResolvedValue(makeResult());
        mockStore = makeMockStore();
        baseOpts = { model: 'test-model' };
        memOpts = { store: mockStore, source: 'test-pipeline' };

        // Setup MemoryRetriever mock
        mockRetrieve = vi.fn().mockResolvedValue(null);
        (MemoryRetriever as unknown as Mock).mockImplementation(() => ({
            retrieve: mockRetrieve,
        }));

        // Setup createWriteMemoryTool mock
        (createWriteMemoryTool as Mock).mockReturnValue({
            tool: mockMemoryTool,
            getWrittenFacts: vi.fn().mockReturnValue([]),
        });

        // Setup MemoryAggregator mock
        mockAggregateIfNeeded = vi.fn().mockResolvedValue(false);
        (MemoryAggregator as unknown as Mock).mockImplementation(() => ({
            aggregateIfNeeded: mockAggregateIfNeeded,
        }));
    });

    it('calls retriever before invoking AI', async () => {
        const callOrder: string[] = [];
        mockRetrieve.mockImplementation(async () => {
            callOrder.push('retrieve');
            return null;
        });
        mockInvoker.mockImplementation(async () => {
            callOrder.push('invoke');
            return makeResult();
        });

        await withMemory(mockInvoker, 'prompt', baseOpts, memOpts);

        expect(callOrder).toEqual(['retrieve', 'invoke']);
    });

    it('prepends retrieved context to prompt', async () => {
        mockRetrieve.mockResolvedValue('## Context from Memory\n\nSome facts');

        await withMemory(mockInvoker, 'original prompt', baseOpts, memOpts);

        expect(mockInvoker).toHaveBeenCalledWith(
            '## Context from Memory\n\nSome facts\n\noriginal prompt',
            expect.any(Object),
        );
    });

    it('injects write_memory tool into AI call', async () => {
        await withMemory(mockInvoker, 'prompt', baseOpts, memOpts);

        const calledOpts = mockInvoker.mock.calls[0][1] as AIInvokerOptions;
        expect(calledOpts.tools).toContain(mockMemoryTool);
    });

    it('passes through when no memory exists', async () => {
        mockRetrieve.mockResolvedValue(null);

        await withMemory(mockInvoker, 'original prompt', baseOpts, memOpts);

        expect(mockInvoker).toHaveBeenCalledWith('original prompt', expect.any(Object));
    });

    it('does not modify prompt when retriever returns null for empty', async () => {
        // MemoryRetriever normalizes empty string to null internally
        mockRetrieve.mockResolvedValue(null);

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

    it('handles retrieve failure gracefully', async () => {
        mockRetrieve.mockRejectedValue(new Error('disk'));

        const result = await withMemory(mockInvoker, 'original prompt', baseOpts, memOpts);

        expect(result).toBeDefined();
        expect(mockInvoker).toHaveBeenCalledWith('original prompt', expect.any(Object));
        expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
            'Memory',
            expect.stringContaining('retrieve failed'),
        );
    });

    it('handles aggregate failure gracefully', async () => {
        const expectedResult = makeResult();
        mockInvoker.mockResolvedValue(expectedResult);
        mockAggregateIfNeeded.mockRejectedValue(new Error('timeout'));

        const result = await withMemory(mockInvoker, 'prompt', baseOpts, memOpts);

        expect(result).toBe(expectedResult);
        expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
            'Memory',
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
});
