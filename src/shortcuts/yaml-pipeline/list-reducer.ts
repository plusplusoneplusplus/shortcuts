/**
 * List Reducer
 *
 * Formats pipeline results as a readable markdown list.
 * No AI calls - deterministic formatting.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { PipelineItem, PipelineMapResult, PipelineStats } from './types';

/**
 * Options for list formatting
 */
export interface ListFormatOptions {
    /** Show item numbers (default: true) */
    showNumbers?: boolean;
    /** Show input values (default: true) */
    showInput?: boolean;
    /** Show output values (default: true) */
    showOutput?: boolean;
    /** Show errors for failed items (default: true) */
    showErrors?: boolean;
    /** Maximum items to show (default: all) */
    maxItems?: number;
    /** Format for input/output display */
    format?: 'compact' | 'verbose';
}

/**
 * Default list formatting options
 */
export const DEFAULT_LIST_FORMAT_OPTIONS: Required<ListFormatOptions> = {
    showNumbers: true,
    showInput: true,
    showOutput: true,
    showErrors: true,
    maxItems: Number.MAX_SAFE_INTEGER,
    format: 'compact'
};

/**
 * Format pipeline results as a markdown list
 * @param results Array of map results
 * @param stats Execution statistics
 * @param options Formatting options
 * @returns Formatted markdown string
 */
export function formatResultsAsList(
    results: PipelineMapResult[],
    stats: PipelineStats,
    options?: ListFormatOptions
): string {
    const opts = { ...DEFAULT_LIST_FORMAT_OPTIONS, ...options };
    const lines: string[] = [];

    // Header with summary
    lines.push(`## Results (${stats.totalItems} items)`);
    lines.push('');

    if (stats.failedItems > 0) {
        lines.push(`**⚠️ ${stats.failedItems} items failed**`);
        lines.push('');
    }

    // Limit results if needed
    const displayResults = results.slice(0, opts.maxItems);
    const truncated = results.length > opts.maxItems;

    // Format each result
    displayResults.forEach((result, index) => {
        const itemNum = index + 1;

        if (opts.showNumbers) {
            lines.push(`### Item ${itemNum}`);
        } else {
            lines.push(`### Item`);
        }

        if (opts.showInput) {
            const inputStr = formatItem(result.item, opts.format);
            lines.push(`**Input:** ${inputStr}`);
        }

        if (result.success) {
            if (opts.showOutput) {
                const outputStr = formatOutput(result.output, opts.format);
                lines.push(`**Output:** ${outputStr}`);
            }
        } else {
            if (opts.showErrors) {
                lines.push(`**Error:** ${result.error || 'Unknown error'}`);
            }
        }

        lines.push('');
    });

    // Show truncation notice
    if (truncated) {
        lines.push(`*... and ${results.length - opts.maxItems} more items*`);
        lines.push('');
    }

    // Footer with stats
    lines.push('---');
    lines.push(`**Stats:** ${stats.successfulItems} succeeded, ${stats.failedItems} failed, ${stats.totalTimeMs}ms total`);

    return lines.join('\n');
}

/**
 * Format a pipeline item (input) for display
 * @param item Pipeline item
 * @param format Display format
 * @returns Formatted string
 */
export function formatItem(item: PipelineItem, format: 'compact' | 'verbose' = 'compact'): string {
    const entries = Object.entries(item);

    if (format === 'verbose') {
        return entries
            .map(([key, value]) => `  - ${key}: ${truncateValue(value)}`)
            .join('\n');
    }

    // Compact format
    return entries
        .map(([key, value]) => `${key}=${truncateValue(value, 30)}`)
        .join(', ');
}

/**
 * Format output for display
 * @param output Output object from AI
 * @param format Display format
 * @returns Formatted string
 */
export function formatOutput(
    output: Record<string, unknown>,
    format: 'compact' | 'verbose' = 'compact'
): string {
    const entries = Object.entries(output);

    if (format === 'verbose') {
        return entries
            .map(([key, value]) => `  - ${key}: ${formatValue(value)}`)
            .join('\n');
    }

    // Compact format
    return entries
        .map(([key, value]) => `${key}=${formatValue(value)}`)
        .join(', ');
}

/**
 * Format a single value for display
 * @param value Value to format
 * @returns Formatted string
 */
export function formatValue(value: unknown): string {
    if (value === null || value === undefined) {
        return 'null';
    }

    if (typeof value === 'string') {
        return truncateValue(value, 50);
    }

    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }

    if (typeof value === 'number') {
        return String(value);
    }

    if (Array.isArray(value)) {
        return `[${value.length} items]`;
    }

    if (typeof value === 'object') {
        return JSON.stringify(value);
    }

    return String(value);
}

/**
 * Truncate a value for display
 * @param value Value to truncate
 * @param maxLength Maximum length
 * @returns Truncated string
 */
export function truncateValue(value: string, maxLength: number = 50): string {
    if (value.length <= maxLength) {
        return value;
    }
    return value.substring(0, maxLength - 3) + '...';
}

/**
 * Generate a summary table from results
 * @param results Pipeline results
 * @returns Markdown table string
 */
export function formatResultsAsTable(
    results: PipelineMapResult[],
    options?: { maxRows?: number }
): string {
    const maxRows = options?.maxRows ?? results.length;
    const displayResults = results.slice(0, maxRows);

    if (displayResults.length === 0) {
        return 'No results to display.';
    }

    // Get all unique input and output keys
    const inputKeys = new Set<string>();
    const outputKeys = new Set<string>();

    for (const result of displayResults) {
        Object.keys(result.item).forEach(k => inputKeys.add(k));
        Object.keys(result.output).forEach(k => outputKeys.add(k));
    }

    const inputKeyArr = Array.from(inputKeys);
    const outputKeyArr = Array.from(outputKeys);

    // Build table header
    const headers = ['#', ...inputKeyArr.map(k => `[in] ${k}`), ...outputKeyArr.map(k => `[out] ${k}`), 'Status'];
    const separator = headers.map(() => '---');

    const lines: string[] = [
        '| ' + headers.join(' | ') + ' |',
        '| ' + separator.join(' | ') + ' |'
    ];

    // Build table rows
    displayResults.forEach((result, index) => {
        const cells = [
            String(index + 1),
            ...inputKeyArr.map(k => truncateValue(result.item[k] ?? '', 20)),
            ...outputKeyArr.map(k => formatValue(result.output[k])),
            result.success ? '✓' : '✗'
        ];
        lines.push('| ' + cells.join(' | ') + ' |');
    });

    if (results.length > maxRows) {
        lines.push(`\n*... and ${results.length - maxRows} more rows*`);
    }

    return lines.join('\n');
}

/**
 * Generate a JSON output from results
 * @param results Pipeline results
 * @returns JSON string
 */
export function formatResultsAsJSON(results: PipelineMapResult[]): string {
    const output = results.map(r => ({
        input: r.item,
        output: r.output,
        success: r.success,
        ...(r.error && { error: r.error })
    }));

    return JSON.stringify(output, null, 2);
}

/**
 * Generate a CSV output from results
 * @param results Pipeline results
 * @returns CSV string
 */
export function formatResultsAsCSV(results: PipelineMapResult[]): string {
    if (results.length === 0) {
        return '';
    }

    // Get all unique input and output keys
    const inputKeys = new Set<string>();
    const outputKeys = new Set<string>();

    for (const result of results) {
        Object.keys(result.item).forEach(k => inputKeys.add(k));
        Object.keys(result.output).forEach(k => outputKeys.add(k));
    }

    const inputKeyArr = Array.from(inputKeys);
    const outputKeyArr = Array.from(outputKeys);

    // Build header row
    const headers = [...inputKeyArr, ...outputKeyArr.map(k => `out_${k}`), 'success'];
    const lines: string[] = [headers.join(',')];

    // Build data rows
    for (const result of results) {
        const values = [
            ...inputKeyArr.map(k => escapeCSVValue(result.item[k] ?? '')),
            ...outputKeyArr.map(k => escapeCSVValue(formatValue(result.output[k]))),
            result.success ? 'true' : 'false'
        ];
        lines.push(values.join(','));
    }

    return lines.join('\n');
}

/**
 * Escape a value for CSV output
 * @param value Value to escape
 * @returns Escaped string
 */
function escapeCSVValue(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}
