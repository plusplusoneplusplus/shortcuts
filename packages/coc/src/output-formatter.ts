/**
 * Output Formatter
 *
 * Formats pipeline execution results for different output targets:
 * table, json, csv, markdown.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { FlatWorkflowResult } from '@plusplusoneplusplus/pipeline-core';
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
    result: FlatWorkflowResult,
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

function formatJSON(result: FlatWorkflowResult): string {
    const output = extractOutputData(result);
    return JSON.stringify(output, null, 2);
}

// ============================================================================
// CSV Format
// ============================================================================

function formatCSV(result: FlatWorkflowResult): string {
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

function formatMarkdown(result: FlatWorkflowResult): string {
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

function formatTable(result: FlatWorkflowResult): string {
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
export function formatSummary(result: FlatWorkflowResult): string {
    const stats = result.stats;
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

    const elapsed = stats.totalDurationMs;
    lines.push(`  Duration:    ${formatDuration(elapsed)}`);

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
function extractOutputData(result: FlatWorkflowResult): unknown {
    if (result.leafOutput && result.leafOutput.length > 0) {
        return result.leafOutput;
    }
    return extractRows(result);
}

/**
 * Extract row data from pipeline results
 */
function extractRows(result: FlatWorkflowResult): Record<string, unknown>[] {
    return result.items
        .filter(item => item.success && item.output && typeof item.output === 'object')
        .map(item => item.output as Record<string, unknown>);
}
