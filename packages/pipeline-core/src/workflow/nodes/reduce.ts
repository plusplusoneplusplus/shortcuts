/**
 * Reduce node executor — aggregates items into a single result.
 *
 * Always returns exactly one element. Downstream nodes depend on this invariant.
 *
 * Supported strategies:
 * - `list`   — markdown bullet list
 * - `table`  — markdown table
 * - `json`   — serialized JSON
 * - `csv`    — comma-separated values
 * - `concat` — plain text concatenation
 * - `ai`     — AI-powered aggregation
 */

import type { ReduceNodeConfig, Item, Items, WorkflowExecutionOptions } from '../types';
import { resolvePrompt, mergeOutput } from './utils';

// ---------------------------------------------------------------------------
// Deterministic formatters
// ---------------------------------------------------------------------------

function formatAsList(inputs: Items): string {
    return inputs
        .map(item => `- ${item.text ?? JSON.stringify(item)}`)
        .join('\n');
}

/** Uses the keys of the first item as column headers (intentional — mirrors pipeline reduce). */
function formatAsTable(inputs: Items): string {
    if (inputs.length === 0) return '';
    const headers = Object.keys(inputs[0]);
    const header = `| ${headers.join(' | ')} |`;
    const separator = `| ${headers.map(() => '---').join(' | ')} |`;
    const rows = inputs.map(
        item => `| ${headers.map(h => String(item[h] ?? '')).join(' | ')} |`
    );
    return [header, separator, ...rows].join('\n');
}

function formatAsCsv(inputs: Items): string {
    if (inputs.length === 0) return '';
    const headers = Object.keys(inputs[0]);
    const escape = (v: unknown) => {
        const s = String(v ?? '');
        return s.includes(',') || s.includes('"') || s.includes('\n')
            ? `"${s.replace(/"/g, '""')}"`
            : s;
    };
    const headerRow = headers.map(escape).join(',');
    const dataRows = inputs.map(item => headers.map(h => escape(item[h])).join(','));
    return [headerRow, ...dataRows].join('\n');
}

function formatAsConcat(inputs: Items): string {
    return inputs
        .map(item => (typeof item.text === 'string' ? item.text : JSON.stringify(item)))
        .join('\n\n');
}

// ---------------------------------------------------------------------------
// AI reduce
// ---------------------------------------------------------------------------

async function executeAIReduce(
    config: ReduceNodeConfig,
    inputs: Items,
    options: WorkflowExecutionOptions
): Promise<Items> {
    const resolvedPrompt = await resolvePrompt(config.prompt, config.promptFile, options, options.parameters, config.skill, config.skills);

    const prompt = resolvedPrompt
        .replace(/\{\{RESULTS\}\}/g, JSON.stringify(inputs, null, 2))
        .replace(/\{\{COUNT\}\}/g, String(inputs.length));

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
        return [{ __error: result.error ?? 'AI reduce invocation failed' } as Item];
    }

    const aggregated = mergeOutput({} as Item, result.response, config.output);
    return [aggregated];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute a reduce node, aggregating input items into a single-element array.
 *
 * @returns An Items array of exactly one element, regardless of strategy.
 */
export async function executeReduce(
    config: ReduceNodeConfig,
    inputs: Items,
    options: WorkflowExecutionOptions
): Promise<Items> {
    switch (config.strategy) {
        case 'list':   return [{ output: formatAsList(inputs) } as Item];
        case 'table':  return [{ output: formatAsTable(inputs) } as Item];
        case 'json':   return [{ output: JSON.stringify(inputs, null, 2) } as Item];
        case 'csv':    return [{ output: formatAsCsv(inputs) } as Item];
        case 'concat': return [{ output: formatAsConcat(inputs) } as Item];
        case 'ai':     return executeAIReduce(config, inputs, options);
        default:
            throw new Error(`Unknown reduce strategy: ${config.strategy}`);
    }
}
