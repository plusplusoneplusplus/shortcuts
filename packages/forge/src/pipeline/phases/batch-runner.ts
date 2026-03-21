/**
 * Pipeline Batch Runner
 *
 * Handles batch-mode pipeline execution where multiple items are processed per AI call.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    PromptItem,
    PromptMapResult,
} from '../../map-reduce';
import {
    FilterResult,
} from '../types';
import { DEFAULT_AI_TIMEOUT_MS, DEFAULT_PARALLEL_LIMIT } from '../../config/defaults';
import { substituteVariables } from '../../utils/template-engine';
import {
    PipelineExecutionError,
    ExecutePipelineOptions,
    MapReducePipelineConfig,
    ResolvedPrompts,
    PipelineExecutionResult,
    emitPhase,
    convertParametersToObject,
} from './shared';
import { executeReducePhase } from './output-collector';

/**
 * Split items into batches of specified size
 */
export function splitIntoBatches(items: PromptItem[], batchSize: number): PromptItem[][] {
    const batches: PromptItem[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
        batches.push(items.slice(i, i + batchSize));
    }
    return batches;
}

/**
 * Substitute model template variables using item values.
 */
export function substituteModelTemplate(
    modelTemplate: string | undefined,
    item: Record<string, unknown>
): string | undefined {
    if (!modelTemplate || typeof modelTemplate !== 'string') {
        return undefined;
    }
    const substituted = substituteVariables(modelTemplate, item, {
        strict: false,
        missingValueBehavior: 'empty',
        preserveSpecialVariables: false
    });
    return substituted || undefined;
}

/**
 * Build the prompt for a batch, substituting {{ITEMS}} with the batch JSON
 * and other template variables from the first item (for parameters)
 */
export function buildBatchPrompt(promptTemplate: string, batch: PromptItem[], outputFields: string[]): string {
    // Replace {{ITEMS}} with the batch JSON
    const batchJson = JSON.stringify(batch, null, 2);
    let prompt = promptTemplate.replace(/\{\{ITEMS\}\}/g, batchJson);
    
    // Substitute other template variables from the first item
    if (batch.length > 0) {
        const firstItem = batch[0];
        prompt = prompt.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
            // Skip special variables that are handled elsewhere
            if (['ITEMS', 'RESULTS', 'RESULTS_FILE', 'COUNT', 'SUCCESS_COUNT', 'FAILURE_COUNT'].includes(varName)) {
                return match;
            }
            return varName in firstItem ? firstItem[varName] : match;
        });
    }
    
    // Add output instruction if we have output fields
    if (outputFields.length > 0) {
        prompt += `\n\nReturn a JSON array with ${batch.length} objects, one for each input item. Each object must have these fields: ${outputFields.join(', ')}`;
    }
    
    return prompt;
}

/**
 * Create an empty output object with null values for all fields
 */
export function createEmptyOutput(fields: string[]): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    for (const field of fields) {
        output[field] = null;
    }
    return output;
}

/**
 * Create a timeout promise for batch processing
 */
export function createBatchTimeoutPromise(timeoutMs: number, batchIndex: number, totalBatches: number): Promise<never> {
    return new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error(`Batch ${batchIndex + 1}/${totalBatches} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });
}

/**
 * Parse the AI response for a batch
 */
export function parseBatchResponse(
    response: string,
    batch: PromptItem[],
    outputFields: string[],
    isTextMode: boolean,
    sessionId?: string
): PromptMapResult[] {
    // Text mode - not supported for batch processing
    if (isTextMode) {
        return batch.map(item => ({
            item,
            output: {},
            rawText: response,
            success: true,
            rawResponse: response,
            sessionId
        }));
    }

    try {
        // Extract JSON array from response
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            throw new Error('Response does not contain a JSON array');
        }

        const parsed = JSON.parse(jsonMatch[0]);
        
        if (!Array.isArray(parsed)) {
            throw new Error('Parsed response is not an array');
        }

        // Validate count matches
        if (parsed.length !== batch.length) {
            const errorMsg = `AI returned ${parsed.length} results but batch has ${batch.length} items`;
            return batch.map(item => ({
                item,
                output: createEmptyOutput(outputFields),
                success: false,
                error: errorMsg,
                rawResponse: response,
                sessionId
            }));
        }

        // Map results to items
        return batch.map((item, index) => {
            const resultObj = parsed[index];
            
            if (typeof resultObj !== 'object' || resultObj === null) {
                return {
                    item,
                    output: createEmptyOutput(outputFields),
                    success: false,
                    error: `Result at index ${index} is not an object`,
                    rawResponse: response,
                    sessionId
                };
            }

            // Extract only the declared output fields
            const output: Record<string, unknown> = {};
            for (const field of outputFields) {
                output[field] = field in resultObj ? resultObj[field] : null;
            }

            return {
                item,
                output,
                success: true,
                rawResponse: response,
                sessionId
            };
        });
    } catch (error) {
        const errorMsg = `Failed to parse batch response: ${error instanceof Error ? error.message : String(error)}`;
        return batch.map(item => ({
            item,
            output: createEmptyOutput(outputFields),
            success: false,
            error: errorMsg,
            rawResponse: response,
            sessionId
        }));
    }
}

/**
 * Execute pipeline in batch mode (multiple items per AI call)
 */
export async function executeBatchMode(
    config: MapReducePipelineConfig,
    processItems: PromptItem[],
    prompts: ResolvedPrompts,
    options: ExecutePipelineOptions,
    filterResult?: FilterResult
): Promise<PipelineExecutionResult> {
    const batchSize = config.map.batchSize ?? 1;
    const parallelLimit = config.map.parallel ?? DEFAULT_PARALLEL_LIMIT;
    const timeoutMs = config.map.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
    const outputFields = config.map.output || [];
    const isTextMode = outputFields.length === 0;
    const itemProcessIds: string[] = [];

    // Split items into batches
    const batches = splitIntoBatches(processItems, batchSize);
    const totalBatches = batches.length;

    // Register group process if tracker is available
    let groupId: string | undefined;
    if (options.processTracker && totalBatches > 1) {
        groupId = options.processTracker.registerGroup(`${config.name} (${totalBatches} batches)`);
    }

    // Report initial progress
    emitPhase(options, 'map', 'started', { itemCount: processItems.length });
    options.onProgress?.({
        phase: 'mapping',
        totalItems: totalBatches,
        completedItems: 0,
        failedItems: 0,
        percentage: 0,
        message: `Processing ${totalBatches} batches (${processItems.length} items, batch size ${batchSize})...`
    });

    // Process batches with concurrency limit
    const startTime = Date.now();
    const allResults: PromptMapResult[] = [];
    let completedBatches = 0;
    let failedBatches = 0;

    const emitItemEvents = (results: PromptMapResult[], batchIndex: number, batchProcessId?: string) => {
        if (!options.onItemProcessCreated) { return; }
        const baseItemIndex = batchIndex * batchSize;
        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            const perItemId = batchProcessId ? `${batchProcessId}-i${i}` : `batch-${batchIndex}-i${i}`;
            itemProcessIds.push(perItemId);
            try {
                options.onItemProcessCreated({
                    itemIndex: baseItemIndex + i,
                    processId: perItemId,
                    item: r.item,
                    batchIndex,
                    phase: 'map',
                    success: r.success,
                    error: r.error,
                    sessionId: r.sessionId,
                });
            } catch { /* callback errors don't break execution */ }
        }
    };

    const processBatch = async (batch: PromptItem[], batchIndex: number): Promise<PromptMapResult[]> => {
        // Check for cancellation
        if (options.isCancelled?.()) {
            const cancelledResults = batch.map(item => ({
                item,
                output: isTextMode ? {} : createEmptyOutput(outputFields),
                success: false,
                error: 'Operation cancelled'
            }));
            emitItemEvents(cancelledResults, batchIndex);
            return cancelledResults;
        }

        // Register batch process
        let processId: string | undefined;
        if (options.processTracker) {
            processId = options.processTracker.registerProcess(
                `Processing batch ${batchIndex + 1}/${totalBatches} (${batch.length} items)`,
                groupId
            );
        }

        try {
            // Build the prompt with {{ITEMS}} containing the batch
            const batchPrompt = buildBatchPrompt(prompts.mapPrompt, batch, outputFields);
            
            // Resolve model (use first item for template substitution if model is templated)
            const model = substituteModelTemplate(config.map.model, batch[0]);

            // Call AI with timeout
            const aiResult = await Promise.race([
                options.aiInvoker(batchPrompt, { model }),
                createBatchTimeoutPromise(timeoutMs, batchIndex, totalBatches)
            ]);

            if (!aiResult.success || !aiResult.response) {
                // AI call failed - mark all items in batch as failed
                if (options.processTracker && processId) {
                    options.processTracker.updateProcess(processId, 'failed', undefined, aiResult.error || 'AI invocation failed');
                }
                const failedResults = batch.map(item => ({
                    item,
                    output: isTextMode ? {} : createEmptyOutput(outputFields),
                    success: false,
                    error: aiResult.error || 'AI invocation failed',
                    rawResponse: aiResult.response,
                    sessionId: aiResult.sessionId
                }));
                emitItemEvents(failedResults, batchIndex, processId);
                return failedResults;
            }

            // Parse batch response
            const batchResults = parseBatchResponse(
                aiResult.response,
                batch,
                outputFields,
                isTextMode,
                aiResult.sessionId
            );

            // Update process status
            if (options.processTracker && processId) {
                const successCount = batchResults.filter(r => r.success).length;
                options.processTracker.updateProcess(
                    processId,
                    'completed',
                    `${successCount}/${batch.length} items succeeded`,
                    undefined,
                    JSON.stringify(batchResults.map(r => r.output))
                );
            }

            emitItemEvents(batchResults, batchIndex, processId);
            return batchResults;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            
            // Check if it's a timeout - retry with doubled timeout
            if (errorMsg.includes('timed out')) {
                try {
                    const batchPrompt = buildBatchPrompt(prompts.mapPrompt, batch, outputFields);
                    const model = substituteModelTemplate(config.map.model, batch[0]);

                    const aiResult = await Promise.race([
                        options.aiInvoker(batchPrompt, { model }),
                        createBatchTimeoutPromise(timeoutMs * 2, batchIndex, totalBatches)
                    ]);

                    if (aiResult.success && aiResult.response) {
                        const batchResults = parseBatchResponse(
                            aiResult.response,
                            batch,
                            outputFields,
                            isTextMode,
                            aiResult.sessionId
                        );

                        if (options.processTracker && processId) {
                            const successCount = batchResults.filter(r => r.success).length;
                            options.processTracker.updateProcess(
                                processId,
                                'completed',
                                `${successCount}/${batch.length} items succeeded (after retry)`,
                                undefined,
                                JSON.stringify(batchResults.map(r => r.output))
                            );
                        }

                        emitItemEvents(batchResults, batchIndex, processId);
                        return batchResults;
                    }
                } catch (retryError) {
                    // Retry also failed
                }
            }

            // Mark all items in batch as failed
            if (options.processTracker && processId) {
                options.processTracker.updateProcess(processId, 'failed', undefined, errorMsg);
            }
            const failedResults = batch.map(item => ({
                item,
                output: isTextMode ? {} : createEmptyOutput(outputFields),
                success: false,
                error: errorMsg
            }));
            emitItemEvents(failedResults, batchIndex, processId);
            return failedResults;
        }
    };

    // Process batches with concurrency limit
    const batchPromises: Promise<PromptMapResult[]>[] = [];
    const active = new Set<Promise<void>>();

    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        
        // Wait until a slot is free; while handles multiple simultaneous completions
        while (active.size >= parallelLimit) {
            await Promise.race(active);
        }

        const batchPromise = processBatch(batch, i).then(results => {
            allResults.push(...results);
            
            // Update progress
            const hasFailures = results.some(r => !r.success);
            if (hasFailures) {
                failedBatches++;
            } else {
                completedBatches++;
            }

            options.onProgress?.({
                phase: 'mapping',
                totalItems: totalBatches,
                completedItems: completedBatches,
                failedItems: failedBatches,
                percentage: Math.round(((completedBatches + failedBatches) / totalBatches) * 85),
                message: `Processing batch ${completedBatches + failedBatches}/${totalBatches}...`
            });

            return results;
        });

        batchPromises.push(batchPromise);
        
        // Track active slot; finally ensures the slot is freed even if the batch rejects
        const slot: Promise<void> = batchPromise.then((): void => { return; }).finally(() => active.delete(slot));
        active.add(slot);
    }

    // Wait for all batches to complete
    await Promise.all(batchPromises);

    const mapPhaseTimeMs = Date.now() - startTime;

    // Calculate statistics
    const successfulMaps = allResults.filter(r => r.success).length;
    const failedMaps = allResults.filter(r => !r.success).length;

    // Report map complete
    emitPhase(options, 'map', 'completed', { durationMs: mapPhaseTimeMs, itemCount: processItems.length });
    options.onProgress?.({
        phase: 'reducing',
        totalItems: processItems.length,
        completedItems: successfulMaps,
        failedItems: failedMaps,
        percentage: 90,
        message: 'Aggregating results...'
    });

    // Execute reduce phase
    emitPhase(options, 'reduce', 'started');
    const reduceStartTime = Date.now();
    const reduceParameters = config.input.parameters
        ? convertParametersToObject(config.input.parameters)
        : undefined;

    const reduceResult = await executeReducePhase(
        allResults,
        config,
        prompts,
        options,
        reduceParameters,
        groupId
    );

    const reducePhaseTimeMs = Date.now() - reduceStartTime;
    emitPhase(options, 'reduce', 'completed', { durationMs: reducePhaseTimeMs });
    const totalTimeMs = Date.now() - startTime;

    // Build execution stats
    const executionStats = {
        totalItems: processItems.length,
        successfulMaps,
        failedMaps,
        mapPhaseTimeMs,
        reducePhaseTimeMs,
        maxConcurrency: parallelLimit
    };

    // Complete group process if registered
    if (options.processTracker && groupId) {
        options.processTracker.completeGroup(
            groupId,
            `Completed: ${successfulMaps}/${processItems.length} items processed in ${totalBatches} batches`,
            executionStats
        );
    }

    // Report complete
    options.onProgress?.({
        phase: 'complete',
        totalItems: processItems.length,
        completedItems: successfulMaps,
        failedItems: failedMaps,
        percentage: 100,
        message: `Complete: ${successfulMaps} succeeded, ${failedMaps} failed (${totalBatches} batches)`
    });

    // Build map results for compatibility with existing result structure
    const mapResults = allResults.map(r => ({
        workItemId: `item-${allResults.indexOf(r)}`,
        success: r.success,
        output: r,
        error: r.error,
        executionTimeMs: 0 // Not tracked per-item in batch mode
    }));

    const overallSuccess = failedMaps === 0;
    const result: PipelineExecutionResult = {
        success: overallSuccess,
        output: reduceResult,
        mapResults,
        reduceStats: {
            inputCount: allResults.length,
            outputCount: reduceResult ? 1 : 0,
            mergedCount: successfulMaps,
            reduceTimeMs: reducePhaseTimeMs,
            usedAIReduce: config.reduce.type === 'ai'
        },
        totalTimeMs,
        executionStats,
        filterResult,
        itemProcessIds: itemProcessIds.length > 0 ? itemProcessIds : undefined
    };

    if (!overallSuccess) {
        const failedResults = allResults.filter(r => !r.success);
        if (failedResults.length === 1) {
            result.error = `1 item failed: ${failedResults[0].error || 'Unknown error'}`;
        } else {
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
