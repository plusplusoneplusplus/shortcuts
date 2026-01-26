/**
 * Tests for Reducers
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect } from 'vitest';
import {
    IdentityReducer,
    FlattenReducer,
    AggregatingReducer,
    DeterministicReducer,
    createDeterministicReducer,
    StringDeduplicationReducer,
    NumericAggregationReducer
} from '../../src/map-reduce/reducers';
import { MapResult, ReduceContext } from '../../src/map-reduce/types';

const defaultContext: ReduceContext = {
    executionId: 'test-123',
    mapPhaseTimeMs: 1000,
    successfulMaps: 3,
    failedMaps: 0
};

function createMapResult<T>(output: T, success: boolean = true): MapResult<T> {
    return {
        workItemId: `item-${Math.random()}`,
        success,
        output: success ? output : undefined,
        executionTimeMs: 100
    };
}

describe('IdentityReducer', () => {
    it('passes through all successful outputs', async () => {
        const reducer = new IdentityReducer<number>();
        const results = [
            createMapResult(1),
            createMapResult(2),
            createMapResult(3)
        ];

        const result = await reducer.reduce(results, defaultContext);

        expect(result.output).toEqual([1, 2, 3]);
        expect(result.stats.inputCount).toBe(3);
        expect(result.stats.outputCount).toBe(3);
    });

    it('filters out failed results', async () => {
        const reducer = new IdentityReducer<string>();
        const results = [
            createMapResult('a'),
            createMapResult<string>('', false),
            createMapResult('c')
        ];

        const result = await reducer.reduce(results, defaultContext);

        expect(result.output).toEqual(['a', 'c']);
        expect(result.stats.outputCount).toBe(2);
    });

    it('returns empty array for no results', async () => {
        const reducer = new IdentityReducer<number>();
        const result = await reducer.reduce([], defaultContext);

        expect(result.output).toEqual([]);
        expect(result.stats.usedAIReduce).toBe(false);
    });
});

describe('FlattenReducer', () => {
    it('flattens array outputs', async () => {
        const reducer = new FlattenReducer<number>();
        const results = [
            createMapResult([1, 2]),
            createMapResult([3, 4]),
            createMapResult([5])
        ];

        const result = await reducer.reduce(results, defaultContext);

        expect(result.output).toEqual([1, 2, 3, 4, 5]);
    });

    it('handles empty arrays', async () => {
        const reducer = new FlattenReducer<string>();
        const results = [
            createMapResult(['a']),
            createMapResult([]),
            createMapResult(['b', 'c'])
        ];

        const result = await reducer.reduce(results, defaultContext);

        expect(result.output).toEqual(['a', 'b', 'c']);
    });

    it('reports correct input count', async () => {
        const reducer = new FlattenReducer<number>();
        const results = [
            createMapResult([1, 2, 3]),
            createMapResult([4, 5])
        ];

        const result = await reducer.reduce(results, defaultContext);

        expect(result.stats.inputCount).toBe(5); // Total items in arrays
        expect(result.stats.outputCount).toBe(5);
    });
});

describe('AggregatingReducer', () => {
    it('aggregates with custom function', async () => {
        const reducer = new AggregatingReducer<number, number>(
            (outputs) => outputs.reduce((sum, n) => sum + n, 0),
            0
        );
        const results = [
            createMapResult(10),
            createMapResult(20),
            createMapResult(30)
        ];

        const result = await reducer.reduce(results, defaultContext);

        expect(result.output).toBe(60);
        expect(result.stats.outputCount).toBe(1);
    });

    it('returns default for empty input', async () => {
        const reducer = new AggregatingReducer<string, string>(
            (outputs) => outputs.join(','),
            'default'
        );

        const result = await reducer.reduce([], defaultContext);

        expect(result.output).toBe('default');
    });

    it('handles complex aggregation', async () => {
        const reducer = new AggregatingReducer<{ count: number }, { total: number }>(
            (outputs) => ({ total: outputs.reduce((sum, o) => sum + o.count, 0) }),
            { total: 0 }
        );
        const results = [
            createMapResult({ count: 5 }),
            createMapResult({ count: 3 }),
            createMapResult({ count: 7 })
        ];

        const result = await reducer.reduce(results, defaultContext);

        expect(result.output).toEqual({ total: 15 });
    });
});

describe('DeterministicReducer', () => {
    interface TestItem {
        id: string;
        key: string;
        value: number;
        [key: string]: unknown;  // Index signature for Deduplicatable
    }

    it('deduplicates items by key', async () => {
        const reducer = createDeterministicReducer<TestItem>({
            getKey: (item) => item.key,
            merge: (existing, newItem) => ({
                ...existing,
                value: Math.max(existing.value, newItem.value)
            })
        });

        const results = [
            createMapResult([
                { id: '1', key: 'a', value: 10 },
                { id: '2', key: 'b', value: 20 }
            ]),
            createMapResult([
                { id: '3', key: 'a', value: 15 }, // Duplicate key 'a'
                { id: '4', key: 'c', value: 30 }
            ])
        ];

        const result = await reducer.reduce(results, defaultContext);

        expect(result.output.items.length).toBe(3);
        
        const itemA = result.output.items.find(i => i.key === 'a');
        expect(itemA?.value).toBe(15); // Max of 10 and 15
        
        expect(result.stats.mergedCount).toBe(1);
    });

    it('sorts items when sort function provided', async () => {
        const reducer = createDeterministicReducer<TestItem>({
            getKey: (item) => item.id,
            merge: (existing) => existing,
            sort: (a, b) => b.value - a.value // Descending by value
        });

        const results = [
            createMapResult([
                { id: '1', key: 'a', value: 10 },
                { id: '2', key: 'b', value: 30 },
                { id: '3', key: 'c', value: 20 }
            ])
        ];

        const result = await reducer.reduce(results, defaultContext);

        expect(result.output.items[0].value).toBe(30);
        expect(result.output.items[1].value).toBe(20);
        expect(result.output.items[2].value).toBe(10);
    });

    it('includes summary when summarize function provided', async () => {
        const reducer = createDeterministicReducer<TestItem>({
            getKey: (item) => item.id,
            merge: (existing) => existing,
            summarize: (items) => ({
                totalValue: items.reduce((sum, i) => sum + i.value, 0),
                count: items.length
            })
        });

        const results = [
            createMapResult([
                { id: '1', key: 'a', value: 10 },
                { id: '2', key: 'b', value: 20 }
            ])
        ];

        const result = await reducer.reduce(results, defaultContext);

        expect(result.output.summary).toEqual({
            totalValue: 30,
            count: 2
        });
    });

    it('returns empty output for no results', async () => {
        const reducer = createDeterministicReducer<TestItem>({
            getKey: (item) => item.id,
            merge: (existing) => existing
        });

        const result = await reducer.reduce([], defaultContext);

        expect(result.output.items).toEqual([]);
        expect(result.stats.inputCount).toBe(0);
    });
});

describe('StringDeduplicationReducer', () => {
    it('deduplicates strings case-sensitively by default', async () => {
        const reducer = new StringDeduplicationReducer();
        const results = [
            createMapResult(['apple', 'banana']),
            createMapResult(['Apple', 'banana', 'cherry'])
        ];

        const result = await reducer.reduce(results, defaultContext);

        // 'apple' and 'Apple' are different
        expect(result.output.items.length).toBe(4);
        expect(result.output.items).toContain('apple');
        expect(result.output.items).toContain('Apple');
    });

    it('deduplicates strings case-insensitively when configured', async () => {
        const reducer = new StringDeduplicationReducer(false);
        const results = [
            createMapResult(['apple', 'Banana']),
            createMapResult(['APPLE', 'banana', 'cherry'])
        ];

        const result = await reducer.reduce(results, defaultContext);

        expect(result.output.items.length).toBe(3);
    });

    it('reports correct merge count', async () => {
        const reducer = new StringDeduplicationReducer();
        const results = [
            createMapResult(['a', 'b', 'a']),
            createMapResult(['b', 'c', 'a'])
        ];

        const result = await reducer.reduce(results, defaultContext);

        expect(result.output.items.length).toBe(3);
        expect(result.stats.mergedCount).toBe(3); // 6 - 3
    });
});

describe('NumericAggregationReducer', () => {
    it('calculates sum, average, min, max', async () => {
        const reducer = new NumericAggregationReducer();
        const results = [
            createMapResult([10, 20, 30]),
            createMapResult([40, 50])
        ];

        const result = await reducer.reduce(results, defaultContext);

        expect(result.output.sum).toBe(150);
        expect(result.output.average).toBe(30);
        expect(result.output.min).toBe(10);
        expect(result.output.max).toBe(50);
        expect(result.output.count).toBe(5);
    });

    it('handles single number', async () => {
        const reducer = new NumericAggregationReducer();
        const results = [createMapResult([42])];

        const result = await reducer.reduce(results, defaultContext);

        expect(result.output.sum).toBe(42);
        expect(result.output.average).toBe(42);
        expect(result.output.min).toBe(42);
        expect(result.output.max).toBe(42);
    });

    it('returns zeros for empty input', async () => {
        const reducer = new NumericAggregationReducer();
        const result = await reducer.reduce([], defaultContext);

        expect(result.output.sum).toBe(0);
        expect(result.output.average).toBe(0);
        expect(result.output.count).toBe(0);
    });

    it('handles negative numbers', async () => {
        const reducer = new NumericAggregationReducer();
        const results = [createMapResult([-10, 0, 10])];

        const result = await reducer.reduce(results, defaultContext);

        expect(result.output.sum).toBe(0);
        expect(result.output.min).toBe(-10);
        expect(result.output.max).toBe(10);
    });
});
