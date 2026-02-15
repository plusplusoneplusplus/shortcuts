/**
 * Output Formatter
 *
 * Formats pipeline execution results for different output targets:
 * table, json, csv, markdown.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { PipelineExecutionResult, PromptMapOutput, PromptMapResult } from '@plusplusoneplusplus/pipeline-core';
import { bold, dim, green, red, yellow, gray } from './logger';

// ============================================================================
// Types
// ============================================================================

export type OutputFormat = 'table' | 'json' | 'csv' | 'markdown';

// ============================================================================
// Main Formatter
// ============================================================================

/**
 * Format pipeline results according to the specified format
 */
export function formatResults(
    result: PipelineExecutionResult,
    format: OutputFormat
): string {
    switch (format) {
        case 'json':
            return formatJSON(result);
        case 'csv':
            return formatCSV(result);
        case 'markdown':
            return formatMarkdown(result);
        case 'table':
        default:
            return formatTable(result);
    }
}

// ============================================================================
// JSON Format
// ============================================================================

function formatJSON(result: PipelineExecutionResult): string {
    const output = extractOutputData(result);
    return JSON.stringify(output, null, 2);
}

// ============================================================================
// CSV Format
// ============================================================================

function formatCSV(result: PipelineExecutionResult): string {
    const rows = extractRows(result);
    if (rows.length === 0) {
        return '';
    }

    const headers = Object.keys(rows[0]);
    const lines: string[] = [
        headers.map(escapeCSVField).join(','),
    ];

    for (const row of rows) {
        const values = headers.map(h => escapeCSVField(String(row[h] ?? '')));
        lines.push(values.join(','));
    }

    return lines.join('\n');
}

function escapeCSVField(field: string): string {
    if (field.includes(',') || field.includes('"') || field.includes('\n')) {
        return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
}

// ============================================================================
// Markdown Format
// ============================================================================

function formatMarkdown(result: PipelineExecutionResult): string {
    const rows = extractRows(result);
    if (rows.length === 0) {
        return '_No results_\n';
    }

    const headers = Object.keys(rows[0]);
    const lines: string[] = [];

    // Header row
    lines.push('| ' + headers.join(' | ') + ' |');
    // Separator
    lines.push('| ' + headers.map(() => '---').join(' | ') + ' |');
    // Data rows
    for (const row of rows) {
        const values = headers.map(h => String(row[h] ?? '').replace(/\|/g, '\\|'));
        lines.push('| ' + values.join(' | ') + ' |');
    }

    return lines.join('\n');
}

// ============================================================================
// Table Format
// ============================================================================

function formatTable(result: PipelineExecutionResult): string {
    const rows = extractRows(result);
    if (rows.length === 0) {
        return dim('  No results') + '\n';
    }

    const headers = Object.keys(rows[0]);
    
    // Calculate column widths
    const widths = new Map<string, number>();
    for (const header of headers) {
        widths.set(header, header.length);
    }
    for (const row of rows) {
        for (const header of headers) {
            const val = truncate(String(row[header] ?? ''), 60);
            const current = widths.get(header) || 0;
            widths.set(header, Math.max(current, val.length));
        }
    }

    const lines: string[] = [];

    // Header row
    const headerLine = headers.map(h => bold(padRight(h.toUpperCase(), widths.get(h) || h.length))).join('  ');
    lines.push('  ' + headerLine);

    // Separator
    const sepLine = headers.map(h => '─'.repeat(widths.get(h) || h.length)).join('──');
    lines.push('  ' + gray(sepLine));

    // Data rows
    for (const row of rows) {
        const values = headers.map(h => {
            const val = truncate(String(row[h] ?? ''), 60);
            return padRight(val, widths.get(h) || val.length);
        });
        lines.push('  ' + values.join('  '));
    }

    return lines.join('\n');
}

function padRight(str: string, width: number): string {
    if (str.length >= width) { return str; }
    return str + ' '.repeat(width - str.length);
}

function truncate(str: string, maxLen: number): string {
    // Replace newlines with spaces for table display
    const singleLine = str.replace(/\n/g, ' ');
    if (singleLine.length <= maxLen) { return singleLine; }
    return singleLine.substring(0, maxLen - 3) + '...';
}

// ============================================================================
// Summary Formatting
// ============================================================================

/**
 * Format an execution summary for display
 */
export function formatSummary(result: PipelineExecutionResult): string {
    const stats = result.executionStats;
    const lines: string[] = [];

    lines.push('');
    lines.push(bold('Summary'));

    const total = stats.totalItems;
    const successCount = stats.successfulMaps;
    const failureCount = stats.failedMaps;
    const successRate = total > 0 ? Math.round((successCount / total) * 100) : 0;

    lines.push(`  Total items: ${total}`);
    lines.push(`  Successful:  ${green(String(successCount))}`);

    if (failureCount > 0) {
        lines.push(`  Failed:      ${red(String(failureCount))}`);
    }

    lines.push(`  Success rate: ${successRate === 100 ? green(`${successRate}%`) : successRate >= 80 ? yellow(`${successRate}%`) : red(`${successRate}%`)}`);

    const elapsed = result.totalTimeMs;
    lines.push(`  Duration:    ${formatDuration(elapsed)}`);

    if (result.filterResult) {
        const filter = result.filterResult;
        lines.push('');
        lines.push(`  Filter: ${filter.stats.filterType} (${filter.stats.includedCount} included, ${filter.stats.excludedCount} excluded)`);
    }

    return lines.join('\n');
}

/**
 * Format a duration in milliseconds to a human-readable string
 */
export function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    if (ms < 60000) {
        return `${(ms / 1000).toFixed(1)}s`;
    }
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
}

// ============================================================================
// Data Extraction Helpers
// ============================================================================

/**
 * Extract structured output data from pipeline results
 */
function extractOutputData(result: PipelineExecutionResult): unknown {
    // If there's a reduce output, use its results
    if (result.output) {
        const pipelineOutput = result.output as PromptMapOutput;
        if (pipelineOutput.results) {
            return pipelineOutput.results.map(r => r.output);
        }
        return pipelineOutput;
    }

    // Otherwise collect map results
    return extractRows(result);
}

/**
 * Extract row data from pipeline map results
 */
function extractRows(result: PipelineExecutionResult): Record<string, unknown>[] {
    // If reduce output has results, use them
    if (result.output) {
        const pipelineOutput = result.output as PromptMapOutput;
        if (pipelineOutput.results && Array.isArray(pipelineOutput.results)) {
            return pipelineOutput.results
                .filter((r: PromptMapResult) => r.success)
                .map((r: PromptMapResult) => r.output);
        }
    }

    // Fall back to map results
    const rows: Record<string, unknown>[] = [];
    for (const mapResult of result.mapResults) {
        if (mapResult.success && mapResult.output) {
            const promptResult = mapResult.output as PromptMapResult;
            if (promptResult.output && typeof promptResult.output === 'object') {
                rows.push(promptResult.output);
            }
        }
    }

    return rows;
}
