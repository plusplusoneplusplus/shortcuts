import { describe, it, expect } from 'vitest';
import {
    DeterministicReducer,
    StringDeduplicationReducer,
    NumericAggregationReducer,
} from '../../src/map-reduce/reducers/deterministic';
import type { MapResult, ReduceContext } from '../../src/map-reduce/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<ReduceContext> = {}): ReduceContext {
    return {
        executionId: 'test-exec',
        mapPhaseTimeMs: 10,
        successfulMaps: 0,
        failedMaps: 0,
        ...overrides,
    };
}

function makeResult<T>(output: T, workItemId = 'item'): MapResult<T> {
    return { workItemId, success: true, output, executionTimeMs: 1 };
}

function makeFailedResult<T>(workItemId = 'item'): MapResult<T> {
    return { workItemId, success: false, error: 'failed', executionTimeMs: 1 };
}

// ---------------------------------------------------------------------------
// DeterministicReducer
// ---------------------------------------------------------------------------

describe('DeterministicReducer', () => {
    const reducer = new DeterministicReducer({
        getKey: item => item.id as string,
        merge: (existing, newItem) => ({
            ...existing,
            count: ((existing.count as number) || 1) + 1,
        }),
    });

    it('collects all items from successful map results', async () => {
        const results: MapResult<{ id: string }[]>[] = [
            makeResult([{ id: 'a' }, { id: 'b' }], 'item1'),
            makeResult([{ id: 'c' }], 'item2'),
        ];
        const { output } = await reducer.reduce(results, makeCtx({ successfulMaps: 2 }));
        expect(output.items).toHaveLength(3);
    });

    it('deduplicates items with the same key by merging them', async () => {
        const results: MapResult<{ id: string }[]>[] = [
            makeResult([{ id: 'dup' }], 'item1'),
            makeResult([{ id: 'dup' }], 'item2'),
        ];
        const { output } = await reducer.reduce(results, makeCtx({ successfulMaps: 2 }));
        expect(output.items).toHaveLength(1);
    });

    it('skips failed map results', async () => {
        const results: MapResult<{ id: string }[]>[] = [
            makeResult([{ id: 'a' }], 'item1'),
            makeFailedResult('item2'),
        ];
        const { output } = await reducer.reduce(results, makeCtx({ successfulMaps: 1, failedMaps: 1 }));
        expect(output.items).toHaveLength(1);
    });

    it('applies sort when sort function is provided', async () => {
        const sortedReducer = new DeterministicReducer({
            getKey: (item: { id: string }) => item.id,
            merge: (e, _n) => e,
            sort: (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id),
        });
        const results: MapResult<{ id: string }[]>[] = [
            makeResult([{ id: 'z' }, { id: 'a' }, { id: 'm' }]),
        ];
        const { output } = await sortedReducer.reduce(results, makeCtx({ successfulMaps: 1 }));
        expect(output.items.map((i: { id: string }) => i.id)).toEqual(['a', 'm', 'z']);
    });

    it('calls summarize when provided', async () => {
        const summarizeFn = (items: { id: string }[]) => ({ total: items.length });
        const summarizingReducer = new DeterministicReducer({
            getKey: (item: { id: string }) => item.id,
            merge: (e, _n) => e,
            summarize: summarizeFn,
        });
        const results: MapResult<{ id: string }[]>[] = [
            makeResult([{ id: 'a' }, { id: 'b' }]),
        ];
        const { output } = await summarizingReducer.reduce(results, makeCtx({ successfulMaps: 1 }));
        expect(output.summary).toEqual({ total: 2 });
    });

    it('returns correct reduce stats', async () => {
        const results: MapResult<{ id: string }[]>[] = [
            makeResult([{ id: 'a' }, { id: 'a' }, { id: 'b' }]),
        ];
        const { stats } = await reducer.reduce(results, makeCtx({ successfulMaps: 1 }));
        expect(stats.inputCount).toBe(3);
        expect(stats.outputCount).toBe(2); // 'a' deduplicated
        expect(stats.mergedCount).toBe(1);
        expect(stats.usedAIReduce).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// StringDeduplicationReducer
// ---------------------------------------------------------------------------

describe('StringDeduplicationReducer', () => {
    it('deduplicates strings across map results', async () => {
        const reducer = new StringDeduplicationReducer();
        const results: MapResult<string[]>[] = [
            makeResult(['a', 'b', 'c']),
            makeResult(['b', 'c', 'd']),
        ];
        const { output } = await reducer.reduce(results, makeCtx({ successfulMaps: 2 }));
        expect(output.items).toHaveLength(4);
        expect(new Set(output.items).size).toBe(4);
    });

    it('is case-sensitive by default', async () => {
        const reducer = new StringDeduplicationReducer(true);
        const results: MapResult<string[]>[] = [makeResult(['A', 'a'])];
        const { output } = await reducer.reduce(results, makeCtx({ successfulMaps: 1 }));
        expect(output.items).toHaveLength(2);
    });

    it('is case-insensitive when configured', async () => {
        const reducer = new StringDeduplicationReducer(false);
        const results: MapResult<string[]>[] = [makeResult(['Hello', 'hello', 'HELLO'])];
        const { output } = await reducer.reduce(results, makeCtx({ successfulMaps: 1 }));
        expect(output.items).toHaveLength(1);
    });

    it('returns empty items for no successful results', async () => {
        const reducer = new StringDeduplicationReducer();
        const results: MapResult<string[]>[] = [makeFailedResult()];
        const { output } = await reducer.reduce(results, makeCtx({ failedMaps: 1 }));
        expect(output.items).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// NumericAggregationReducer
// ---------------------------------------------------------------------------

describe('NumericAggregationReducer', () => {
    it('computes sum, average, min, max, count correctly', async () => {
        const reducer = new NumericAggregationReducer();
        const results: MapResult<number[]>[] = [
            makeResult([1, 2, 3]),
            makeResult([4, 5]),
        ];
        const { output } = await reducer.reduce(results, makeCtx({ successfulMaps: 2 }));
        expect(output.sum).toBe(15);
        expect(output.average).toBe(3);
        expect(output.min).toBe(1);
        expect(output.max).toBe(5);
        expect(output.count).toBe(5);
    });

    it('returns zeros for empty input', async () => {
        const reducer = new NumericAggregationReducer();
        const { output } = await reducer.reduce([], makeCtx());
        expect(output.sum).toBe(0);
        expect(output.count).toBe(0);
    });
});
