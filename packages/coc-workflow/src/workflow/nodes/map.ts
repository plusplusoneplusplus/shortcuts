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
import { isWorkflowCancelled, throwIfWorkflowCancelled } from '../cancellation';
import { invokeWorkflowAI } from './ai-invocation-kernel';
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
    throwIfWorkflowCancelled(options.signal);

    const resolvedPrompt = await resolvePrompt(config.prompt, config.promptFile, options, options.parameters, config.skill, config.skills);
    throwIfWorkflowCancelled(options.signal);

    const concurrency = config.concurrency ?? options.concurrency ?? 5;
    const limiter = new ConcurrencyLimiter(concurrency);
    const isCancelled = () => isWorkflowCancelled(options.signal);

    const batchSize = config.batchSize ?? 1;

    if (batchSize > 1) {
        // ---- Batch mode ----
        const batches = splitIntoBatches(inputs, batchSize);
        const batchResults = await Promise.all(
            batches.map((batch, batchIndex) =>
                limiter.run(async () => {
                    throwIfWorkflowCancelled(options.signal);

                    const nodeId = options.currentNodeId ?? '';
                    const itemLabel = `batch-${batchIndex}`;
                    const processId = options.processTracker?.registerProcess(`Map: ${itemLabel}`)
                        ?? `${nodeId}-batch-${batchIndex}`;

                    const result = await invokeWorkflowAI({
                        prompt: buildBatchPrompt(resolvedPrompt, batch),
                        options,
                        model: config.model,
                        timeoutMs: config.timeoutMs,
                        lifecycle: {
                            processTracker: options.processTracker,
                            onItemProcess: options.onItemProcess,
                            processId, nodeId, itemIndex: batchIndex, itemLabel,
                        },
                    });
                    if (!result.success) {
                        const error = result.error ?? 'AI invocation failed';
                        return batch.map(item => ({ ...item, __error: error }));
                    }
                    return parseBatchResponse(result.response!, batch, config.output);
                }, isCancelled)
            )
        );
        return batchResults.flat();
    }

    // ---- Single-item mode ----
    const results = await Promise.all(
        inputs.map((item, index) =>
            limiter.run(async () => {
                throwIfWorkflowCancelled(options.signal);

                const nodeId = options.currentNodeId ?? '';
                const itemLabel = getItemLabel(item, index);
                const processId = options.processTracker?.registerProcess(`Map: ${itemLabel}`)
                    ?? `${nodeId}-${index}`;

                const result = await invokeWorkflowAI({
                    prompt: buildItemPrompt(resolvedPrompt, item),
                    options,
                    model: config.model,
                    timeoutMs: config.timeoutMs,
                    lifecycle: {
                        processTracker: options.processTracker,
                        onItemProcess: options.onItemProcess,
                        processId, nodeId, itemIndex: index, itemLabel,
                    },
                });
                if (!result.success) {
                    return { ...item, __error: result.error ?? 'AI invocation failed' };
                }
                return mergeOutput(item, result.response!, config.output);
            }, isCancelled)
        )
    );
    return results;
}
