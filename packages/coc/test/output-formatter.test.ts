/**
 * Output Formatter Tests
 *
 * Tests for formatting pipeline results in table, json, csv, markdown.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    formatResults,
    formatSummary,
    formatDuration,
} from '../src/output-formatter';
import type { OutputFormat } from '../src/output-formatter';
import { setColorEnabled } from '../src/logger';
import type { FlatWorkflowResult } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Test Helpers
// ============================================================================

function createMockResult(overrides?: Partial<FlatWorkflowResult>): FlatWorkflowResult {
    return {
        success: true,
        items: [
            {
                index: 0,
                input: { name: 'Item 1', category: 'A' },
                output: { severity: 'high', category: 'bug' },
                success: true,
                executionTimeMs: 100,
            },
            {
                index: 1,
                input: { name: 'Item 2', category: 'B' },
                output: { severity: 'low', category: 'feature' },
                success: true,
                executionTimeMs: 200,
            },
        ],
        leafOutput: [],
        stats: {
            totalItems: 2,
            successfulMaps: 2,
            failedMaps: 0,
            totalDurationMs: 500,
            mapDurationMs: 300,
            reduceDurationMs: 50,
        },
        ...overrides,
    };
}

function createEmptyResult(): FlatWorkflowResult {
    return {
        success: true,
        items: [],
        leafOutput: [],
        stats: {
            totalItems: 0,
            successfulMaps: 0,
            failedMaps: 0,
            totalDurationMs: 10,
            mapDurationMs: 5,
            reduceDurationMs: 5,
        },
    };
}

function createResultWithReduceOutput(): FlatWorkflowResult {
    return {
        success: true,
        items: [
            { index: 0, input: {}, output: { name: 'Alice', role: 'dev' }, success: true },
            { index: 1, input: {}, output: { name: 'Bob', role: 'pm' }, success: true },
        ],
        leafOutput: [
            { name: 'Alice', role: 'dev' },
            { name: 'Bob', role: 'pm' },
        ],
        stats: {
            totalItems: 2,
            successfulMaps: 2,
            failedMaps: 0,
            totalDurationMs: 300,
            mapDurationMs: 250,
            reduceDurationMs: 50,
        },
    };
}

describe('Output Formatter', () => {
    beforeEach(() => {
        setColorEnabled(false); // Disable colors for test assertions
    });

    afterEach(() => {
        setColorEnabled(true);
    });

    // ========================================================================
    // JSON Format
    // ========================================================================

    describe('JSON format', () => {
        it('should format results as JSON', () => {
            const result = createMockResult();
            const output = formatResults(result, 'json');
            const parsed = JSON.parse(output);
            expect(Array.isArray(parsed)).toBe(true);
        });

        it('should format empty results as JSON', () => {
            const result = createEmptyResult();
            const output = formatResults(result, 'json');
            const parsed = JSON.parse(output);
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed.length).toBe(0);
        });

        it('should use reduce output when available', () => {
            const result = createResultWithReduceOutput();
            const output = formatResults(result, 'json');
            const parsed = JSON.parse(output);
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed.length).toBe(2);
        });

        it('should produce valid JSON', () => {
            const result = createMockResult();
            const output = formatResults(result, 'json');
            expect(() => JSON.parse(output)).not.toThrow();
        });
    });

    // ========================================================================
    // CSV Format
    // ========================================================================

    describe('CSV format', () => {
        it('should format results as CSV with headers', () => {
            const result = createResultWithReduceOutput();
            const output = formatResults(result, 'csv');
            const lines = output.split('\n');
            expect(lines.length).toBe(3); // header + 2 data rows
            expect(lines[0]).toBe('name,role');
            expect(lines[1]).toBe('Alice,dev');
            expect(lines[2]).toBe('Bob,pm');
        });

        it('should escape CSV fields with commas', () => {
            const result = createResultWithReduceOutput();
            result.items[0].output = { name: 'Alice, Jr.', role: 'dev' };
            const output = formatResults(result, 'csv');
            expect(output).toContain('"Alice, Jr."');
        });

        it('should escape CSV fields with quotes', () => {
            const result = createResultWithReduceOutput();
            result.items[0].output = { name: 'Alice "the great"', role: 'dev' };
            const output = formatResults(result, 'csv');
            expect(output).toContain('"Alice ""the great"""');
        });

        it('should return empty string for no results', () => {
            const result = createEmptyResult();
            const output = formatResults(result, 'csv');
            expect(output).toBe('');
        });
    });

    // ========================================================================
    // Markdown Format
    // ========================================================================

    describe('Markdown format', () => {
        it('should format results as markdown table', () => {
            const result = createResultWithReduceOutput();
            const output = formatResults(result, 'markdown');
            const lines = output.split('\n');
            expect(lines.length).toBe(4); // header + separator + 2 data rows
            expect(lines[0]).toContain('| name |');
            expect(lines[0]).toContain('| role |');
            expect(lines[1]).toContain('---');
            expect(lines[2]).toContain('Alice');
        });

        it('should escape pipe characters in values', () => {
            const result = createResultWithReduceOutput();
            result.items[0].output = { name: 'Alice|Bob', role: 'dev' };
            const output = formatResults(result, 'markdown');
            expect(output).toContain('Alice\\|Bob');
        });

        it('should show no results message for empty results', () => {
            const result = createEmptyResult();
            const output = formatResults(result, 'markdown');
            expect(output).toContain('No results');
        });
    });

    // ========================================================================
    // Table Format
    // ========================================================================

    describe('Table format', () => {
        it('should format results as table', () => {
            const result = createResultWithReduceOutput();
            const output = formatResults(result, 'table');
            expect(output).toContain('NAME');
            expect(output).toContain('ROLE');
            expect(output).toContain('Alice');
            expect(output).toContain('Bob');
        });

        it('should show no results message for empty results', () => {
            const result = createEmptyResult();
            const output = formatResults(result, 'table');
            expect(output).toContain('No results');
        });

        it('should truncate long values', () => {
            const result = createResultWithReduceOutput();
            result.items[0].output = { name: 'A'.repeat(100), role: 'dev' };
            const output = formatResults(result, 'table');
            expect(output).toContain('...');
        });

        it('should default to table format', () => {
            const result = createResultWithReduceOutput();
            const tableOutput = formatResults(result, 'table');
            expect(tableOutput).toContain('NAME');
        });
    });

    // ========================================================================
    // Summary
    // ========================================================================

    describe('formatSummary', () => {
        it('should show summary with success count', () => {
            const result = createMockResult();
            const summary = formatSummary(result);
            expect(summary).toContain('Summary');
            expect(summary).toContain('Total items: 2');
            expect(summary).toContain('Successful:');
            expect(summary).toContain('100%');
        });

        it('should show failure count when there are failures', () => {
            const result = createMockResult({
                stats: {
                    totalItems: 5,
                    successfulMaps: 3,
                    failedMaps: 2,
                    totalDurationMs: 600,
                    mapDurationMs: 500,
                    reduceDurationMs: 100,
                },
            });
            const summary = formatSummary(result);
            expect(summary).toContain('Failed:');
            expect(summary).toContain('60%');
        });

        it('should show duration', () => {
            const result = createMockResult({
                stats: {
                    totalItems: 2,
                    successfulMaps: 2,
                    failedMaps: 0,
                    totalDurationMs: 5000,
                },
            });
            const summary = formatSummary(result);
            expect(summary).toContain('Duration');
        });

        it('should handle zero total items', () => {
            const result = createEmptyResult();
            const summary = formatSummary(result);
            expect(summary).toContain('Total items: 0');
        });
    });

    // ========================================================================
    // Duration Formatting
    // ========================================================================

    describe('formatDuration', () => {
        it('should format milliseconds', () => {
            expect(formatDuration(500)).toBe('500ms');
        });

        it('should format seconds', () => {
            expect(formatDuration(3500)).toBe('3.5s');
        });

        it('should format minutes and seconds', () => {
            expect(formatDuration(125000)).toBe('2m 5s');
        });

        it('should handle zero', () => {
            expect(formatDuration(0)).toBe('0ms');
        });

        it('should format exactly 1 second', () => {
            expect(formatDuration(1000)).toBe('1.0s');
        });

        it('should format exactly 1 minute', () => {
            expect(formatDuration(60000)).toBe('1m 0s');
        });

        it('should format sub-millisecond correctly', () => {
            // Sub-1ms should still show as ms
            expect(formatDuration(0)).toBe('0ms');
        });
    });
});
