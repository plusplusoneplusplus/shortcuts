/**
 * Pipeline Output Collector
 *
 * Handles reduce phase execution and result formatting.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    PromptMapResult,
    PromptMapOutput,
    PromptMapSummary,
} from '../../map-reduce';
import {
    PipelineExecutionError,
    ExecutePipelineOptions,
    MapReducePipelineConfig,
    ResolvedPrompts,
    convertParametersToObject,
} from './shared';

/**
 * Execute the reduce phase for batch mode results
 */
export async function executeReducePhase(
    results: PromptMapResult[],
    config: MapReducePipelineConfig,
    prompts: ResolvedPrompts,
    options: ExecutePipelineOptions,
    reduceParameters?: Record<string, string>,
    parentGroupId?: string
): Promise<PromptMapOutput> {
    const outputFields = config.map.output || [];
    const successfulItems = results.filter(r => r.success).length;
    const failedItems = results.filter(r => !r.success).length;

    const summary: PromptMapSummary = {
        totalItems: results.length,
        successfulItems,
        failedItems,
        outputFields
    };

    // Handle AI reduce
    if (config.reduce.type === 'ai' && prompts.reducePrompt) {
        return await performAIReduce(
            results,
            summary,
            prompts.reducePrompt,
            config.reduce.output,
            config.reduce.model,
            reduceParameters,
            options,
            parentGroupId
        );
    }

    // Handle deterministic reduce
    const formattedOutput = formatResults(results, summary, config.reduce.type);

    return {
        results,
        formattedOutput,
        summary
    };
}

/**
 * Perform AI-powered reduce for batch mode
 */
async function performAIReduce(
    results: PromptMapResult[],
    summary: PromptMapSummary,
    reducePrompt: string,
    reduceOutput?: string[],
    reduceModel?: string,
    reduceParameters?: Record<string, string>,
    options?: ExecutePipelineOptions,
    parentGroupId?: string
): Promise<PromptMapOutput> {
    const isTextMode = !reduceOutput || reduceOutput.length === 0;

    // Register reduce process
    let reduceProcessId: string | undefined;
    if (options?.processTracker) {
        reduceProcessId = options.processTracker.registerProcess(
            'AI Reduce: Synthesizing results',
            parentGroupId
        );
    }

    // Build prompt with template substitution
    const successfulResults = results.filter(r => r.success);
    const resultsForPrompt = successfulResults.map(r => r.rawText !== undefined ? r.rawText : r.output);
    const resultsString = JSON.stringify(resultsForPrompt, null, 2);

    let prompt = reducePrompt
        .replace(/\{\{RESULTS\}\}/g, resultsString)
        .replace(/\{\{COUNT\}\}/g, String(summary.totalItems))
        .replace(/\{\{SUCCESS_COUNT\}\}/g, String(summary.successfulItems))
        .replace(/\{\{FAILURE_COUNT\}\}/g, String(summary.failedItems));

    // Substitute input parameters
    if (reduceParameters) {
        for (const [key, value] of Object.entries(reduceParameters)) {
            prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        }
    }

    // Add output instruction if not text mode
    if (!isTextMode) {
        prompt += `\n\nReturn JSON with these fields: ${reduceOutput!.join(', ')}`;
    }

    // Call AI
    const aiResult = await options?.aiInvoker(prompt, { model: reduceModel });

    if (!aiResult?.success || !aiResult.response) {
        if (options?.processTracker && reduceProcessId) {
            options.processTracker.updateProcess(
                reduceProcessId,
                'failed',
                undefined,
                aiResult?.error || 'Unknown error'
            );
        }
        throw new PipelineExecutionError(
            `AI reduce failed: ${aiResult?.error || 'Unknown error'}`,
            'reduce'
        );
    }

    // Text mode - return raw response
    if (isTextMode) {
        if (options?.processTracker && reduceProcessId) {
            options.processTracker.updateProcess(
                reduceProcessId,
                'completed',
                aiResult.response
            );
        }
        return {
            results,
            formattedOutput: aiResult.response,
            summary: { ...summary, outputFields: [] }
        };
    }

    // Parse structured response
    try {
        const jsonMatch = aiResult.response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('Response does not contain JSON object');
        }
        const parsed = JSON.parse(jsonMatch[0]);
        const formattedOutput = JSON.stringify(parsed, null, 2);

        if (options?.processTracker && reduceProcessId) {
            options.processTracker.updateProcess(
                reduceProcessId,
                'completed',
                formattedOutput,
                undefined,
                JSON.stringify(parsed)
            );
        }

        return {
            results,
            formattedOutput,
            summary: { ...summary, outputFields: reduceOutput! }
        };
    } catch (error) {
        if (options?.processTracker && reduceProcessId) {
            options.processTracker.updateProcess(
                reduceProcessId,
                'failed',
                undefined,
                error instanceof Error ? error.message : String(error)
            );
        }
        throw new PipelineExecutionError(
            `Failed to parse AI reduce response: ${error instanceof Error ? error.message : String(error)}`,
            'reduce'
        );
    }
}

/**
 * Format results based on reduce type
 */
export function formatResults(
    results: PromptMapResult[],
    summary: PromptMapSummary,
    reduceType: string
): string {
    switch (reduceType) {
        case 'table':
            return formatAsTable(results);
        case 'json':
            return formatAsJSON(results);
        case 'csv':
            return formatAsCSV(results);
        case 'text':
            return formatAsText(results);
        default:
            return formatAsList(results, summary);
    }
}

// Formatting utilities for batch mode reduce
function formatAsList(results: PromptMapResult[], summary: PromptMapSummary): string {
    const lines: string[] = [`## Results (${summary.totalItems} items)`, ''];
    if (summary.failedItems > 0) {
        lines.push(`**Warning: ${summary.failedItems} items failed**`, '');
    }

    results.forEach((r, i) => {
        lines.push(`### Item ${i + 1}`);
        const inputStr = Object.entries(r.item).map(([k, v]) => `${k}=${truncate(v, 30)}`).join(', ');
        lines.push(`**Input:** ${inputStr}`);
        if (r.success) {
            const outputStr = Object.entries(r.output).map(([k, v]) => `${k}=${formatValue(v)}`).join(', ');
            lines.push(`**Output:** ${outputStr}`);
        } else {
            lines.push(`**Error:** ${r.error || 'Unknown error'}`);
        }
        lines.push('');
    });

    lines.push('---', `**Stats:** ${summary.successfulItems} succeeded, ${summary.failedItems} failed`);
    return lines.join('\n');
}

function formatAsTable(results: PromptMapResult[]): string {
    if (results.length === 0) return 'No results to display.';

    const inKeys = [...new Set(results.flatMap(r => Object.keys(r.item)))];
    const outKeys = [...new Set(results.flatMap(r => Object.keys(r.output)))];
    const headers = ['#', ...inKeys.map(k => `[in] ${k}`), ...outKeys.map(k => `[out] ${k}`), 'Status'];

    const lines = [
        '| ' + headers.join(' | ') + ' |',
        '| ' + headers.map(() => '---').join(' | ') + ' |'
    ];

    results.forEach((r, i) => {
        const cells = [
            String(i + 1),
            ...inKeys.map(k => truncate(r.item[k] ?? '', 20)),
            ...outKeys.map(k => formatValue(r.output[k])),
            r.success ? 'OK' : 'FAIL'
        ];
        lines.push('| ' + cells.join(' | ') + ' |');
    });

    return lines.join('\n');
}

function formatAsJSON(results: PromptMapResult[]): string {
    return JSON.stringify(results.map(r => ({
        input: r.item,
        output: r.output,
        success: r.success,
        ...(r.error && { error: r.error })
    })), null, 2);
}

function formatAsCSV(results: PromptMapResult[]): string {
    if (results.length === 0) return '';

    const inKeys = [...new Set(results.flatMap(r => Object.keys(r.item)))];
    const outKeys = [...new Set(results.flatMap(r => Object.keys(r.output)))];
    const headers = [...inKeys, ...outKeys.map(k => `out_${k}`), 'success'];

    const lines = [headers.join(',')];
    for (const r of results) {
        const values = [
            ...inKeys.map(k => escapeCSV(r.item[k] ?? '')),
            ...outKeys.map(k => escapeCSV(formatValue(r.output[k]))),
            r.success ? 'true' : 'false'
        ];
        lines.push(values.join(','));
    }
    return lines.join('\n');
}

function formatAsText(results: PromptMapResult[]): string {
    const successfulResults = results.filter(r => r.success);
    if (successfulResults.length === 0) {
        return 'No successful results.';
    }

    if (successfulResults.length === 1) {
        const r = successfulResults[0];
        return r.rawText || JSON.stringify(r.output, null, 2);
    }

    return successfulResults
        .map((r, i) => {
            const text = r.rawText || JSON.stringify(r.output, null, 2);
            return `--- Item ${i + 1} ---\n${text}`;
        })
        .join('\n\n');
}

export function formatValue(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'string') return value.length > 50 ? value.substring(0, 47) + '...' : value;
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return String(value);
    if (Array.isArray(value)) return `[${value.length} items]`;
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

export function truncate(value: string, max: number = 30): string {
    return value.length <= max ? value : value.substring(0, max - 3) + '...';
}

export function escapeCSV(value: string): string {
    return (value.includes(',') || value.includes('"') || value.includes('\n'))
        ? `"${value.replace(/"/g, '""')}"`
        : value;
}
