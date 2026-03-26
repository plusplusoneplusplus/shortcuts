/**
 * Map-Reduce Executor
 *
 * Orchestrates map-reduce jobs: split → parallel map → reduce.
 * Delegates concurrency, timeout, retry, progress, and process tracking
 * to focused collaborators from `runtime/` and local helper modules.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { ConcurrencyLimiter, CancellationError } from '../runtime/concurrency-limiter';
import { withTimeoutDoubling } from '../runtime/timeout';
import { withRetry, isRetryExhaustedError } from '../runtime/retry';
import { ProgressReporter } from './progress-reporter';
import { ProcessTrackerAdapter } from './process-tracker-adapter';
import {
    DEFAULT_MAP_REDUCE_OPTIONS,
    ExecutionStats,
    ExecutorOptions,
    MapContext,
    MapReduceJob,
    MapReduceOptions,
    MapReduceResult,
    MapResult,
    ReduceContext,
    WorkItem,
} from './types';

function generateExecutionId(): string {
    return `mr-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * MapReduceExecutor
 *
 * Executes map-reduce jobs with configurable concurrency, timeout (with
 * automatic doubling on first timeout), retry, progress reporting, and
 * optional AI process tracker integration.
 */
export class MapReduceExecutor {
    private limiter: ConcurrencyLimiter;
    private options: ExecutorOptions;
    private progress: ProgressReporter;
    private tracker: ProcessTrackerAdapter;

    constructor(options: ExecutorOptions) {
        this.options = { ...DEFAULT_MAP_REDUCE_OPTIONS, ...options };
        this.limiter = new ConcurrencyLimiter(this.options.maxConcurrency);
        this.progress = new ProgressReporter(this.options.onProgress);
        this.tracker = new ProcessTrackerAdapter(this.options.processTracker);
    }

    /**
     * Execute a map-reduce job
     */
    async execute<TInput, TWorkItemData, TMapOutput, TReduceOutput>(
        job: MapReduceJob<TInput, TWorkItemData, TMapOutput, TReduceOutput>,
        input: TInput
    ): Promise<MapReduceResult<TMapOutput, TReduceOutput>> {
        const executionId = generateExecutionId();
        const startTime = Date.now();
        const options: MapReduceOptions = { ...this.options, ...job.options };

        this.progress.report({
            phase: 'splitting', totalItems: 0, completedItems: 0,
            failedItems: 0, percentage: 0, message: 'Splitting input into work items...'
        });

        // 1. Split Phase
        let workItems: WorkItem<TWorkItemData>[];
        try {
            workItems = job.splitter.split(input);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return this.createFailedResult(startTime, `Split phase failed: ${errorMsg}`);
        }

        if (workItems.length === 0) {
            return this.createEmptyResult(startTime);
        }

        const groupId = workItems.length > 1
            ? this.tracker.registerGroup(options.jobName || job.name)
            : undefined;

        this.progress.report({
            phase: 'mapping', totalItems: workItems.length, completedItems: 0,
            failedItems: 0, percentage: 0,
            message: `Processing ${workItems.length} items (max ${options.maxConcurrency} concurrent)...`
        });

        // 2. Map Phase
        const mapStartTime = Date.now();
        let mapResults: MapResult<TMapOutput>[];
        try {
            mapResults = await this.executeMapPhase(job, workItems, executionId, options, groupId);
        } catch (error) {
            if (error instanceof CancellationError) {
                return this.createCancelledResult(startTime, Date.now() - mapStartTime, workItems.length, options.maxConcurrency);
            }
            throw error;
        }
        const mapPhaseTimeMs = Date.now() - mapStartTime;

        const successfulMaps = mapResults.filter(r => r.success).length;
        const failedMaps = mapResults.filter(r => !r.success).length;

        this.progress.report({
            phase: 'reducing', totalItems: workItems.length, completedItems: successfulMaps,
            failedItems: failedMaps, percentage: 90, message: 'Aggregating results...'
        });

        // 3. Reduce Phase
        const reduceStartTime = Date.now();
        const reduceContext: ReduceContext = {
            executionId, mapPhaseTimeMs, successfulMaps, failedMaps,
            processTracker: this.options.processTracker, parentGroupId: groupId
        };

        let reduceResult;
        try {
            reduceResult = await job.reducer.reduce(mapResults, reduceContext);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return {
                success: false, mapResults, totalTimeMs: Date.now() - startTime,
                executionStats: {
                    totalItems: workItems.length, successfulMaps, failedMaps,
                    mapPhaseTimeMs, reducePhaseTimeMs: Date.now() - reduceStartTime,
                    maxConcurrency: options.maxConcurrency
                },
                error: `Reduce phase failed: ${errorMsg}`
            };
        }

        const reducePhaseTimeMs = Date.now() - reduceStartTime;
        const totalTimeMs = Date.now() - startTime;

        const executionStats: ExecutionStats = {
            totalItems: workItems.length, successfulMaps, failedMaps,
            mapPhaseTimeMs, reducePhaseTimeMs, maxConcurrency: options.maxConcurrency
        };

        this.tracker.completeGroup(groupId,
            `Completed: ${successfulMaps}/${workItems.length} items processed`, executionStats);

        this.progress.report({
            phase: 'complete', totalItems: workItems.length, completedItems: successfulMaps,
            failedItems: failedMaps, percentage: 100,
            message: `Complete: ${successfulMaps} succeeded, ${failedMaps} failed`
        });

        const overallSuccess = failedMaps === 0;
        const result: MapReduceResult<TMapOutput, TReduceOutput> = {
            success: overallSuccess, output: reduceResult.output, mapResults,
            reduceStats: reduceResult.stats, totalTimeMs, executionStats
        };

        if (!overallSuccess) {
            result.error = this.buildErrorSummary(mapResults);
        }

        return result;
    }

    // -- Map Phase -------------------------------------------------------

    private async executeMapPhase<TWorkItemData, TMapOutput>(
        job: MapReduceJob<unknown, TWorkItemData, TMapOutput, unknown>,
        workItems: WorkItem<TWorkItemData>[],
        executionId: string,
        options: MapReduceOptions,
        parentGroupId?: string
    ): Promise<MapResult<TMapOutput>[]> {
        let completedCount = 0;
        let failedCount = 0;
        let cancelled = false;

        const tasks = workItems.map((item, index) => {
            return () => {
                if (cancelled || this.options.isCancelled?.()) {
                    cancelled = true;
                    return Promise.resolve<MapResult<TMapOutput>>({
                        workItemId: item.id, success: false,
                        error: 'Operation cancelled', executionTimeMs: 0
                    });
                }

                return this.executeMapItem(
                    job, item,
                    { executionId, totalItems: workItems.length, itemIndex: index, parentGroupId, isCancelled: this.options.isCancelled },
                    options
                ).then(result => {
                    if (result.success) { completedCount++; } else { failedCount++; }

                    this.progress.report({
                        phase: 'mapping', totalItems: workItems.length,
                        completedItems: completedCount, failedItems: failedCount,
                        percentage: Math.round(((completedCount + failedCount) / workItems.length) * 85),
                        message: `Processed ${completedCount + failedCount}/${workItems.length} items...`
                    });

                    if (this.options.onItemComplete) {
                        try { this.options.onItemComplete(item, result); } catch { /* ignore */ }
                    }

                    return result;
                });
            };
        });

        try {
            return await this.limiter.all(tasks, this.options.isCancelled);
        } catch (error) {
            if (error instanceof CancellationError) { throw error; }
            throw error;
        }
    }

    // -- Single Map Item -------------------------------------------------

    private async executeMapItem<TWorkItemData, TMapOutput>(
        job: MapReduceJob<unknown, TWorkItemData, TMapOutput, unknown>,
        item: WorkItem<TWorkItemData>,
        context: MapContext,
        options: MapReduceOptions
    ): Promise<MapResult<TMapOutput>> {
        const startTime = Date.now();
        const maxAttempts = options.retryOnFailure ? (options.retryAttempts || 1) + 1 : 1;
        const baseTimeoutMs = options.timeoutMs || DEFAULT_MAP_REDUCE_OPTIONS.timeoutMs;

        const processId = this.tracker.registerProcess(
            `Processing item ${context.itemIndex + 1}/${context.totalItems}`,
            context.parentGroupId
        );

        try {
            const output = await withRetry(
                () => withTimeoutDoubling(
                    () => job.mapper.map(item, context),
                    { timeoutMs: baseTimeoutMs }
                ),
                { attempts: maxAttempts, delayMs: 1000, backoff: 'linear' }
            );

            const executionTimeMs = Date.now() - startTime;
            this.tracker.completeProcess(processId, output);
            return { workItemId: item.id, success: true, output, executionTimeMs, processId };
        } catch (error) {
            const executionTimeMs = Date.now() - startTime;
            // Unwrap RetryExhaustedError to surface the original error message
            const sourceError = isRetryExhaustedError(error) && error.cause instanceof Error
                ? error.cause : error;
            const errorMsg = sourceError instanceof Error ? sourceError.message : String(sourceError);

            this.tracker.failProcess(processId, errorMsg);
            return { workItemId: item.id, success: false, error: errorMsg, executionTimeMs, processId };
        }
    }

    // -- Result Helpers --------------------------------------------------

    private buildErrorSummary<TMapOutput>(mapResults: MapResult<TMapOutput>[]): string {
        const failedResults = mapResults.filter(r => !r.success);
        if (failedResults.length === 1) {
            return `1 item failed: ${failedResults[0].error || 'Unknown error'}`;
        }
        const uniqueErrors = [...new Set(failedResults.map(r => r.error || 'Unknown error'))];
        if (uniqueErrors.length === 1) {
            return `${failedResults.length} items failed: ${uniqueErrors[0]}`;
        }
        return `${failedResults.length} items failed with ${uniqueErrors.length} different errors`;
    }

    private createFailedResult<TMapOutput, TReduceOutput>(
        startTime: number, error: string
    ): MapReduceResult<TMapOutput, TReduceOutput> {
        return {
            success: false, mapResults: [], totalTimeMs: Date.now() - startTime,
            executionStats: {
                totalItems: 0, successfulMaps: 0, failedMaps: 0,
                mapPhaseTimeMs: 0, reducePhaseTimeMs: 0, maxConcurrency: this.options.maxConcurrency
            },
            error
        };
    }

    private createEmptyResult<TMapOutput, TReduceOutput>(
        startTime: number
    ): MapReduceResult<TMapOutput, TReduceOutput> {
        return {
            success: true, output: undefined, mapResults: [],
            reduceStats: {
                inputCount: 0, outputCount: 0, mergedCount: 0, reduceTimeMs: 0, usedAIReduce: false
            },
            totalTimeMs: Date.now() - startTime,
            executionStats: {
                totalItems: 0, successfulMaps: 0, failedMaps: 0,
                mapPhaseTimeMs: 0, reducePhaseTimeMs: 0, maxConcurrency: this.options.maxConcurrency
            }
        };
    }

    private createCancelledResult<TMapOutput, TReduceOutput>(
        startTime: number, mapPhaseTimeMs: number, totalItems: number, maxConcurrency: number
    ): MapReduceResult<TMapOutput, TReduceOutput> {
        return {
            success: false, mapResults: [], totalTimeMs: Date.now() - startTime,
            executionStats: {
                totalItems, successfulMaps: 0, failedMaps: 0,
                mapPhaseTimeMs, reducePhaseTimeMs: 0, maxConcurrency
            },
            error: 'Operation cancelled'
        };
    }
}

/**
 * Create a new MapReduceExecutor with the given options
 */
export function createExecutor(options: ExecutorOptions): MapReduceExecutor {
    return new MapReduceExecutor(options);
}
