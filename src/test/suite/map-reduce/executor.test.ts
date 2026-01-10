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
