/**
 * AI node executor — sends all items to an AI model in a single prompt.
 *
 * Unlike `map` (which processes items individually or in batches), this node
 * sends all items at once via `{{ITEMS}}` substitution and always produces
 * exactly one output item.
 */

import type { AINodeConfig, Item, Items, WorkflowExecutionOptions } from '../types';
import { throwIfWorkflowCancelled } from '../cancellation';
import { invokeWorkflowAI } from './ai-invocation-kernel';
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
    throwIfWorkflowCancelled(options.signal);

    const resolvedPrompt = await resolvePrompt(config.prompt, config.promptFile, options, options.parameters, config.skill, config.skills);
    throwIfWorkflowCancelled(options.signal);

    const prompt = resolvedPrompt
        .replace(/\{\{ITEMS\}\}/g, JSON.stringify(inputs, null, 2));

    const nodeId = options.currentNodeId ?? '';
    const processId = options.processTracker?.registerProcess(`AI: ${nodeId}`)
        ?? `${nodeId}-ai`;

    const result = await invokeWorkflowAI({
        prompt,
        options,
        model: config.model,
        timeoutMs: config.timeoutMs,
        requireResponse: true,
        failureMessage: 'AI node invocation failed',
        lifecycle: {
            processTracker: options.processTracker,
            onItemProcess: options.onItemProcess,
            processId, nodeId, itemIndex: 0,
        },
    });

    if (!result.success) {
        return [{ __error: result.error ?? 'AI node invocation failed' } as Item];
    }

    return [mergeOutput({} as Item, result.response!, config.output)];
}
