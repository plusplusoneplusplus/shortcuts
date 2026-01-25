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
import { 
    extractJSON as sharedExtractJSON, 
    parseAIResponse as sharedParseAIResponse 
} from '../../shared/ai-response-parser';
import { writeTempFile, TempFileResult } from '../temp-file-utils';

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
    /** All items in the input (for {{ITEMS}} template variable) */
    allItems: PromptItem[];
}

/**
 * Result from processing a single item (map output)
 */
export interface PromptMapResult {
    /** The original input item */
    item: PromptItem;
    /** The AI-generated output (with declared fields) - empty object in text mode */
    output: Record<string, unknown>;
    /** Raw text output when in text mode (no output fields specified) */
    rawText?: string;
    /** Whether processing succeeded */
    success: boolean;
    /** Error message if failed */
    error?: string;
    /** Raw AI response */
    rawResponse?: string;
    /** SDK session ID for session resume functionality */
    sessionId?: string;
}

/**
 * Output format for the reduce phase
 * - 'list': Markdown formatted list
 * - 'table': Markdown table
 * - 'json': JSON array of results
 * - 'csv': CSV format
 * - 'ai': AI-powered synthesis of results
 * - 'text': Pure text concatenation (for non-structured AI responses)
 */
export type OutputFormat = 'list' | 'table' | 'json' | 'csv' | 'ai' | 'text';

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
    /** Parameters for AI reduce prompt substitution (from input.parameters) */
    aiReduceParameters?: Record<string, string>;
}

// ============================================================================
// Template utilities
// ============================================================================

const TEMPLATE_VARIABLE_REGEX = /\{\{(\w+)\}\}/g;

/**
 * Substitute template variables with values from a pipeline item
 * 
 * Supports special variable {{ITEMS}} which is replaced with JSON array of all items.
 * This allows prompts to reference the full context of all items being processed.
 * 
 * @param template Template string with {{variable}} placeholders
 * @param item Current pipeline item containing values
 * @param allItems Optional array of all items (for {{ITEMS}} variable)
 * @returns Substituted string
 */
function substituteTemplate(template: string, item: PromptItem, allItems?: PromptItem[]): string {
    return template.replace(TEMPLATE_VARIABLE_REGEX, (_, variableName) => {
        // Handle special {{ITEMS}} variable - returns JSON array of all items
        if (variableName === 'ITEMS' && allItems) {
            return JSON.stringify(allItems, null, 2);
        }
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

/**
 * Extract JSON from response - delegates to shared utility
 */
function extractJSON(response: string): string | null {
    return sharedExtractJSON(response);
}

/**
 * Parse AI response - delegates to shared utility
 */
function parseAIResponse(response: string, outputFields: string[]): Record<string, unknown> {
    return sharedParseAIResponse(response, outputFields);
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
                index,
                allItems: input.items
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
        private modelTemplate?: string
    ) {}

    async map(
        workItem: WorkItem<PromptWorkItemData>,
        _context: MapContext
    ): Promise<PromptMapResult> {
        const { item, promptTemplate, outputFields, allItems } = workItem.data;
        const isTextMode = !outputFields || outputFields.length === 0;

        try {
            const substituted = substituteTemplate(promptTemplate, item, allItems);
            const prompt = buildFullPrompt(substituted, outputFields);
            
            // Support template substitution in model (e.g., "{{model}}" reads from item.model)
            // Ensure modelTemplate is a string before substitution
            let model: string | undefined;
            if (this.modelTemplate && typeof this.modelTemplate === 'string') {
                const substitutedModel = substituteTemplate(this.modelTemplate, item, allItems);
                model = substitutedModel || undefined;
            }
            
            const result = await this.aiInvoker(prompt, { model });

            if (result.success && result.response) {
                // Text mode - return raw response without JSON parsing
                if (isTextMode) {
                    return {
                        item,
                        output: {},
                        rawText: result.response,
                        success: true,
                        rawResponse: result.response,
                        sessionId: result.sessionId
                    };
                }

                // Structured mode - parse JSON response
                try {
                    const output = parseAIResponse(result.response, outputFields);
                    return { item, output, success: true, rawResponse: result.response, sessionId: result.sessionId };
                } catch (parseError) {
                    return {
                        item,
                        output: this.emptyOutput(outputFields),
                        success: false,
                        error: `Failed to parse AI response: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
                        rawResponse: result.response,
                        sessionId: result.sessionId
                    };
                }
            }

            return {
                item,
                output: isTextMode ? {} : this.emptyOutput(outputFields),
                success: false,
                error: result.error || 'AI invocation failed',
                rawResponse: result.response,
                sessionId: result.sessionId
            };
        } catch (error) {
            return {
                item,
                output: isTextMode ? {} : this.emptyOutput(workItem.data.outputFields),
                success: false,
                error: error instanceof Error ? error.message : String(error),
                rawResponse: undefined // No AI response available when exception occurs before AI call
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

/**
 * Format results as pure text - concatenates rawText or stringified output
 * Used for text mode where AI responses are not structured JSON
 */
function formatAsText(results: PromptMapResult[]): string {
    const successfulResults = results.filter(r => r.success);
    if (successfulResults.length === 0) {
        return 'No successful results.';
    }

    // For single result, return just the text without separators
    if (successfulResults.length === 1) {
        const r = successfulResults[0];
        return r.rawText || JSON.stringify(r.output, null, 2);
    }

    // For multiple results, add separators
    return successfulResults
        .map((r, i) => {
            const text = r.rawText || JSON.stringify(r.output, null, 2);
            return `--- Item ${i + 1} ---\n${text}`;
        })
        .join('\n\n');
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
        private aiReduceModel?: string,
        private aiReduceParameters?: Record<string, string>
    ) {
        super();
    }

    async reduce(
        results: MapResult<PromptMapResult>[],
        context: ReduceContext
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
            return await this.performAIReduce(itemResults, summary, results.length, startTime, context);
        }

        // Handle deterministic reduce
        let formattedOutput: string;
        switch (this.outputFormat) {
            case 'table': formattedOutput = formatAsTable(itemResults); break;
            case 'json': formattedOutput = formatAsJSON(itemResults); break;
            case 'csv': formattedOutput = formatAsCSV(itemResults); break;
            case 'text': formattedOutput = formatAsText(itemResults); break;
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
        startTime: number,
        context: ReduceContext
    ): Promise<ReduceResult<PromptMapOutput>> {
        if (!this.aiInvoker || !this.aiReducePrompt) {
            throw new Error('AI reduce requires aiInvoker and aiReducePrompt');
        }

        const isTextMode = !this.aiReduceOutput || this.aiReduceOutput.length === 0;

        // Register reduce process for tracking
        // Note: parentGroupId may be undefined for single-item pipelines, but we still track the process
        let reduceProcessId: string | undefined;
        if (context.processTracker) {
            reduceProcessId = context.processTracker.registerProcess(
                'AI Reduce: Synthesizing results',
                context.parentGroupId
            );
        }

        // Build prompt with template substitution
        const successfulResults = itemResults.filter(r => r.success);

        // For text mode map results, use rawText; otherwise use structured output
        const resultsForPrompt = successfulResults.map(r => {
            if (r.rawText !== undefined) {
                return r.rawText;
            }
            return r.output;
        });
        const resultsString = JSON.stringify(resultsForPrompt, null, 2);

        // Check if prompt uses {{RESULTS_FILE}} - if so, write to temp file
        // This avoids shell escaping issues on Windows where newlines in JSON
        // get converted to literal \n, breaking JSON structure
        let tempFileResult: TempFileResult | undefined;
        let prompt = this.aiReducePrompt;

        if (prompt.includes('{{RESULTS_FILE}}')) {
            tempFileResult = writeTempFile(resultsString, 'ai-reduce-results', '.json');
            if (tempFileResult) {
                prompt = prompt.replace(/\{\{RESULTS_FILE\}\}/g, tempFileResult.filePath);
            } else {
                // Fallback to inline if temp file creation fails
                console.warn('Failed to create temp file for RESULTS_FILE, falling back to inline RESULTS');
                prompt = prompt.replace(/\{\{RESULTS_FILE\}\}/g, resultsString);
            }
        }

        // Replace {{RESULTS}} with inline JSON (original behavior)
        prompt = prompt
            .replace(/\{\{RESULTS\}\}/g, resultsString)
            .replace(/\{\{COUNT\}\}/g, String(summary.totalItems))
            .replace(/\{\{SUCCESS_COUNT\}\}/g, String(summary.successfulItems))
            .replace(/\{\{FAILURE_COUNT\}\}/g, String(summary.failedItems));

        // Substitute input parameters
        if (this.aiReduceParameters) {
            for (const [key, value] of Object.entries(this.aiReduceParameters)) {
                prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
            }
        }

        // In text mode, don't append JSON format instruction
        const fullPrompt = isTextMode ? prompt : buildFullPrompt(prompt, this.aiReduceOutput!);

        // Call AI and ensure temp file cleanup
        let aiResult;
        try {
            aiResult = await this.aiInvoker(fullPrompt, { model: this.aiReduceModel });
        } finally {
            // Always cleanup temp file after AI call completes
            if (tempFileResult) {
                tempFileResult.cleanup();
            }
        }

        if (!aiResult.success || !aiResult.response) {
            // Update process as failed
            if (context.processTracker && reduceProcessId) {
                context.processTracker.updateProcess(
                    reduceProcessId,
                    'failed',
                    undefined,
                    aiResult.error || 'Unknown error'
                );
            }
            throw new Error(`AI reduce failed: ${aiResult.error || 'Unknown error'}`);
        }

        // Text mode - return raw AI response without JSON parsing
        if (isTextMode) {
            // Update process as completed
            if (context.processTracker && reduceProcessId) {
                context.processTracker.updateProcess(
                    reduceProcessId,
                    'completed',
                    aiResult.response,
                    undefined,
                    JSON.stringify({ mode: 'text', outputLength: aiResult.response.length })
                );
            }
            return {
                output: {
                    results: itemResults,
                    formattedOutput: aiResult.response,
                    summary: {
                        ...summary,
                        outputFields: []
                    }
                },
                stats: {
                    inputCount,
                    outputCount: 1,
                    mergedCount: summary.successfulItems,
                    reduceTimeMs: Date.now() - startTime,
                    usedAIReduce: true
                }
            };
        }

        // Structured mode - parse AI response as JSON
        let aiOutput: Record<string, unknown>;
        try {
            aiOutput = parseAIResponse(aiResult.response, this.aiReduceOutput!);
        } catch (parseError) {
            // Update process as failed
            if (context.processTracker && reduceProcessId) {
                context.processTracker.updateProcess(
                    reduceProcessId,
                    'failed',
                    undefined,
                    parseError instanceof Error ? parseError.message : String(parseError)
                );
            }
            throw new Error(`Failed to parse AI reduce response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
        }

        // Format output as JSON string
        const formattedOutput = JSON.stringify(aiOutput, null, 2);

        // Update process as completed
        if (context.processTracker && reduceProcessId) {
            context.processTracker.updateProcess(
                reduceProcessId,
                'completed',
                formattedOutput,
                undefined,
                JSON.stringify(aiOutput)
            );
        }

        return {
            output: {
                results: itemResults,
                formattedOutput,
                summary: {
                    ...summary,
                    outputFields: this.aiReduceOutput!
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
            options.aiReduceModel,
            options.aiReduceParameters
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
