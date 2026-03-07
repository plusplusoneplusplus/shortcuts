import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { AIInvoker, AIInvokerResult, AIInvokerOptions } from '../../src/ai/types';
import type { ToolCallCacheStore, ToolCallFilter } from '../../src/memory/tool-call-cache-types';
import type { ToolEvent } from '../../src/copilot-sdk-wrapper/types';

vi.mock('../../src/memory/tool-call-capture');
vi.mock('../../src/memory/tool-call-cache-aggregator');
const mockLoggerInstance = { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() };
vi.mock('../../src/logger', () => ({
    getLogger: vi.fn(() => mockLoggerInstance),
    LogCategory: { Memory: 'Memory' },
}));

import { withToolCallCache, type WithToolCallCacheOptions } from '../../src/memory/with-tool-call-cache';
import { ToolCallCapture } from '../../src/memory/tool-call-capture';
import { ToolCallCacheAggregator } from '../../src/memory/tool-call-cache-aggregator';

function makeResult(response = 'AI response'): AIInvokerResult {
    return { success: true, response, error: undefined };
}

function makeMockStore(): ToolCallCacheStore {
    return {
        writeRaw: vi.fn(),
        readRaw: vi.fn(),
        listRaw: vi.fn(),
        deleteRaw: vi.fn(),
        readConsolidated: vi.fn(),
        writeConsolidated: vi.fn(),
        readConsolidatedIndex: vi.fn(),
        readEntryAnswer: vi.fn(),
        writeConsolidatedEntry: vi.fn(),
        deleteConsolidatedEntry: vi.fn(),
        readIndex: vi.fn(),
        updateIndex: vi.fn(),
        getStats: vi.fn(),
        clear: vi.fn(),
    } as unknown as ToolCallCacheStore;
}

const alwaysFilter: ToolCallFilter = () => true;

describe('withToolCallCache', () => {
    let mockInvoker: Mock<AIInvoker>;
    let mockStore: ToolCallCacheStore;
    let baseOpts: AIInvokerOptions;
    let cacheOpts: WithToolCallCacheOptions;
    let mockCaptureHandler: Mock;
    let mockAggregateIfNeeded: Mock;

    beforeEach(() => {
        vi.clearAllMocks();

        mockInvoker = vi.fn<AIInvoker>().mockResolvedValue(makeResult());
        mockStore = makeMockStore();
        baseOpts = { model: 'test-model' };
        cacheOpts = { store: mockStore, filter: alwaysFilter };

        // Setup ToolCallCapture mock
        mockCaptureHandler = vi.fn();
        (ToolCallCapture as unknown as Mock).mockImplementation(() => ({
            createToolEventHandler: vi.fn().mockReturnValue(mockCaptureHandler),
        }));

        // Setup ToolCallCacheAggregator mock
        mockAggregateIfNeeded = vi.fn().mockResolvedValue(false);
        (ToolCallCacheAggregator as unknown as Mock).mockImplementation(() => ({
            aggregateIfNeeded: mockAggregateIfNeeded,
        }));
    });

    it('wires onToolEvent correctly', async () => {
        await withToolCallCache(mockInvoker, 'prompt', baseOpts, cacheOpts);

        const calledOpts = mockInvoker.mock.calls[0][1] as any;
        expect(calledOpts.onToolEvent).toBeDefined();

        // Fire the wired handler and verify capture handler receives the event
        const event: ToolEvent = { type: 'tool-start', toolCallId: 'tc1', toolName: 'grep' };
        calledOpts.onToolEvent(event);
        expect(mockCaptureHandler).toHaveBeenCalledWith(event);
    });

    it('preserves existing onToolEvent callback', async () => {
        const existingSpy = vi.fn();
        const optsWithEvent = { ...baseOpts, onToolEvent: existingSpy };

        await withToolCallCache(mockInvoker, 'prompt', optsWithEvent, cacheOpts);

        const calledOpts = mockInvoker.mock.calls[0][1] as any;
        const event: ToolEvent = { type: 'tool-complete', toolCallId: 'tc2' };
        calledOpts.onToolEvent(event);

        // Existing called first, then capture
        expect(existingSpy).toHaveBeenCalledWith(event);
        expect(mockCaptureHandler).toHaveBeenCalledWith(event);
    });

    it('existing onToolEvent error does not break capture', async () => {
        const throwingSpy = vi.fn(() => { throw new Error('boom'); });
        const optsWithEvent = { ...baseOpts, onToolEvent: throwingSpy };

        await withToolCallCache(mockInvoker, 'prompt', optsWithEvent, cacheOpts);

        const calledOpts = mockInvoker.mock.calls[0][1] as any;
        const event: ToolEvent = { type: 'tool-start', toolCallId: 'tc3', toolName: 'view' };
        calledOpts.onToolEvent(event);

        // Capture handler should still be called despite existing handler throwing
        expect(mockCaptureHandler).toHaveBeenCalledWith(event);
    });

    it('triggers aggregation post-invocation', async () => {
        await withToolCallCache(mockInvoker, 'prompt', baseOpts, {
            ...cacheOpts,
            repoHash: 'abc123',
        });

        expect(mockAggregateIfNeeded).toHaveBeenCalledWith(mockInvoker);
    });

    it('aggregation uses custom batchThreshold', async () => {
        await withToolCallCache(mockInvoker, 'prompt', baseOpts, {
            ...cacheOpts,
            batchThreshold: 20,
        });

        expect(ToolCallCacheAggregator).toHaveBeenCalledWith(mockStore, { batchThreshold: 20 });
    });

    it('returns AI result unchanged (same object reference)', async () => {
        const expectedResult = makeResult('specific response');
        mockInvoker.mockResolvedValue(expectedResult);

        const result = await withToolCallCache(mockInvoker, 'prompt', baseOpts, cacheOpts);

        expect(result).toBe(expectedResult);
    });

    it('graceful on capture creation error', async () => {
        (ToolCallCapture as unknown as Mock).mockImplementation(() => {
            throw new Error('capture init failed');
        });

        const expectedResult = makeResult();
        mockInvoker.mockResolvedValue(expectedResult);

        const result = await withToolCallCache(mockInvoker, 'prompt', baseOpts, cacheOpts);

        expect(result).toBe(expectedResult);
        expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
            'Memory',
            expect.stringContaining('capture setup failed'),
        );
        // onToolEvent should not be set since capture failed
        const calledOpts = mockInvoker.mock.calls[0][1] as any;
        expect(calledOpts.onToolEvent).toBeUndefined();
    });

    it('graceful on aggregation error', async () => {
        const expectedResult = makeResult();
        mockInvoker.mockResolvedValue(expectedResult);
        mockAggregateIfNeeded.mockRejectedValue(new Error('timeout'));

        const result = await withToolCallCache(mockInvoker, 'prompt', baseOpts, cacheOpts);

        expect(result).toBe(expectedResult);
        expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
            'Memory',
            expect.stringContaining('aggregation check failed'),
        );
    });

    it('passes prompt through unchanged', async () => {
        await withToolCallCache(mockInvoker, 'my exact prompt', baseOpts, cacheOpts);

        expect(mockInvoker).toHaveBeenCalledWith('my exact prompt', expect.any(Object));
    });

    it('uses default batchThreshold of 10', async () => {
        await withToolCallCache(mockInvoker, 'prompt', baseOpts, cacheOpts);

        expect(ToolCallCacheAggregator).toHaveBeenCalledWith(mockStore, { batchThreshold: 10 });
    });

    describe('git-remote level', () => {
        it('warns when level is git-remote but remoteHash is missing', async () => {
            await withToolCallCache(mockInvoker, 'prompt', baseOpts, {
                ...cacheOpts,
                level: 'git-remote',
                // No remoteHash
            });

            expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
                'Memory',
                expect.stringContaining('git-remote'),
            );
            expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
                'Memory',
                expect.stringContaining('remoteHash'),
            );
        });

        it('does not warn when level is git-remote and remoteHash is provided', async () => {
            await withToolCallCache(mockInvoker, 'prompt', baseOpts, {
                ...cacheOpts,
                level: 'git-remote',
                remoteHash: 'abcdef1234567890',
            });

            // No warning about missing remoteHash
            const warnCalls = mockLoggerInstance.warn.mock.calls;
            const relevantWarns = warnCalls.filter(
                ([, msg]: [unknown, unknown]) => typeof msg === 'string' && msg.includes('remoteHash'),
            );
            expect(relevantWarns).toHaveLength(0);
        });

        it('still invokes AI when level is git-remote and remoteHash is missing', async () => {
            const expectedResult = makeResult('ok');
            mockInvoker.mockResolvedValue(expectedResult);

            const result = await withToolCallCache(mockInvoker, 'prompt', baseOpts, {
                ...cacheOpts,
                level: 'git-remote',
            });

            expect(mockInvoker).toHaveBeenCalledOnce();
            expect(result).toBe(expectedResult);
        });
    });
});
