import { describe, it, expect, vi } from 'vitest';
import { MapReduceExecutor, createExecutor } from '../../src/map-reduce/executor';
import type {
    ExecutorOptions,
    MapReduceJob,
    WorkItem,
    MapContext,
    MapResult,
    ReduceContext,
    ReduceResult,
} from '../../src/map-reduce/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StringItem = string;
type StringWork = { value: string };

/** Minimal splitter: wraps each string in an array as a WorkItem */
function stringSplitter(strings: StringItem[]): { split: (input: StringItem[]) => WorkItem<StringWork>[] } {
    return {
        split: (input) =>
            input.map((s, i) => ({ id: `item-${i}`, data: { value: s } })),
    };
}

/** Minimal mapper: echoes value as output */
function identityMapper() {
    return {
        map: async (item: WorkItem<StringWork>, _ctx: MapContext): Promise<string> =>
            item.data.value,
    };
}

/** Reducer that joins all successful outputs */
function joinReducer(sep = ',') {
    return {
        reduce: async (
            results: MapResult<string>[],
            _ctx: ReduceContext,
        ): Promise<ReduceResult<string>> => {
            const values = results.filter(r => r.success).map(r => r.output as string);
            return {
                output: values.join(sep),
                stats: {
                    inputCount: results.length,
                    outputCount: 1,
                    mergedCount: results.length - 1,
                    reduceTimeMs: 0,
                    usedAIReduce: false,
                },
            };
        },
    };
}

function makeJob(opts?: {
    mapperFn?: (item: WorkItem<StringWork>, ctx: MapContext) => Promise<string>;
    reducerFn?: (results: MapResult<string>[], ctx: ReduceContext) => Promise<ReduceResult<string>>;
    jobOptions?: Partial<ExecutorOptions>;
}): MapReduceJob<StringItem[], StringWork, string, string> {
    return {
        id: 'test-job',
        name: 'Test Job',
        splitter: stringSplitter([]) as unknown as MapReduceJob<StringItem[], StringWork, string, string>['splitter'],
        mapper: opts?.mapperFn
            ? { map: opts.mapperFn }
            : identityMapper(),
        reducer: opts?.reducerFn
            ? { reduce: opts.reducerFn }
            : joinReducer(),
    };
}

const MOCK_AI_INVOKER = vi.fn().mockResolvedValue({ content: '' });

function makeExecutorOptions(overrides: Partial<ExecutorOptions> = {}): ExecutorOptions {
    return {
        aiInvoker: MOCK_AI_INVOKER,
        maxConcurrency: 5,
        reduceMode: 'deterministic',
        showProgress: false,
        retryOnFailure: false,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MapReduceExecutor — basic execution', () => {
    it('returns success=true for a trivial single-item input', async () => {
        const executor = createExecutor(makeExecutorOptions());
        const job: MapReduceJob<StringItem[], StringWork, string, string> = {
            id: 'j1',
            name: 'J1',
            splitter: stringSplitter(['hello']),
            mapper: identityMapper(),
            reducer: joinReducer(),
        };
        const result = await executor.execute(job, ['hello']);
        expect(result.success).toBe(true);
        expect(result.output).toBe('hello');
    });

    it('processes all items and passes them through the reducer', async () => {
        const executor = createExecutor(makeExecutorOptions({ maxConcurrency: 3 }));
        const job: MapReduceJob<StringItem[], StringWork, string, string> = {
            id: 'j2',
            name: 'J2',
            splitter: stringSplitter(['a', 'b', 'c']),
            mapper: identityMapper(),
            reducer: joinReducer(','),
        };
        const result = await executor.execute(job, ['a', 'b', 'c']);
        expect(result.success).toBe(true);
        expect(result.mapResults).toHaveLength(3);
        // Order may vary; check all values are present
        const outputParts = (result.output as string).split(',');
        expect(outputParts.sort()).toEqual(['a', 'b', 'c']);
    });

    it('returns success=true and empty result for an empty input', async () => {
        const executor = createExecutor(makeExecutorOptions());
        const job: MapReduceJob<StringItem[], StringWork, string, string> = {
            id: 'j-empty',
            name: 'Empty',
            splitter: { split: () => [] },
            mapper: identityMapper(),
            reducer: joinReducer(),
        };
        const result = await executor.execute(job, []);
        expect(result.success).toBe(true);
        expect(result.mapResults).toHaveLength(0);
    });

    it('calls onProgress callback during execution', async () => {
        const progressEvents: string[] = [];
        const executor = createExecutor(makeExecutorOptions({
            onProgress: (p) => progressEvents.push(p.phase),
        }));
        const job: MapReduceJob<StringItem[], StringWork, string, string> = {
            id: 'j-prog',
            name: 'Progress',
            splitter: stringSplitter(['x']),
            mapper: identityMapper(),
            reducer: joinReducer(),
        };
        await executor.execute(job, ['x']);
        expect(progressEvents).toContain('mapping');
        expect(progressEvents).toContain('complete');
    });
});

describe('MapReduceExecutor — concurrency', () => {
    it('respects maxConcurrency=1 and processes items serially', async () => {
        const order: number[] = [];
        const executor = createExecutor(makeExecutorOptions({ maxConcurrency: 1 }));
        const items = [0, 1, 2, 3, 4];
        const job: MapReduceJob<number[], { value: number }, number, number[]> = {
            id: 'j-serial',
            name: 'Serial',
            splitter: {
                split: (input: number[]) => input.map((n, i) => ({ id: `item-${i}`, data: { value: n } })),
            },
            mapper: {
                map: async (item) => {
                    order.push(item.data.value);
                    return item.data.value;
                },
            },
            reducer: {
                reduce: async (results) => ({
                    output: results.filter(r => r.success).map(r => r.output as number),
                    stats: { inputCount: results.length, outputCount: results.length, mergedCount: 0, reduceTimeMs: 0, usedAIReduce: false },
                }),
            },
        };
        const result = await executor.execute(job, items);
        expect(result.success).toBe(true);
        expect((result.output as number[]).sort()).toEqual([0, 1, 2, 3, 4]);
    });
});

describe('MapReduceExecutor — error handling', () => {
    it('marks a map result as failed when the mapper throws', async () => {
        const executor = createExecutor(makeExecutorOptions());
        const job: MapReduceJob<StringItem[], StringWork, string, string> = {
            id: 'j-fail',
            name: 'Fail',
            splitter: stringSplitter(['a', 'b', 'c']),
            mapper: {
                map: async (item) => {
                    if (item.data.value === 'b') throw new Error('b failed');
                    return item.data.value;
                },
            },
            reducer: joinReducer(),
        };
        const result = await executor.execute(job, ['a', 'b', 'c']);
        // Overall success false because one item failed
        expect(result.success).toBe(false);
        expect(result.executionStats.failedMaps).toBe(1);
        expect(result.executionStats.successfulMaps).toBe(2);
        const failedResult = result.mapResults.find(r => !r.success);
        expect(failedResult?.error).toContain('b failed');
    });

    it('returns failed result when splitter throws', async () => {
        const executor = createExecutor(makeExecutorOptions());
        const job: MapReduceJob<StringItem[], StringWork, string, string> = {
            id: 'j-split-fail',
            name: 'SplitFail',
            splitter: { split: () => { throw new Error('split error'); } },
            mapper: identityMapper(),
            reducer: joinReducer(),
        };
        const result = await executor.execute(job, []);
        expect(result.success).toBe(false);
        expect(result.error).toContain('split error');
    });

    it('returns partial results when reducer throws', async () => {
        const executor = createExecutor(makeExecutorOptions());
        const job: MapReduceJob<StringItem[], StringWork, string, string> = {
            id: 'j-reduce-fail',
            name: 'ReduceFail',
            splitter: stringSplitter(['x']),
            mapper: identityMapper(),
            reducer: { reduce: async () => { throw new Error('reduce error'); } },
        };
        const result = await executor.execute(job, ['x']);
        expect(result.success).toBe(false);
        expect(result.mapResults).toHaveLength(1);
        expect(result.error).toContain('reduce error');
    });
});

describe('MapReduceExecutor — cancellation', () => {
    it('stops processing when isCancelled returns true', async () => {
        let cancelled = false;
        const executor = createExecutor(makeExecutorOptions({
            maxConcurrency: 1,
            isCancelled: () => cancelled,
        }));

        const mapped: string[] = [];
        const job: MapReduceJob<StringItem[], StringWork, string, string> = {
            id: 'j-cancel',
            name: 'Cancel',
            splitter: stringSplitter(['a', 'b', 'c', 'd', 'e']),
            mapper: {
                map: async (item) => {
                    mapped.push(item.data.value);
                    if (item.data.value === 'b') {
                        cancelled = true;
                    }
                    return item.data.value;
                },
            },
            reducer: joinReducer(),
        };
        const result = await executor.execute(job, ['a', 'b', 'c', 'd', 'e']);
        // Not all items should be processed after cancellation
        expect(result.success).toBe(false);
    });
});

describe('MapReduceExecutor — retries', () => {
    it('retries failed mapper calls up to retryAttempts', async () => {
        let attempt = 0;
        const executor = createExecutor(makeExecutorOptions({
            retryOnFailure: true,
            retryAttempts: 2,
        }));
        const job: MapReduceJob<StringItem[], StringWork, string, string> = {
            id: 'j-retry',
            name: 'Retry',
            splitter: stringSplitter(['x']),
            mapper: {
                map: async (item) => {
                    attempt++;
                    if (attempt < 3) throw new Error('temporary error');
                    return item.data.value;
                },
            },
            reducer: joinReducer(),
        };
        const result = await executor.execute(job, ['x']);
        expect(result.success).toBe(true);
        expect(attempt).toBe(3);
    });
});

describe('MapReduceExecutor — onItemComplete callback', () => {
    it('calls onItemComplete after each item with its result', async () => {
        const completed: string[] = [];
        const executor = createExecutor(makeExecutorOptions({
            onItemComplete: (item, result) => {
                completed.push((item.data as StringWork).value + ':' + (result.success ? 'ok' : 'fail'));
            },
        }));
        const job: MapReduceJob<StringItem[], StringWork, string, string> = {
            id: 'j-cb',
            name: 'Callback',
            splitter: stringSplitter(['a', 'b']),
            mapper: identityMapper(),
            reducer: joinReducer(),
        };
        await executor.execute(job, ['a', 'b']);
        expect(completed.sort()).toEqual(['a:ok', 'b:ok']);
    });
});
