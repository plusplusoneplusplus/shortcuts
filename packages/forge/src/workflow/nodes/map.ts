/**
 * Map node executor — applies an AI prompt to each item (or batch of items).
 *
 * Single-item mode: one AI call per item with `{{fieldName}}` interpolation.
 * Batch mode (batchSize > 1): one AI call per batch with `{{ITEMS}}` interpolation.
 *
 * Failures are annotated on items (`__error`) rather than thrown, preserving
 * the invariant that the output array length equals the input array length.
 */

import type { MapNodeConfig, Items, WorkflowExecutionOptions, Item } from '../types';
import { ConcurrencyLimiter } from '../concurrency-limiter';
import {
    resolvePrompt,
    buildItemPrompt,
    buildBatchPrompt,
    splitIntoBatches,
    mergeOutput,
    extractJsonFromResponse,
} from './utils';

// ---------------------------------------------------------------------------
// Item label helper
// ---------------------------------------------------------------------------

function getItemLabel(item: Item, index: number): string {
    const firstValue = Object.values(item)[0];
    return firstValue != null ? String(firstValue) : `item-${index}`;
}

// ---------------------------------------------------------------------------
// Batch response parsing
// ---------------------------------------------------------------------------

function parseBatchResponse(response: string, batch: Items, outputFields?: string[]): Items {
    let parsed: unknown;
    try {
        parsed = extractJsonFromResponse(response);
    } catch (err) {
        return batch.map(item => ({
            ...item,
            __error: `Batch parse failed: ${err instanceof Error ? err.message : String(err)}`,
        }));
    }

    if (!Array.isArray(parsed)) {
        return batch.map(item => ({
            ...item,
            __error: 'Batch AI response is not a JSON array',
        }));
    }

    if (parsed.length !== batch.length) {
        const msg = `Batch length mismatch: expected ${batch.length}, got ${parsed.length}`;
        return batch.map(item => ({ ...item, __error: msg }));
    }

    return batch.map((item, i) => mergeOutput(item, JSON.stringify(parsed[i]), outputFields));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute a map node, applying an AI prompt to every input item.
 *
 * @returns An Items array of the same length as `inputs`. Failed items carry
 *          `__error`; the function itself never throws for per-item failures.
 */
export async function executeMap(
    config: MapNodeConfig,
    inputs: Items,
    options: WorkflowExecutionOptions
): Promise<Items> {
    const resolvedPrompt = await resolvePrompt(config.prompt, config.promptFile, options, options.parameters, config.skill, config.skills);
    const concurrency = config.concurrency ?? options.concurrency ?? 5;
    const limiter = new ConcurrencyLimiter(concurrency);

    const batchSize = config.batchSize ?? 1;

    if (batchSize > 1) {
        // ---- Batch mode ----
        const batches = splitIntoBatches(inputs, batchSize);
        const batchResults = await Promise.all(
            batches.map((batch, batchIndex) =>
                limiter.run(async () => {
                    const nodeId = options.currentNodeId ?? '';
                    const itemLabel = `batch-${batchIndex}`;
                    const processId = options.processTracker?.registerProcess(`Map: ${itemLabel}`)
                        ?? `${nodeId}-batch-${batchIndex}`;

                    options.onItemProcess?.({
                        nodeId, itemIndex: batchIndex, processId, status: 'running', itemLabel,
                    });

                    const prompt = buildBatchPrompt(resolvedPrompt, batch);
                    let result;
                    try {
                        result = await options.aiInvoker!(prompt, {
                            model: config.model ?? options.model,
                            timeoutMs: config.timeoutMs ?? options.timeoutMs,
                            workingDirectory: options.workingDirectory ?? options.workflowDirectory,
                        });
                    } catch (err) {
                        const error = err instanceof Error ? err.message : String(err);
                        options.processTracker?.updateProcess(processId, 'failed', undefined, error);
                        options.onItemProcess?.({
                            nodeId, itemIndex: batchIndex, processId, status: 'failed', itemLabel, error,
                        });
                        return batch.map(item => ({ ...item, __error: error }));
                    }
                    if (!result.success) {
                        const error = result.error ?? 'AI invocation failed';
                        options.processTracker?.updateProcess(processId, 'failed', undefined, error);
                        options.onItemProcess?.({
                            nodeId, itemIndex: batchIndex, processId, status: 'failed', itemLabel, error,
                        });
                        return batch.map(item => ({ ...item, __error: error }));
                    }

                    options.processTracker?.updateProcess(processId, 'completed', result.response);
                    options.onItemProcess?.({
                        nodeId, itemIndex: batchIndex, processId, status: 'completed', itemLabel,
                    });
                    return parseBatchResponse(result.response!, batch, config.output);
                })
            )
        );
        return batchResults.flat();
    }

    // ---- Single-item mode ----
    const results = await Promise.all(
        inputs.map((item, index) =>
            limiter.run(async () => {
                const nodeId = options.currentNodeId ?? '';
                const itemLabel = getItemLabel(item, index);
                const processId = options.processTracker?.registerProcess(`Map: ${itemLabel}`)
                    ?? `${nodeId}-${index}`;

                options.onItemProcess?.({
                    nodeId, itemIndex: index, processId, status: 'running', itemLabel,
                });

                const prompt = buildItemPrompt(resolvedPrompt, item);
                let result;
                try {
                    result = await options.aiInvoker!(prompt, {
                        model: config.model ?? options.model,
                        timeoutMs: config.timeoutMs ?? options.timeoutMs,
                        workingDirectory: options.workingDirectory ?? options.workflowDirectory,
                    });
                } catch (err) {
                    const error = err instanceof Error ? err.message : String(err);
                    options.processTracker?.updateProcess(processId, 'failed', undefined, error);
                    options.onItemProcess?.({
                        nodeId, itemIndex: index, processId, status: 'failed', itemLabel, error,
                    });
                    return { ...item, __error: error };
                }
                if (!result.success) {
                    const error = result.error ?? 'AI invocation failed';
                    options.processTracker?.updateProcess(processId, 'failed', undefined, error);
                    options.onItemProcess?.({
                        nodeId, itemIndex: index, processId, status: 'failed', itemLabel, error,
                    });
                    return { ...item, __error: error };
                }

                options.processTracker?.updateProcess(processId, 'completed', result.response);
                options.onItemProcess?.({
                    nodeId, itemIndex: index, processId, status: 'completed', itemLabel,
                });
                return mergeOutput(item, result.response!, config.output);
            })
        )
    );
    return results;
}
