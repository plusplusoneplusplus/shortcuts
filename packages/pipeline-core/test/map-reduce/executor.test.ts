/**
 * Tests for MapReduceExecutor
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect } from 'vitest';
import {
    MapReduceExecutor,
    createExecutor,
    MapReduceJob,
    Splitter,
    Mapper,
    WorkItem,
    MapContext,
    MapResult,
    ReduceContext,
    ReduceResult,
    AIInvoker,
    JobProgress
} from '../../src/map-reduce';
import { BaseReducer } from '../../src/map-reduce/reducers';

// Test types
interface TestInput {
    items: number[];
}

interface TestWorkItemData {
    value: number;
}

interface TestMapOutput {
    doubled: number;
}

interface TestReduceOutput {
    results: number[];
    sum: number;
}

// Test implementations
class TestSplitter implements Splitter<TestInput, TestWorkItemData> {
    split(input: TestInput): WorkItem<TestWorkItemData>[] {
        return input.items.map((value, index) => ({
            id: `item-${index}`,
            data: { value }
        }));
    }
}

class TestMapper implements Mapper<TestWorkItemData, TestMapOutput> {
    constructor(
        private delay: number = 0,
        private failOn?: number
    ) {}

    async map(item: WorkItem<TestWorkItemData>, context: MapContext): Promise<TestMapOutput> {
        if (this.delay > 0) {
            await new Promise(resolve => setTimeout(resolve, this.delay));
        }

        if (this.failOn !== undefined && item.data.value === this.failOn) {
            throw new Error(`Failed on value ${this.failOn}`);
        }

        return { doubled: item.data.value * 2 };
    }
}

class TestReducer extends BaseReducer<TestMapOutput, TestReduceOutput> {
    async reduce(
        results: MapResult<TestMapOutput>[],
        context: ReduceContext
    ): Promise<ReduceResult<TestReduceOutput>> {
        const startTime = Date.now();
        const outputs = this.extractSuccessfulOutputs(results);
        const doubled = outputs.map(o => o.doubled);
        const sum = doubled.reduce((a, b) => a + b, 0);

        return {
            output: { results: doubled, sum },
            stats: this.createStats(outputs.length, 1, Date.now() - startTime, false)
        };
    }
}

// Mock AI invoker
const mockAIInvoker: AIInvoker = async (prompt, options) => ({
    success: true,
    response: 'Mock response'
});

describe('MapReduceExecutor', () => {
    const createTestJob = (
        mapper?: TestMapper
    ): MapReduceJob<TestInput, TestWorkItemData, TestMapOutput, TestReduceOutput> => ({
        id: 'test-job',
        name: 'Test Job',
        splitter: new TestSplitter(),
        mapper: mapper || new TestMapper(),
        reducer: new TestReducer()
    });

    it('executes simple job successfully', async () => {
        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 5,
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: false
        });

        const job = createTestJob();
        const result = await executor.execute(job, { items: [1, 2, 3] });

        expect(result.success).toBe(true);
        expect(result.output?.results.sort()).toEqual([2, 4, 6]);
        expect(result.output?.sum).toBe(12);
        expect(result.executionStats.totalItems).toBe(3);
        expect(result.executionStats.successfulMaps).toBe(3);
        expect(result.executionStats.failedMaps).toBe(0);
    });

    it('handles empty input', async () => {
        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 5,
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: false
        });

        const job = createTestJob();
        const result = await executor.execute(job, { items: [] });

        expect(result.success).toBe(true);
        expect(result.executionStats.totalItems).toBe(0);
    });

    it('handles map failures', async () => {
        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 5,
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: false
        });

        const job = createTestJob(new TestMapper(0, 2)); // Fail on value 2
        const result = await executor.execute(job, { items: [1, 2, 3] });

        expect(result.success).toBe(false);
        expect(result.executionStats.successfulMaps).toBe(2);
        expect(result.executionStats.failedMaps).toBe(1);
        // Should still have results from successful maps
        expect(result.output?.results.sort()).toEqual([2, 6]);
    });

    it('respects maxConcurrency', async () => {
        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 2,
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: false
        });

        let maxConcurrent = 0;
        let currentConcurrent = 0;

        const trackingMapper: Mapper<TestWorkItemData, TestMapOutput> = {
            async map(item, context) {
                currentConcurrent++;
                maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
                await new Promise(resolve => setTimeout(resolve, 10));
                currentConcurrent--;
                return { doubled: item.data.value * 2 };
            }
        };

        const job: MapReduceJob<TestInput, TestWorkItemData, TestMapOutput, TestReduceOutput> = {
            id: 'tracking-job',
            name: 'Tracking Job',
            splitter: new TestSplitter(),
            mapper: trackingMapper,
            reducer: new TestReducer()
        };

        await executor.execute(job, { items: [1, 2, 3, 4, 5] });

        expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it('reports progress', async () => {
        const progressUpdates: JobProgress[] = [];

        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 5,
            reduceMode: 'deterministic',
            showProgress: true,
            retryOnFailure: false,
            onProgress: (progress) => progressUpdates.push({ ...progress })
        });

        const job = createTestJob();
        await executor.execute(job, { items: [1, 2, 3] });

        // Should have progress updates for splitting, mapping, reducing, complete
        expect(progressUpdates.some(p => p.phase === 'splitting')).toBe(true);
        expect(progressUpdates.some(p => p.phase === 'mapping')).toBe(true);
        expect(progressUpdates.some(p => p.phase === 'reducing')).toBe(true);
        expect(progressUpdates.some(p => p.phase === 'complete')).toBe(true);

        const completeProgress = progressUpdates.find(p => p.phase === 'complete');
        expect(completeProgress?.percentage).toBe(100);
    });

    it('handles job-specific options', async () => {
        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 10, // Default
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: false
        });

        let actualConcurrency = 10;

        const trackingMapper: Mapper<TestWorkItemData, TestMapOutput> = {
            async map(item, context) {
                actualConcurrency = context.totalItems; // Just verify context
                return { doubled: item.data.value * 2 };
            }
        };

        const job: MapReduceJob<TestInput, TestWorkItemData, TestMapOutput, TestReduceOutput> = {
            id: 'options-job',
            name: 'Options Job',
            splitter: new TestSplitter(),
            mapper: trackingMapper,
            reducer: new TestReducer(),
            options: {
                maxConcurrency: 3 // Override
            }
        };

        await executor.execute(job, { items: [1, 2] });

        // Context should have correct total items
        expect(actualConcurrency).toBe(2);
    });

    it('records execution statistics', async () => {
        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 5,
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: false
        });

        const job = createTestJob(new TestMapper(5)); // 5ms delay
        const result = await executor.execute(job, { items: [1, 2, 3] });

        expect(result.totalTimeMs).toBeGreaterThan(0);
        expect(result.executionStats.mapPhaseTimeMs).toBeGreaterThan(0);
        expect(result.executionStats.reducePhaseTimeMs).toBeGreaterThanOrEqual(0);
        expect(result.executionStats.maxConcurrency).toBe(5);
    });

    it('handles timeout on map operations after timeout retry', async () => {
        // With timeout retry, we need the slow mapper to always exceed both timeouts
        // First timeout: 50ms, retry timeout: 100ms (doubled)
        // So the mapper needs to take longer than 100ms
        // Using larger values for more reliable timing on CI environments
        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 5,
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: false,
            timeoutMs: 50 // Short timeout but not too aggressive
        });

        const slowMapper: Mapper<TestWorkItemData, TestMapOutput> = {
            async map(item, context) {
                await new Promise(resolve => setTimeout(resolve, 500)); // Much longer than both timeouts (50ms + 100ms)
                return { doubled: item.data.value * 2 };
            }
        };

        const job: MapReduceJob<TestInput, TestWorkItemData, TestMapOutput, TestReduceOutput> = {
            id: 'timeout-job',
            name: 'Timeout Job',
            splitter: new TestSplitter(),
            mapper: slowMapper,
            reducer: new TestReducer()
        };

        const result = await executor.execute(job, { items: [1] });

        expect(result.success).toBe(false);
        expect(result.executionStats.failedMaps).toBe(1);
        expect(result.mapResults[0].error).toMatch(/timed out/);
    });

    it('retries timeout with doubled timeout value', async () => {
        let attemptCount = 0;

        // Mapper that takes 75ms - will timeout on 50ms but succeed on 100ms (doubled)
        // Using larger values for reliable timing on CI environments
        const slowThenFastMapper: Mapper<TestWorkItemData, TestMapOutput> = {
            async map(item, context) {
                attemptCount++;
                await new Promise(resolve => setTimeout(resolve, 75));
                return { doubled: item.data.value * 2 };
            }
        };

        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 5,
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: false,
            timeoutMs: 50 // First timeout at 50ms, retry at 100ms
        });

        const job: MapReduceJob<TestInput, TestWorkItemData, TestMapOutput, TestReduceOutput> = {
            id: 'timeout-retry-job',
            name: 'Timeout Retry Job',
            splitter: new TestSplitter(),
            mapper: slowThenFastMapper,
            reducer: new TestReducer()
        };

        const result = await executor.execute(job, { items: [1] });

        // Should succeed on the second attempt (with doubled timeout)
        expect(result.success).toBe(true);
        expect(attemptCount).toBe(2); // Should have attempted twice (initial + timeout retry)
        // The reduce output should have the results array with value 2 (1 * 2)
        expect(result.output?.results).toEqual([2]);
    });

    it('timeout retry only happens once', async () => {
        let attemptCount = 0;

        // Mapper that always takes too long - will fail even with doubled timeout
        // Using larger values for reliable timing on CI environments
        const alwaysSlowMapper: Mapper<TestWorkItemData, TestMapOutput> = {
            async map(item, context) {
                attemptCount++;
                await new Promise(resolve => setTimeout(resolve, 500)); // Always too slow (500ms > 50ms + 100ms)
                return { doubled: item.data.value * 2 };
            }
        };

        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 5,
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: false,
            timeoutMs: 50 // First timeout at 50ms, retry at 100ms - both will fail
        });

        const job: MapReduceJob<TestInput, TestWorkItemData, TestMapOutput, TestReduceOutput> = {
            id: 'single-timeout-retry-job',
            name: 'Single Timeout Retry Job',
            splitter: new TestSplitter(),
            mapper: alwaysSlowMapper,
            reducer: new TestReducer()
        };

        const result = await executor.execute(job, { items: [1] });

        // Should fail after exactly 2 attempts (initial + one timeout retry)
        expect(result.success).toBe(false);
        expect(attemptCount).toBe(2); // Should have attempted exactly twice
        expect(result.mapResults[0].error).toMatch(/timed out/);
    });

    it('non-timeout errors are not retried by timeout retry logic', async () => {
        let attemptCount = 0;

        // Mapper that throws a non-timeout error
        const errorMapper: Mapper<TestWorkItemData, TestMapOutput> = {
            async map(item, context) {
                attemptCount++;
                throw new Error('Some other error');
            }
        };

        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 5,
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: false,
            timeoutMs: 1000
        });

        const job: MapReduceJob<TestInput, TestWorkItemData, TestMapOutput, TestReduceOutput> = {
            id: 'non-timeout-error-job',
            name: 'Non-Timeout Error Job',
            splitter: new TestSplitter(),
            mapper: errorMapper,
            reducer: new TestReducer()
        };

        const result = await executor.execute(job, { items: [1] });

        // Should fail after just 1 attempt (no timeout retry for non-timeout errors)
        expect(result.success).toBe(false);
        expect(attemptCount).toBe(1); // Should have attempted only once
        expect(result.mapResults[0].error).toMatch(/Some other error/);
    });

    it('retries failed operations when configured', async () => {
        let attempts = 0;

        const retryMapper: Mapper<TestWorkItemData, TestMapOutput> = {
            async map(item, context) {
                attempts++;
                if (attempts < 2) {
                    throw new Error('Transient failure');
                }
                return { doubled: item.data.value * 2 };
            }
        };

        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 5,
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: true,
            retryAttempts: 2
        });

        const job: MapReduceJob<TestInput, TestWorkItemData, TestMapOutput, TestReduceOutput> = {
            id: 'retry-job',
            name: 'Retry Job',
            splitter: new TestSplitter(),
            mapper: retryMapper,
            reducer: new TestReducer()
        };

        const result = await executor.execute(job, { items: [1] });

        expect(result.success).toBe(true);
        expect(attempts).toBe(2); // First attempt + 1 retry
    });

    it('reduces stats correctly', async () => {
        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 5,
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: false
        });

        const job = createTestJob();
        const result = await executor.execute(job, { items: [1, 2, 3, 4, 5] });

        expect(result.reduceStats).toBeTruthy();
        expect(result.reduceStats?.inputCount).toBe(5);
        expect(result.reduceStats?.usedAIReduce).toBe(false);
    });
});

describe('createExecutor factory', () => {
    it('creates executor with default options', () => {
        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 5,
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: false
        });

        expect(executor).toBeInstanceOf(MapReduceExecutor);
    });

    it('creates executor with custom options', () => {
        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 10,
            reduceMode: 'ai',
            showProgress: true,
            retryOnFailure: true,
            retryAttempts: 3,
            timeoutMs: 60000
        });

        expect(executor).toBeInstanceOf(MapReduceExecutor);
    });
});

describe('MapReduceExecutor Cancellation', () => {
    // Helper to create a test job with configurable mapper
    const createCancellationTestJob = (
        mapper: Mapper<TestWorkItemData, TestMapOutput>
    ): MapReduceJob<TestInput, TestWorkItemData, TestMapOutput, TestReduceOutput> => ({
        id: 'cancellation-test-job',
        name: 'Cancellation Test Job',
        splitter: new TestSplitter(),
        mapper,
        reducer: new TestReducer()
    });

    it('cancellation stops further map operations', async () => {
        let cancelled = false;
        const executedItems: number[] = [];

        const trackingMapper: Mapper<TestWorkItemData, TestMapOutput> = {
            async map(item, context) {
                executedItems.push(item.data.value);
                await new Promise(resolve => setTimeout(resolve, 20));
                if (item.data.value === 2) {
                    cancelled = true; // Cancel after processing item 2
                }
                return { doubled: item.data.value * 2 };
            }
        };

        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 1, // Sequential execution to make test deterministic
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: false,
            isCancelled: () => cancelled
        });

        const job = createCancellationTestJob(trackingMapper);
        const result = await executor.execute(job, { items: [1, 2, 3, 4, 5] });

        // Should have processed items 1 and 2, then cancelled
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/cancelled/);
        // Items 1 and 2 should have been processed
        expect(executedItems).toContain(1);
        expect(executedItems).toContain(2);
        // Items 3, 4, 5 should not have been processed
        expect(executedItems).not.toContain(3);
        expect(executedItems).not.toContain(4);
        expect(executedItems).not.toContain(5);
    });

    it('cancellation with higher concurrency stops pending tasks', async () => {
        let cancelled = false;
        const executedItems: number[] = [];

        const trackingMapper: Mapper<TestWorkItemData, TestMapOutput> = {
            async map(item, context) {
                executedItems.push(item.data.value);
                await new Promise(resolve => setTimeout(resolve, item.data.value === 1 ? 50 : 10));
                if (item.data.value === 2) {
                    cancelled = true; // Cancel after item 2 completes
                }
                return { doubled: item.data.value * 2 };
            }
        };

        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 2, // Two concurrent tasks
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: false,
            isCancelled: () => cancelled
        });

        const job = createCancellationTestJob(trackingMapper);
        const result = await executor.execute(job, { items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });

        // Should be cancelled
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/cancelled/);
        
        // Items 1 and 2 start immediately (concurrency 2)
        expect(executedItems).toContain(1);
        expect(executedItems).toContain(2);
        
        // Not all items should have been processed
        expect(executedItems.length).toBeLessThan(10);
    });

    it('immediate cancellation prevents any processing', async () => {
        const executedItems: number[] = [];

        const trackingMapper: Mapper<TestWorkItemData, TestMapOutput> = {
            async map(item, context) {
                executedItems.push(item.data.value);
                return { doubled: item.data.value * 2 };
            }
        };

        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 5,
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: false,
            isCancelled: () => true // Always cancelled
        });

        const job = createCancellationTestJob(trackingMapper);
        const result = await executor.execute(job, { items: [1, 2, 3] });

        // Should be cancelled immediately
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/cancelled/);
        // No items should have been processed
        expect(executedItems.length).toBe(0);
    });

    it('cancellation passes isCancelled to map context', async () => {
        let contextHasIsCancelled = false;

        const checkingMapper: Mapper<TestWorkItemData, TestMapOutput> = {
            async map(item, context) {
                contextHasIsCancelled = typeof context.isCancelled === 'function';
                return { doubled: item.data.value * 2 };
            }
        };

        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 5,
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: false,
            isCancelled: () => false
        });

        const job = createCancellationTestJob(checkingMapper);
        await executor.execute(job, { items: [1] });

        expect(contextHasIsCancelled).toBe(true);
    });
});
