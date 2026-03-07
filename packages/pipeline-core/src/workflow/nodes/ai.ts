/**
 * AI node executor — sends all items to an AI model in a single prompt.
 *
 * Unlike `map` (which processes items individually or in batches), this node
 * sends all items at once via `{{ITEMS}}` substitution and always produces
 * exactly one output item.
 */

import type { AINodeConfig, Item, Items, WorkflowExecutionOptions } from '../types';
import { resolvePrompt, mergeOutput } from './utils';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute an AI node, issuing a single AI call with the full input collection.
 *
 * @returns An Items array of exactly one element.
 */
export async function executeAI(
    config: AINodeConfig,
    inputs: Items,
    options: WorkflowExecutionOptions
): Promise<Items> {
    const resolvedPrompt = await resolvePrompt(config.prompt, config.promptFile, options, options.parameters, config.skill);

    const prompt = resolvedPrompt
        .replace(/\{\{ITEMS\}\}/g, JSON.stringify(inputs, null, 2));

    let result;
    try {
        result = await options.aiInvoker!(prompt, {
            model: config.model ?? options.model,
            timeoutMs: config.timeoutMs ?? options.timeoutMs,
            workingDirectory: options.workingDirectory ?? options.workflowDirectory,
        });
    } catch (err) {
        return [{ __error: err instanceof Error ? err.message : String(err) } as Item];
    }

    if (!result.success || !result.response) {
        return [{ __error: result.error ?? 'AI node invocation failed' } as Item];
    }

    return [mergeOutput({} as Item, result.response, config.output)];
}
