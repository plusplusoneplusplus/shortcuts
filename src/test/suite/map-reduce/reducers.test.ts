/**
 * Tests for Reducers
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
import {
    IdentityReducer,
    FlattenReducer,
    AggregatingReducer,
    DeterministicReducer,
    createDeterministicReducer,
    StringDeduplicationReducer,
    NumericAggregationReducer
} from '../../../shortcuts/map-reduce/reducers';
import { MapResult, ReduceContext } from '../../../shortcuts/map-reduce/types';

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

suite('IdentityReducer', () => {
    test('passes through all successful outputs', async () => {
        const reducer = new IdentityReducer<number>();
        const results = [
            createMapResult(1),
            createMapResult(2),
            createMapResult(3)
        ];

        const result = await reducer.reduce(results, defaultContext);

        assert.deepStrictEqual(result.output, [1, 2, 3]);
        assert.strictEqual(result.stats.inputCount, 3);
        assert.strictEqual(result.stats.outputCount, 3);
    });

    test('filters out failed results', async () => {
        const reducer = new IdentityReducer<string>();
        const results = [
            createMapResult('a'),
            createMapResult<string>('', false),
            createMapResult('c')
        ];

        const result = await reducer.reduce(results, defaultContext);

        assert.deepStrictEqual(result.output, ['a', 'c']);
        assert.strictEqual(result.stats.outputCount, 2);
    });

    test('returns empty array for no results', async () => {
        const reducer = new IdentityReducer<number>();
        const result = await reducer.reduce([], defaultContext);

        assert.deepStrictEqual(result.output, []);
        assert.strictEqual(result.stats.usedAIReduce, false);
    });
});

suite('FlattenReducer', () => {
    test('flattens array outputs', async () => {
        const reducer = new FlattenReducer<number>();
        const results = [
            createMapResult([1, 2]),
            createMapResult([3, 4]),
            createMapResult([5])
        ];

        const result = await reducer.reduce(results, defaultContext);

        assert.deepStrictEqual(result.output, [1, 2, 3, 4, 5]);
    });

    test('handles empty arrays', async () => {
        const reducer = new FlattenReducer<string>();
        const results = [
            createMapResult(['a']),
            createMapResult([]),
            createMapResult(['b', 'c'])
        ];

        const result = await reducer.reduce(results, defaultContext);

        assert.deepStrictEqual(result.output, ['a', 'b', 'c']);
    });

    test('reports correct input count', async () => {
        const reducer = new FlattenReducer<number>();
        const results = [
            createMapResult([1, 2, 3]),
            createMapResult([4, 5])
        ];

        const result = await reducer.reduce(results, defaultContext);

        assert.strictEqual(result.stats.inputCount, 5); // Total items in arrays
        assert.strictEqual(result.stats.outputCount, 5);
    });
});

suite('AggregatingReducer', () => {
    test('aggregates with custom function', async () => {
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

        assert.strictEqual(result.output, 60);
        assert.strictEqual(result.stats.outputCount, 1);
    });

    test('returns default for empty input', async () => {
        const reducer = new AggregatingReducer<string, string>(
            (outputs) => outputs.join(','),
            'default'
        );

        const result = await reducer.reduce([], defaultContext);

        assert.strictEqual(result.output, 'default');
    });

    test('handles complex aggregation', async () => {
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

        assert.deepStrictEqual(result.output, { total: 15 });
    });
});

suite('DeterministicReducer', () => {
    interface TestItem {
        id: string;
        key: string;
        value: number;
        [key: string]: unknown;  // Index signature for Deduplicatable
    }

    test('deduplicates items by key', async () => {
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

        assert.strictEqual(result.output.items.length, 3);
        
        const itemA = result.output.items.find(i => i.key === 'a');
        assert.strictEqual(itemA?.value, 15); // Max of 10 and 15
        
        assert.strictEqual(result.stats.mergedCount, 1);
    });

    test('sorts items when sort function provided', async () => {
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

        assert.strictEqual(result.output.items[0].value, 30);
        assert.strictEqual(result.output.items[1].value, 20);
        assert.strictEqual(result.output.items[2].value, 10);
    });

    test('includes summary when summarize function provided', async () => {
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

        assert.deepStrictEqual(result.output.summary, {
            totalValue: 30,
            count: 2
        });
    });

    test('returns empty output for no results', async () => {
        const reducer = createDeterministicReducer<TestItem>({
            getKey: (item) => item.id,
            merge: (existing) => existing
        });

        const result = await reducer.reduce([], defaultContext);

        assert.deepStrictEqual(result.output.items, []);
        assert.strictEqual(result.stats.inputCount, 0);
    });
});

suite('StringDeduplicationReducer', () => {
    test('deduplicates strings case-sensitively by default', async () => {
        const reducer = new StringDeduplicationReducer();
        const results = [
            createMapResult(['apple', 'banana']),
            createMapResult(['Apple', 'banana', 'cherry'])
        ];

        const result = await reducer.reduce(results, defaultContext);

        // 'apple' and 'Apple' are different
        assert.strictEqual(result.output.items.length, 4);
        assert.ok(result.output.items.includes('apple'));
        assert.ok(result.output.items.includes('Apple'));
    });

    test('deduplicates strings case-insensitively when configured', async () => {
        const reducer = new StringDeduplicationReducer(false);
        const results = [
            createMapResult(['apple', 'Banana']),
            createMapResult(['APPLE', 'banana', 'cherry'])
        ];

        const result = await reducer.reduce(results, defaultContext);

        assert.strictEqual(result.output.items.length, 3);
    });

    test('reports correct merge count', async () => {
        const reducer = new StringDeduplicationReducer();
        const results = [
            createMapResult(['a', 'b', 'a']),
            createMapResult(['b', 'c', 'a'])
        ];

        const result = await reducer.reduce(results, defaultContext);

        assert.strictEqual(result.output.items.length, 3);
        assert.strictEqual(result.stats.mergedCount, 3); // 6 - 3
    });
});

suite('NumericAggregationReducer', () => {
    test('calculates sum, average, min, max', async () => {
        const reducer = new NumericAggregationReducer();
        const results = [
            createMapResult([10, 20, 30]),
            createMapResult([40, 50])
        ];

        const result = await reducer.reduce(results, defaultContext);

        assert.strictEqual(result.output.sum, 150);
        assert.strictEqual(result.output.average, 30);
        assert.strictEqual(result.output.min, 10);
        assert.strictEqual(result.output.max, 50);
        assert.strictEqual(result.output.count, 5);
    });

    test('handles single number', async () => {
        const reducer = new NumericAggregationReducer();
        const results = [createMapResult([42])];

        const result = await reducer.reduce(results, defaultContext);

        assert.strictEqual(result.output.sum, 42);
        assert.strictEqual(result.output.average, 42);
        assert.strictEqual(result.output.min, 42);
        assert.strictEqual(result.output.max, 42);
    });

    test('returns zeros for empty input', async () => {
        const reducer = new NumericAggregationReducer();
        const result = await reducer.reduce([], defaultContext);

        assert.strictEqual(result.output.sum, 0);
        assert.strictEqual(result.output.average, 0);
        assert.strictEqual(result.output.count, 0);
    });

    test('handles negative numbers', async () => {
        const reducer = new NumericAggregationReducer();
        const results = [createMapResult([-10, 0, 10])];

        const result = await reducer.reduce(results, defaultContext);

        assert.strictEqual(result.output.sum, 0);
        assert.strictEqual(result.output.min, -10);
        assert.strictEqual(result.output.max, 10);
    });
});
