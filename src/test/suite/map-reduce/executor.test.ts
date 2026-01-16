/**
 * Tests for MapReduceExecutor
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
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
} from '../../../shortcuts/map-reduce';
import { BaseReducer } from '../../../shortcuts/map-reduce/reducers';

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

suite('MapReduceExecutor', () => {
    const createTestJob = (
        mapper?: TestMapper
    ): MapReduceJob<TestInput, TestWorkItemData, TestMapOutput, TestReduceOutput> => ({
        id: 'test-job',
        name: 'Test Job',
        splitter: new TestSplitter(),
        mapper: mapper || new TestMapper(),
        reducer: new TestReducer()
    });

    test('executes simple job successfully', async () => {
        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 5,
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: false
        });

        const job = createTestJob();
        const result = await executor.execute(job, { items: [1, 2, 3] });

        assert.strictEqual(result.success, true);
        assert.deepStrictEqual(result.output?.results.sort(), [2, 4, 6]);
        assert.strictEqual(result.output?.sum, 12);
        assert.strictEqual(result.executionStats.totalItems, 3);
        assert.strictEqual(result.executionStats.successfulMaps, 3);
        assert.strictEqual(result.executionStats.failedMaps, 0);
    });

    test('handles empty input', async () => {
        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 5,
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: false
        });

        const job = createTestJob();
        const result = await executor.execute(job, { items: [] });

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.executionStats.totalItems, 0);
    });

    test('handles map failures', async () => {
        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 5,
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: false
        });

        const job = createTestJob(new TestMapper(0, 2)); // Fail on value 2
        const result = await executor.execute(job, { items: [1, 2, 3] });

        assert.strictEqual(result.success, false);
        assert.strictEqual(result.executionStats.successfulMaps, 2);
        assert.strictEqual(result.executionStats.failedMaps, 1);
        // Should still have results from successful maps
        assert.deepStrictEqual(result.output?.results.sort(), [2, 6]);
    });

    test('respects maxConcurrency', async () => {
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

        assert.ok(maxConcurrent <= 2, `Max concurrent was ${maxConcurrent}, expected <= 2`);
    });

    test('reports progress', async () => {
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
        assert.ok(progressUpdates.some(p => p.phase === 'splitting'));
        assert.ok(progressUpdates.some(p => p.phase === 'mapping'));
        assert.ok(progressUpdates.some(p => p.phase === 'reducing'));
        assert.ok(progressUpdates.some(p => p.phase === 'complete'));

        const completeProgress = progressUpdates.find(p => p.phase === 'complete');
        assert.strictEqual(completeProgress?.percentage, 100);
    });

    test('handles job-specific options', async () => {
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
        assert.strictEqual(actualConcurrency, 2);
    });

    test('records execution statistics', async () => {
        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 5,
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: false
        });

        const job = createTestJob(new TestMapper(5)); // 5ms delay
        const result = await executor.execute(job, { items: [1, 2, 3] });

        assert.ok(result.totalTimeMs > 0);
        assert.ok(result.executionStats.mapPhaseTimeMs > 0);
        assert.ok(result.executionStats.reducePhaseTimeMs >= 0);
        assert.strictEqual(result.executionStats.maxConcurrency, 5);
    });

    test('handles timeout on map operations', async () => {
        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 5,
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: false,
            timeoutMs: 10 // Very short timeout
        });

        const slowMapper: Mapper<TestWorkItemData, TestMapOutput> = {
            async map(item, context) {
                await new Promise(resolve => setTimeout(resolve, 100)); // Longer than timeout
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

        assert.strictEqual(result.success, false);
        assert.strictEqual(result.executionStats.failedMaps, 1);
        assert.ok(result.mapResults[0].error?.includes('timed out'));
    });

    test('retries failed operations when configured', async () => {
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

        assert.strictEqual(result.success, true);
        assert.strictEqual(attempts, 2); // First attempt + 1 retry
    });

    test('reduces stats correctly', async () => {
        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 5,
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: false
        });

        const job = createTestJob();
        const result = await executor.execute(job, { items: [1, 2, 3, 4, 5] });

        assert.ok(result.reduceStats);
        assert.strictEqual(result.reduceStats.inputCount, 5);
        assert.strictEqual(result.reduceStats.usedAIReduce, false);
    });
});

suite('createExecutor factory', () => {
    test('creates executor with default options', () => {
        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 5,
            reduceMode: 'deterministic',
            showProgress: false,
            retryOnFailure: false
        });

        assert.ok(executor instanceof MapReduceExecutor);
    });

    test('creates executor with custom options', () => {
        const executor = createExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 10,
            reduceMode: 'ai',
            showProgress: true,
            retryOnFailure: true,
            retryAttempts: 3,
            timeoutMs: 60000
        });

        assert.ok(executor instanceof MapReduceExecutor);
    });
});

suite('MapReduceExecutor Cancellation', () => {
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

    test('cancellation stops further map operations', async () => {
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
        assert.strictEqual(result.success, false);
        assert.ok(result.error?.includes('cancelled'), `Expected error to contain 'cancelled', got: ${result.error}`);
        // Items 1 and 2 should have been processed
        assert.ok(executedItems.includes(1), 'Item 1 should have been processed');
        assert.ok(executedItems.includes(2), 'Item 2 should have been processed');
        // Items 3, 4, 5 should not have been processed
        assert.ok(!executedItems.includes(3), 'Item 3 should not have been processed');
        assert.ok(!executedItems.includes(4), 'Item 4 should not have been processed');
        assert.ok(!executedItems.includes(5), 'Item 5 should not have been processed');
    });

    test('cancellation with higher concurrency stops pending tasks', async () => {
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
        assert.strictEqual(result.success, false);
        assert.ok(result.error?.includes('cancelled'), `Expected error to contain 'cancelled', got: ${result.error}`);
        
        // Items 1 and 2 start immediately (concurrency 2)
        assert.ok(executedItems.includes(1), 'Item 1 should have started');
        assert.ok(executedItems.includes(2), 'Item 2 should have started');
        
        // Not all items should have been processed
        assert.ok(executedItems.length < 10, `Expected fewer than 10 items to be processed, got ${executedItems.length}`);
    });

    test('immediate cancellation prevents any processing', async () => {
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
        assert.strictEqual(result.success, false);
        assert.ok(result.error?.includes('cancelled'), `Expected error to contain 'cancelled', got: ${result.error}`);
        // No items should have been processed
        assert.strictEqual(executedItems.length, 0, 'No items should have been processed');
    });

    test('cancellation passes isCancelled to map context', async () => {
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

        assert.ok(contextHasIsCancelled, 'Context should have isCancelled function');
    });
});
