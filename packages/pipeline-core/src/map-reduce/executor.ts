/**
 * Map-Reduce Executor
 *
 * Executes map-reduce jobs with configurable concurrency, progress tracking,
 * and optional process manager integration.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { ConcurrencyLimiter, CancellationError } from './concurrency-limiter';
import {
    DEFAULT_MAP_REDUCE_OPTIONS,
    ExecutionStats,
    ExecutorOptions,
    JobProgress,
    MapContext,
    MapReduceJob,
    MapReduceOptions,
    MapReduceResult,
    MapResult,
    ReduceContext,
    WorkItem,
    SessionMetadata
} from './types';

/**
 * Generates a unique execution ID
 */
function generateExecutionId(): string {
    return `mr-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * MapReduceExecutor
 *
 * Executes map-reduce jobs with:
 * - Configurable concurrency limiting
 * - Progress tracking and callbacks
 * - Optional AI process manager integration
 * - Retry support for failed operations
 * - Timeout handling
 */
export class MapReduceExecutor {
    private limiter: ConcurrencyLimiter;
    private options: ExecutorOptions;

    constructor(options: ExecutorOptions) {
        this.options = {
            ...DEFAULT_MAP_REDUCE_OPTIONS,
            ...options
        };
        this.limiter = new ConcurrencyLimiter(this.options.maxConcurrency);
    }

    /**
     * Execute a map-reduce job
     * @param job The job to execute
     * @param input The input to process
     * @returns Promise resolving to the job result
     */
    async execute<TInput, TWorkItemData, TMapOutput, TReduceOutput>(
        job: MapReduceJob<TInput, TWorkItemData, TMapOutput, TReduceOutput>,
        input: TInput
    ): Promise<MapReduceResult<TMapOutput, TReduceOutput>> {
        const executionId = generateExecutionId();
        const startTime = Date.now();

        // Merge job options with executor options
        const options: MapReduceOptions = {
            ...this.options,
            ...job.options
        };

        // Report initial progress
        this.reportProgress({
            phase: 'splitting',
            totalItems: 0,
            completedItems: 0,
            failedItems: 0,
            percentage: 0,
            message: 'Splitting input into work items...'
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

        // Register group process if tracker is available
        let groupId: string | undefined;
        if (this.options.processTracker && workItems.length > 1) {
            const description = options.jobName || job.name;
            groupId = this.options.processTracker.registerGroup(description);
        }

        // Report split complete
        this.reportProgress({
            phase: 'mapping',
            totalItems: workItems.length,
            completedItems: 0,
            failedItems: 0,
            percentage: 0,
            message: `Processing ${workItems.length} items (max ${options.maxConcurrency} concurrent)...`
        });

        // 2. Map Phase
        const mapStartTime = Date.now();
        let mapResults: MapResult<TMapOutput>[];
        try {
            mapResults = await this.executeMapPhase(
                job,
                workItems,
                executionId,
                options,
                groupId
            );
        } catch (error) {
            if (error instanceof CancellationError) {
                const mapPhaseTimeMs = Date.now() - mapStartTime;
                return this.createCancelledResult(startTime, mapPhaseTimeMs, workItems.length, options.maxConcurrency);
            }
            throw error;
        }
        const mapPhaseTimeMs = Date.now() - mapStartTime;

        // Calculate map statistics
        const successfulMaps = mapResults.filter(r => r.success).length;
        const failedMaps = mapResults.filter(r => !r.success).length;

        // Report map complete
        this.reportProgress({
            phase: 'reducing',
            totalItems: workItems.length,
            completedItems: successfulMaps,
            failedItems: failedMaps,
            percentage: 90,
            message: 'Aggregating results...'
        });

        // 3. Reduce Phase
        const reduceStartTime = Date.now();
        const reduceContext: ReduceContext = {
            executionId,
            mapPhaseTimeMs,
            successfulMaps,
            failedMaps,
            processTracker: this.options.processTracker,
            parentGroupId: groupId
        };

        let reduceResult;
        try {
            reduceResult = await job.reducer.reduce(mapResults, reduceContext);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const totalTimeMs = Date.now() - startTime;

            // Still return partial results from map phase
            return {
                success: false,
                mapResults,
                totalTimeMs,
                executionStats: {
                    totalItems: workItems.length,
                    successfulMaps,
                    failedMaps,
                    mapPhaseTimeMs,
                    reducePhaseTimeMs: Date.now() - reduceStartTime,
                    maxConcurrency: options.maxConcurrency
                },
                error: `Reduce phase failed: ${errorMsg}`
            };
        }

        const reducePhaseTimeMs = Date.now() - reduceStartTime;
        const totalTimeMs = Date.now() - startTime;

        // Build execution stats
        const executionStats: ExecutionStats = {
            totalItems: workItems.length,
            successfulMaps,
            failedMaps,
            mapPhaseTimeMs,
            reducePhaseTimeMs,
            maxConcurrency: options.maxConcurrency
        };

        // Complete group process if registered
        if (this.options.processTracker && groupId) {
            this.options.processTracker.completeGroup(
                groupId,
                `Completed: ${successfulMaps}/${workItems.length} items processed`,
                executionStats
            );
        }

        // Report complete
        this.reportProgress({
            phase: 'complete',
            totalItems: workItems.length,
            completedItems: successfulMaps,
            failedItems: failedMaps,
            percentage: 100,
            message: `Complete: ${successfulMaps} succeeded, ${failedMaps} failed`
        });

        // Build the result
        const overallSuccess = failedMaps === 0;
        const result: MapReduceResult<TMapOutput, TReduceOutput> = {
            success: overallSuccess,
            output: reduceResult.output,
            mapResults,
            reduceStats: reduceResult.stats,
            totalTimeMs,
            executionStats
        };

        // Add error message if there were failures
        if (!overallSuccess) {
            // Get error messages from failed items
            const failedResults = mapResults.filter(r => !r.success);
            if (failedResults.length === 1) {
                result.error = `1 item failed: ${failedResults[0].error || 'Unknown error'}`;
            } else {
                // Collect unique error messages
                const uniqueErrors = [...new Set(failedResults.map(r => r.error || 'Unknown error'))];
                if (uniqueErrors.length === 1) {
                    result.error = `${failedResults.length} items failed: ${uniqueErrors[0]}`;
                } else {
                    result.error = `${failedResults.length} items failed with ${uniqueErrors.length} different errors`;
                }
            }
        }

        return result;
    }

    /**
     * Execute the map phase with concurrency limiting
     */
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

        // Create tasks for each work item
        const tasks = workItems.map((item, index) => {
            return () => {
                // Check for cancellation before starting this task
                if (cancelled || this.options.isCancelled?.()) {
                    cancelled = true;
                    // Return a cancelled result instead of throwing
                    return Promise.resolve<MapResult<TMapOutput>>({
                        workItemId: item.id,
                        success: false,
                        error: 'Operation cancelled',
                        executionTimeMs: 0
                    });
                }

                return this.executeMapItem(
                    job,
                    item,
                    {
                        executionId,
                        totalItems: workItems.length,
                        itemIndex: index,
                        parentGroupId,
                        isCancelled: this.options.isCancelled
                    },
                    options
                ).then(result => {
                    // Update progress
                    if (result.success) {
                        completedCount++;
                    } else {
                        failedCount++;
                    }

                    this.reportProgress({
                        phase: 'mapping',
                        totalItems: workItems.length,
                        completedItems: completedCount,
                        failedItems: failedCount,
                        percentage: Math.round(((completedCount + failedCount) / workItems.length) * 85),
                        message: `Processed ${completedCount + failedCount}/${workItems.length} items...`
                    });

                    // Notify per-item completion (for incremental saving, etc.)
                    if (this.options.onItemComplete) {
                        try {
                            this.options.onItemComplete(item, result);
                        } catch {
                            // Don't let callback errors affect the pipeline
                        }
                    }

                    return result;
                });
            };
        });

        // Execute with concurrency limit and cancellation support
        try {
            return await this.limiter.all(tasks, this.options.isCancelled);
        } catch (error) {
            if (error instanceof CancellationError) {
                // Return cancelled results for any remaining items
                const processedCount = completedCount + failedCount;
                const cancelledResults: MapResult<TMapOutput>[] = [];
                for (let i = processedCount; i < workItems.length; i++) {
                    cancelledResults.push({
                        workItemId: workItems[i].id,
                        success: false,
                        error: 'Operation cancelled',
                        executionTimeMs: 0
                    });
                }
                throw error; // Re-throw to propagate cancellation
            }
            throw error;
        }
    }

    /**
     * Execute a single map item with retry support
     */
    private async executeMapItem<TWorkItemData, TMapOutput>(
        job: MapReduceJob<unknown, TWorkItemData, TMapOutput, unknown>,
        item: WorkItem<TWorkItemData>,
        context: MapContext,
        options: MapReduceOptions
    ): Promise<MapResult<TMapOutput>> {
        const startTime = Date.now();
        const maxAttempts = options.retryOnFailure ? (options.retryAttempts || 1) + 1 : 1;
        const baseTimeoutMs = options.timeoutMs || DEFAULT_MAP_REDUCE_OPTIONS.timeoutMs;

        // Register process if tracker available
        let processId: string | undefined;
        if (this.options.processTracker) {
            processId = this.options.processTracker.registerProcess(
                `Processing item ${context.itemIndex + 1}/${context.totalItems}`,
                context.parentGroupId
            );
        }

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                // Try with timeout, including timeout retry with doubled value
                const output = await this.executeMapItemWithTimeoutRetry<TWorkItemData, TMapOutput>(
                    job,
                    item,
                    context,
                    baseTimeoutMs
                );

                const executionTimeMs = Date.now() - startTime;

                // Update process status with structured result
                if (this.options.processTracker && processId) {
                    // Serialize the output for structured result storage
                    let structuredResult: string | undefined;
                    try {
                        structuredResult = JSON.stringify(output);
                    } catch {
                        // Ignore serialization errors
                    }
                    this.options.processTracker.updateProcess(processId, 'completed', undefined, undefined, structuredResult);
                    
                    // Attach session metadata if the output contains sessionId (for session resume)
                    // This is used by pipeline items to enable session resume functionality
                    if (this.options.processTracker.attachSessionMetadata) {
                        const outputWithSession = output as { sessionId?: string };
                        if (outputWithSession?.sessionId) {
                            this.options.processTracker.attachSessionMetadata(processId, {
                                sessionId: outputWithSession.sessionId,
                                backend: 'copilot-sdk' // If we have a sessionId, it came from SDK
                            });
                        }
                    }
                }

                return {
                    workItemId: item.id,
                    success: true,
                    output,
                    executionTimeMs,
                    processId
                };
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);

                // If this was the last attempt, return failure
                if (attempt === maxAttempts - 1) {
                    const executionTimeMs = Date.now() - startTime;

                    // Update process status
                    if (this.options.processTracker && processId) {
                        this.options.processTracker.updateProcess(processId, 'failed', undefined, errorMsg);
                    }

                    return {
                        workItemId: item.id,
                        success: false,
                        error: errorMsg,
                        executionTimeMs,
                        processId
                    };
                }

                // Wait before retry (exponential backoff)
                await this.delay(1000 * (attempt + 1));
            }
        }

        // Should never reach here, but TypeScript needs this
        return {
            workItemId: item.id,
            success: false,
            error: 'Unexpected error in map execution',
            executionTimeMs: Date.now() - startTime,
            processId
        };
    }

    /**
     * Execute a map item with timeout retry support.
     * On timeout, retries once with doubled timeout value.
     */
    private async executeMapItemWithTimeoutRetry<TWorkItemData, TMapOutput>(
        job: MapReduceJob<unknown, TWorkItemData, TMapOutput, unknown>,
        item: WorkItem<TWorkItemData>,
        context: MapContext,
        baseTimeoutMs: number | undefined
    ): Promise<TMapOutput> {
        // First attempt with base timeout
        try {
            return await this.executeMapItemWithTimeout<TWorkItemData, TMapOutput>(
                job,
                item,
                context,
                baseTimeoutMs
            );
        } catch (error) {
            // Check if it's a timeout error
            const isTimeoutError = error instanceof Error && 
                error.message.includes('timed out after');

            // If not a timeout error, re-throw immediately
            if (!isTimeoutError) {
                throw error;
            }

            // Timeout occurred - retry once with doubled timeout
            const doubledTimeoutMs = baseTimeoutMs ? baseTimeoutMs * 2 : undefined;
            
            // Second attempt with doubled timeout (no further retries for timeout)
            return await this.executeMapItemWithTimeout<TWorkItemData, TMapOutput>(
                job,
                item,
                context,
                doubledTimeoutMs
            );
        }
    }

    /**
     * Execute a map item with a specific timeout
     */
    private async executeMapItemWithTimeout<TWorkItemData, TMapOutput>(
        job: MapReduceJob<unknown, TWorkItemData, TMapOutput, unknown>,
        item: WorkItem<TWorkItemData>,
        context: MapContext,
        timeoutMs: number | undefined
    ): Promise<TMapOutput> {
        const mapPromise = job.mapper.map(item, context);

        if (timeoutMs && timeoutMs > 0) {
            return await Promise.race([
                mapPromise,
                this.createTimeoutPromise<TMapOutput>(timeoutMs)
            ]);
        } else {
            return await mapPromise;
        }
    }

    /**
     * Create a timeout promise that rejects after the specified time
     */
    private createTimeoutPromise<T>(timeoutMs: number): Promise<T> {
        return new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Operation timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        });
    }

    /**
     * Delay for a specified number of milliseconds
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Report progress to the callback if configured
     */
    private reportProgress(progress: JobProgress): void {
        if (this.options.onProgress) {
            this.options.onProgress(progress);
        }
    }

    /**
     * Create a failed result
     */
    private createFailedResult<TMapOutput, TReduceOutput>(
        startTime: number,
        error: string
    ): MapReduceResult<TMapOutput, TReduceOutput> {
        return {
            success: false,
            mapResults: [],
            totalTimeMs: Date.now() - startTime,
            executionStats: {
                totalItems: 0,
                successfulMaps: 0,
                failedMaps: 0,
                mapPhaseTimeMs: 0,
                reducePhaseTimeMs: 0,
                maxConcurrency: this.options.maxConcurrency
            },
            error
        };
    }

    /**
     * Create an empty result (no work items)
     */
    private createEmptyResult<TMapOutput, TReduceOutput>(
        startTime: number
    ): MapReduceResult<TMapOutput, TReduceOutput> {
        return {
            success: true,
            output: undefined,
            mapResults: [],
            reduceStats: {
                inputCount: 0,
                outputCount: 0,
                mergedCount: 0,
                reduceTimeMs: 0,
                usedAIReduce: false
            },
            totalTimeMs: Date.now() - startTime,
            executionStats: {
                totalItems: 0,
                successfulMaps: 0,
                failedMaps: 0,
                mapPhaseTimeMs: 0,
                reducePhaseTimeMs: 0,
                maxConcurrency: this.options.maxConcurrency
            }
        };
    }

    /**
     * Create a cancelled result
     */
    private createCancelledResult<TMapOutput, TReduceOutput>(
        startTime: number,
        mapPhaseTimeMs: number,
        totalItems: number,
        maxConcurrency: number
    ): MapReduceResult<TMapOutput, TReduceOutput> {
        return {
            success: false,
            mapResults: [],
            totalTimeMs: Date.now() - startTime,
            executionStats: {
                totalItems,
                successfulMaps: 0,
                failedMaps: 0,
                mapPhaseTimeMs,
                reducePhaseTimeMs: 0,
                maxConcurrency
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
