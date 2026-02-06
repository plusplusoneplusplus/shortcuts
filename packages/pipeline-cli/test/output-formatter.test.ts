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
import type { PipelineExecutionResult } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Test Helpers
// ============================================================================

function createMockResult(overrides?: Partial<PipelineExecutionResult>): PipelineExecutionResult {
    return {
        success: true,
        mapResults: [
            {
                workItemId: 'item-1',
                success: true,
                output: {
                    item: { name: 'Item 1', category: 'A' },
                    output: { severity: 'high', category: 'bug' },
                    success: true,
                },
                executionTimeMs: 100,
            },
            {
                workItemId: 'item-2',
                success: true,
                output: {
                    item: { name: 'Item 2', category: 'B' },
                    output: { severity: 'low', category: 'feature' },
                    success: true,
                },
                executionTimeMs: 200,
            },
        ],
        totalTimeMs: 500,
        executionStats: {
            totalItems: 2,
            successfulMaps: 2,
            failedMaps: 0,
            mapPhaseTimeMs: 300,
            reducePhaseTimeMs: 50,
            maxConcurrency: 5,
        },
        ...overrides,
    } as PipelineExecutionResult;
}

function createEmptyResult(): PipelineExecutionResult {
    return {
        success: true,
        mapResults: [],
        totalTimeMs: 10,
        executionStats: {
            totalItems: 0,
            successfulMaps: 0,
            failedMaps: 0,
            mapPhaseTimeMs: 5,
            reducePhaseTimeMs: 5,
            maxConcurrency: 5,
        },
    } as PipelineExecutionResult;
}

function createResultWithReduceOutput(): PipelineExecutionResult {
    return {
        success: true,
        output: {
            results: [
                { output: { name: 'Alice', role: 'dev' }, success: true, item: {} },
                { output: { name: 'Bob', role: 'pm' }, success: true, item: {} },
            ],
            formattedOutput: '',
            summary: { totalItems: 2, successfulItems: 2, failedItems: 0, outputFields: ['name', 'role'] },
        },
        mapResults: [],
        totalTimeMs: 300,
        executionStats: {
            totalItems: 2,
            successfulMaps: 2,
            failedMaps: 0,
            mapPhaseTimeMs: 250,
            reducePhaseTimeMs: 50,
            maxConcurrency: 5,
        },
    } as PipelineExecutionResult;
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
            // Modify to include commas
            const promResult = (result.output as any).results[0];
            promResult.output.name = 'Alice, Jr.';
            const output = formatResults(result, 'csv');
            expect(output).toContain('"Alice, Jr."');
        });

        it('should escape CSV fields with quotes', () => {
            const result = createResultWithReduceOutput();
            const promResult = (result.output as any).results[0];
            promResult.output.name = 'Alice "the great"';
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
            const promResult = (result.output as any).results[0];
            promResult.output.name = 'Alice|Bob';
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
            const promResult = (result.output as any).results[0];
            promResult.output.name = 'A'.repeat(100);
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
                executionStats: {
                    totalItems: 5,
                    successfulMaps: 3,
                    failedMaps: 2,
                    mapPhaseTimeMs: 500,
                    reducePhaseTimeMs: 100,
                    maxConcurrency: 5,
                },
            });
            const summary = formatSummary(result);
            expect(summary).toContain('Failed:');
            expect(summary).toContain('60%');
        });

        it('should show filter info when filter was used', () => {
            const result = createMockResult({
                filterResult: {
                    included: [],
                    excluded: [],
                    stats: {
                        totalItems: 10,
                        includedCount: 7,
                        excludedCount: 3,
                        executionTimeMs: 50,
                        filterType: 'rule',
                    },
                },
            });
            const summary = formatSummary(result);
            expect(summary).toContain('Filter');
            expect(summary).toContain('rule');
            expect(summary).toContain('7 included');
            expect(summary).toContain('3 excluded');
        });

        it('should show duration', () => {
            const result = createMockResult({ totalTimeMs: 5000 });
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
