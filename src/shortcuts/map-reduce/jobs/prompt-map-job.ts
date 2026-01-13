/**
 * Prompt Map Job
 *
 * Generic map-reduce job that applies a prompt template to a list of items.
 * Each item's fields are substituted into the template, sent to AI, and results collected.
 *
 * This is a core reusable job type - input sources (CSV, JSON, git, etc.) are handled
 * by the caller (e.g., yaml-pipeline module).
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    AIInvoker,
    MapContext,
    Mapper,
    MapReduceJob,
    MapResult,
    ReduceContext,
    ReduceResult,
    Splitter,
    WorkItem
} from '../types';
import { BaseReducer } from '../reducers';

/**
 * A generic item with string key-value pairs for template substitution
 */
export interface PromptItem {
    [key: string]: string;
}

/**
 * Input for the prompt map job
 */
export interface PromptMapInput {
    /** Items to process */
    items: PromptItem[];
    /** Prompt template with {{variable}} placeholders */
    promptTemplate: string;
    /** Expected output field names from AI */
    outputFields: string[];
}

/**
 * Work item data passed to the mapper
 */
export interface PromptWorkItemData {
    /** The item with template variables */
    item: PromptItem;
    /** Prompt template */
    promptTemplate: string;
    /** Expected output fields */
    outputFields: string[];
    /** Original index in input */
    index: number;
}

/**
 * Result from processing a single item (map output)
 */
export interface PromptMapResult {
    /** The original input item */
    item: PromptItem;
    /** The AI-generated output (with declared fields) */
    output: Record<string, unknown>;
    /** Whether processing succeeded */
    success: boolean;
    /** Error message if failed */
    error?: string;
    /** Raw AI response */
    rawResponse?: string;
}

/**
 * Output format for the reduce phase
 */
export type OutputFormat = 'list' | 'table' | 'json' | 'csv' | 'ai';

/**
 * Final aggregated output from reduce phase
 */
export interface PromptMapOutput {
    /** All processed results */
    results: PromptMapResult[];
    /** Formatted output string */
    formattedOutput: string;
    /** Summary statistics */
    summary: PromptMapSummary;
}

/**
 * Execution summary
 */
export interface PromptMapSummary {
    /** Total items processed */
    totalItems: number;
    /** Successfully processed items */
    successfulItems: number;
    /** Failed items */
    failedItems: number;
    /** Output field names */
    outputFields: string[];
}

/**
 * Options for creating a prompt map job
 */
export interface PromptMapJobOptions {
    /** AI invoker function */
    aiInvoker: AIInvoker;
    /** Output format (default: 'list') */
    outputFormat?: OutputFormat;
    /** Model to use */
    model?: string;
    /** Maximum concurrent AI calls */
    maxConcurrency?: number;
    /** AI reduce prompt template (required if outputFormat is 'ai') */
    aiReducePrompt?: string;
    /** AI reduce output fields (required if outputFormat is 'ai') */
    aiReduceOutput?: string[];
    /** Model to use for AI reduce (optional, defaults to job model) */
    aiReduceModel?: string;
}

// ============================================================================
// Template utilities
// ============================================================================

const TEMPLATE_VARIABLE_REGEX = /\{\{(\w+)\}\}/g;

function substituteTemplate(template: string, item: PromptItem): string {
    return template.replace(TEMPLATE_VARIABLE_REGEX, (_, variableName) => {
        return variableName in item ? item[variableName] : '';
    });
}

function buildFullPrompt(userPrompt: string, outputFields: string[]): string {
    if (outputFields.length === 0) {
        return userPrompt;
    }
    return `${userPrompt}

Return JSON with these fields: ${outputFields.join(', ')}`;
}

function extractJSON(response: string): string | null {
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) return codeBlockMatch[1].trim();

    const objectMatch = response.match(/\{[\s\S]*\}/);
    if (objectMatch) return objectMatch[0];

    const arrayMatch = response.match(/\[[\s\S]*\]/);
    if (arrayMatch) return arrayMatch[0];

    return null;
}

function parseAIResponse(response: string, outputFields: string[]): Record<string, unknown> {
    const jsonStr = extractJSON(response);
    if (!jsonStr) throw new Error('No JSON found in AI response');

    const parsed = JSON.parse(jsonStr);
    const result: Record<string, unknown> = {};
    for (const field of outputFields) {
        result[field] = field in parsed ? parsed[field] : null;
    }
    return result;
}

// ============================================================================
// Splitter
// ============================================================================

class PromptMapSplitter implements Splitter<PromptMapInput, PromptWorkItemData> {
    split(input: PromptMapInput): WorkItem<PromptWorkItemData>[] {
        return input.items.map((item, index) => ({
            id: `item-${index}`,
            data: {
                item,
                promptTemplate: input.promptTemplate,
                outputFields: input.outputFields,
                index
            },
            metadata: { index, totalItems: input.items.length }
        }));
    }
}

// ============================================================================
// Mapper
// ============================================================================

class PromptMapMapper implements Mapper<PromptWorkItemData, PromptMapResult> {
    constructor(
        private aiInvoker: AIInvoker,
        private model?: string
    ) {}

    async map(
        workItem: WorkItem<PromptWorkItemData>,
        _context: MapContext
    ): Promise<PromptMapResult> {
        const { item, promptTemplate, outputFields } = workItem.data;

        try {
            const substituted = substituteTemplate(promptTemplate, item);
            const prompt = buildFullPrompt(substituted, outputFields);
            const result = await this.aiInvoker(prompt, { model: this.model });

            if (result.success && result.response) {
                try {
                    const output = parseAIResponse(result.response, outputFields);
                    return { item, output, success: true, rawResponse: result.response };
                } catch (parseError) {
                    return {
                        item,
                        output: this.emptyOutput(outputFields),
                        success: false,
                        error: `Failed to parse AI response: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
                        rawResponse: result.response
                    };
                }
            }

            return {
                item,
                output: this.emptyOutput(outputFields),
                success: false,
                error: result.error || 'AI invocation failed',
                rawResponse: result.response
            };
        } catch (error) {
            return {
                item,
                output: this.emptyOutput(workItem.data.outputFields),
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    private emptyOutput(fields: string[]): Record<string, unknown> {
        const output: Record<string, unknown> = {};
        for (const field of fields) output[field] = null;
        return output;
    }
}

// ============================================================================
// Formatting utilities
// ============================================================================

function formatValue(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'string') return value.length > 50 ? value.substring(0, 47) + '...' : value;
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return String(value);
    if (Array.isArray(value)) return `[${value.length} items]`;
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function truncate(value: string, max: number = 30): string {
    return value.length <= max ? value : value.substring(0, max - 3) + '...';
}

function formatAsList(results: PromptMapResult[], summary: PromptMapSummary): string {
    const lines: string[] = [`## Results (${summary.totalItems} items)`, ''];
    if (summary.failedItems > 0) lines.push(`**Warning: ${summary.failedItems} items failed**`, '');

    results.forEach((r, i) => {
        lines.push(`### Item ${i + 1}`);
        lines.push(`**Input:** ${Object.entries(r.item).map(([k, v]) => `${k}=${truncate(v)}`).join(', ')}`);
        if (r.success) {
            lines.push(`**Output:** ${Object.entries(r.output).map(([k, v]) => `${k}=${formatValue(v)}`).join(', ')}`);
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

function escapeCSV(value: string): string {
    return (value.includes(',') || value.includes('"') || value.includes('\n'))
        ? `"${value.replace(/"/g, '""')}"`
        : value;
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

// ============================================================================
// Reducer
// ============================================================================

class PromptMapReducer extends BaseReducer<PromptMapResult, PromptMapOutput> {
    constructor(
        private outputFormat: OutputFormat = 'list',
        private outputFields: string[] = [],
        private aiInvoker?: AIInvoker,
        private aiReducePrompt?: string,
        private aiReduceOutput?: string[],
        private aiReduceModel?: string
    ) {
        super();
    }

    async reduce(
        results: MapResult<PromptMapResult>[],
        _context: ReduceContext
    ): Promise<ReduceResult<PromptMapOutput>> {
        const startTime = Date.now();

        const itemResults = results.filter(r => r.output).map(r => r.output!);
        const successfulItems = itemResults.filter(r => r.success).length;
        const failedItems = itemResults.filter(r => !r.success).length;

        const summary: PromptMapSummary = {
            totalItems: itemResults.length,
            successfulItems,
            failedItems,
            outputFields: this.outputFields
        };

        // Handle AI reduce
        if (this.outputFormat === 'ai') {
            return await this.performAIReduce(itemResults, summary, results.length, startTime);
        }

        // Handle deterministic reduce
        let formattedOutput: string;
        switch (this.outputFormat) {
            case 'table': formattedOutput = formatAsTable(itemResults); break;
            case 'json': formattedOutput = formatAsJSON(itemResults); break;
            case 'csv': formattedOutput = formatAsCSV(itemResults); break;
            default: formattedOutput = formatAsList(itemResults, summary);
        }

        return {
            output: { results: itemResults, formattedOutput, summary },
            stats: {
                inputCount: results.length,
                outputCount: itemResults.length,
                mergedCount: 0,
                reduceTimeMs: Date.now() - startTime,
                usedAIReduce: false
            }
        };
    }

    private async performAIReduce(
        itemResults: PromptMapResult[],
        summary: PromptMapSummary,
        inputCount: number,
        startTime: number
    ): Promise<ReduceResult<PromptMapOutput>> {
        if (!this.aiInvoker || !this.aiReducePrompt || !this.aiReduceOutput) {
            throw new Error('AI reduce requires aiInvoker, aiReducePrompt, and aiReduceOutput');
        }

        // Build prompt with template substitution
        const successfulResults = itemResults.filter(r => r.success);
        const resultsJSON = JSON.stringify(successfulResults.map(r => r.output), null, 2);
        
        const prompt = this.aiReducePrompt
            .replace(/\{\{results\}\}/g, resultsJSON)
            .replace(/\{\{count\}\}/g, String(summary.totalItems))
            .replace(/\{\{successCount\}\}/g, String(summary.successfulItems))
            .replace(/\{\{failureCount\}\}/g, String(summary.failedItems));

        const fullPrompt = buildFullPrompt(prompt, this.aiReduceOutput);

        // Call AI
        const aiResult = await this.aiInvoker(fullPrompt, { model: this.aiReduceModel });

        if (!aiResult.success || !aiResult.response) {
            throw new Error(`AI reduce failed: ${aiResult.error || 'Unknown error'}`);
        }

        // Parse AI response
        let aiOutput: Record<string, unknown>;
        try {
            aiOutput = parseAIResponse(aiResult.response, this.aiReduceOutput);
        } catch (parseError) {
            throw new Error(`Failed to parse AI reduce response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
        }

        // Format output as JSON string
        const formattedOutput = JSON.stringify(aiOutput, null, 2);

        return {
            output: {
                results: itemResults,
                formattedOutput,
                summary: {
                    ...summary,
                    outputFields: this.aiReduceOutput
                }
            },
            stats: {
                inputCount,
                outputCount: 1, // AI reduce produces single synthesized output
                mergedCount: summary.successfulItems,
                reduceTimeMs: Date.now() - startTime,
                usedAIReduce: true
            }
        };
    }
}

// ============================================================================
// Factory functions
// ============================================================================

/**
 * Create a prompt map job
 */
export function createPromptMapJob(
    options: PromptMapJobOptions
): MapReduceJob<PromptMapInput, PromptWorkItemData, PromptMapResult, PromptMapOutput> {
    return {
        id: 'prompt-map',
        name: 'Prompt Map',
        splitter: new PromptMapSplitter(),
        mapper: new PromptMapMapper(options.aiInvoker, options.model),
        reducer: new PromptMapReducer(
            options.outputFormat || 'list',
            [],
            options.aiInvoker,
            options.aiReducePrompt,
            options.aiReduceOutput,
            options.aiReduceModel
        ),
        options: {
            maxConcurrency: options.maxConcurrency || 5,
            reduceMode: 'deterministic',
            showProgress: true,
            retryOnFailure: false
        }
    };
}

/**
 * Helper to create job input
 */
export function createPromptMapInput(
    items: PromptItem[],
    promptTemplate: string,
    outputFields: string[]
): PromptMapInput {
    return { items, promptTemplate, outputFields };
}
