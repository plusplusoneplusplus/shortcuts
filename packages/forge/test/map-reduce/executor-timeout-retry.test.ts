/**
 * Regression tests for map-reduce executor timeout detection.
 *
 * The executor uses `isTimeoutError()` to detect timeout errors.
 * Previously it relied on string matching `error.message.includes('timed out after')`,
 * which was fragile and could break if the message changed.
 * These tests ensure `TimeoutError` instances trigger the retry path.
 */

import { describe, it, expect, vi } from 'vitest';
import { MapReduceExecutor } from '../../src/map-reduce/executor';
import { TimeoutError } from '../../src/runtime/timeout';
import type {
    ExecutorOptions,
    MapReduceJob,
    WorkItem,
    MapContext,
    MapResult,
    ReduceContext,
} from '../../src/map-reduce/types';

type Data = { v: string };

function makeSplitter() {
    return {
        split: (input: string[]) =>
            input.map((s, i) => ({ id: `item-${i}`, data: { v: s } })),
    };
}

function makeReducer() {
    return {
        reduce: async (results: MapResult<string>[], _ctx: ReduceContext) => {
            return results
                .filter(r => r.success)
                .map(r => r.output)
                .join(',');
        },
    };
}

describe('MapReduceExecutor - timeout retry', () => {
    it('retries once when mapper throws a TimeoutError', async () => {
        let callCount = 0;
        const mapper = {
            map: async (item: WorkItem<Data>, _ctx: MapContext): Promise<string> => {
                callCount++;
                if (callCount === 1) {
                    throw new TimeoutError('Operation timed out after 5000ms', { timeoutMs: 5000 });
                }
                return item.data.v;
            },
        };

        const job: MapReduceJob<string[], Data, string, string> = {
            splitter: makeSplitter(),
            mapper,
            reducer: makeReducer(),
        };

        const opts: ExecutorOptions = {
            aiInvoker: vi.fn(),
            maxConcurrency: 1,
            showProgress: false,
            retryOnFailure: false,
            timeoutMs: 30000,
        };

        const executor = new MapReduceExecutor(opts);
        const result = await executor.execute(job, ['hello']);

        expect(result.success).toBe(true);
        // First call throws TimeoutError → retry → second call succeeds
        expect(callCount).toBe(2);
    });

    it('does NOT retry when mapper throws a non-timeout error', async () => {
        let callCount = 0;
        const mapper = {
            map: async (_item: WorkItem<Data>, _ctx: MapContext): Promise<string> => {
                callCount++;
                throw new Error('some other error');
            },
        };

        const job: MapReduceJob<string[], Data, string, string> = {
            splitter: makeSplitter(),
            mapper,
            reducer: makeReducer(),
        };

        const opts: ExecutorOptions = {
            aiInvoker: vi.fn(),
            maxConcurrency: 1,
            showProgress: false,
            retryOnFailure: false,
            timeoutMs: 30000,
        };

        const executor = new MapReduceExecutor(opts);
        const result = await executor.execute(job, ['hello']);

        // Should NOT retry on non-timeout errors
        expect(callCount).toBe(1);
        expect(result.success).toBe(false);
    });
});
