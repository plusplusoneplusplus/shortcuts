/**
 * Map node executor — applies an AI prompt to each item (or batch of items).
 *
 * Single-item mode: one AI call per item with `{{fieldName}}` interpolation.
 * Batch mode (batchSize > 1): one AI call per batch with `{{ITEMS}}` interpolation.
 *
 * Failures are annotated on items (`__error`) rather than thrown, preserving
 * the invariant that the output array length equals the input array length.
 */

import type { MapNodeConfig, Items, WorkflowExecutionOptions } from '../types';
import { ConcurrencyLimiter } from '../../map-reduce';
import {
    resolvePrompt,
    buildItemPrompt,
    buildBatchPrompt,
    splitIntoBatches,
    mergeOutput,
    extractJsonFromResponse,
} from './utils';

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
    const resolvedPrompt = await resolvePrompt(config.prompt, config.promptFile, options);
    const concurrency = config.concurrency ?? options.concurrency ?? 5;
    const limiter = new ConcurrencyLimiter(concurrency);

    const batchSize = config.batchSize ?? 1;

    if (batchSize > 1) {
        // ---- Batch mode ----
        const batches = splitIntoBatches(inputs, batchSize);
        const batchResults = await Promise.all(
            batches.map(batch =>
                limiter.run(async () => {
                    const prompt = buildBatchPrompt(resolvedPrompt, batch);
                    let result;
                    try {
                        result = await options.aiInvoker!(prompt, {
                            model: config.model ?? options.model,
                            timeoutMs: config.timeoutMs ?? options.timeoutMs,
                            workingDirectory: options.workingDirectory ?? options.workflowDirectory,
                        });
                    } catch (err) {
                        return batch.map(item => ({
                            ...item,
                            __error: err instanceof Error ? err.message : String(err),
                        }));
                    }
                    if (!result.success) {
                        return batch.map(item => ({
                            ...item,
                            __error: result.error ?? 'AI invocation failed',
                        }));
                    }
                    return parseBatchResponse(result.response!, batch, config.output);
                })
            )
        );
        return batchResults.flat();
    }

    // ---- Single-item mode ----
    const results = await Promise.all(
        inputs.map(item =>
            limiter.run(async () => {
                const prompt = buildItemPrompt(resolvedPrompt, item);
                let result;
                try {
                    result = await options.aiInvoker!(prompt, {
                        model: config.model ?? options.model,
                        timeoutMs: config.timeoutMs ?? options.timeoutMs,
                        workingDirectory: options.workingDirectory ?? options.workflowDirectory,
                    });
                } catch (err) {
                    return {
                        ...item,
                        __error: err instanceof Error ? err.message : String(err),
                    };
                }
                if (!result.success) {
                    return { ...item, __error: result.error ?? 'AI invocation failed' };
                }
                return mergeOutput(item, result.response!, config.output);
            })
        )
    );
    return results;
}
