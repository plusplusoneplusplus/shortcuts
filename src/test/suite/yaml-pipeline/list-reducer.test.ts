/**
 * Tests for List Reducer
 *
 * Comprehensive tests for result formatting and output generation.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
import {
    formatResultsAsList,
    formatItem,
    formatOutput,
    formatValue,
    truncateValue,
    formatResultsAsTable,
    formatResultsAsJSON,
    formatResultsAsCSV,
    DEFAULT_LIST_FORMAT_OPTIONS
} from '../../../shortcuts/yaml-pipeline/list-reducer';
import { PipelineMapResult, PipelineStats } from '../../../shortcuts/yaml-pipeline/types';

suite('List Reducer', () => {
    // Helper to create test results
    function createTestResult(
        item: Record<string, string>,
        output: Record<string, unknown>,
        success: boolean = true,
        error?: string
    ): PipelineMapResult {
        return { item, output, success, error };
    }

    // Helper to create test stats
    function createTestStats(
        total: number,
        successful: number,
        failed: number
    ): PipelineStats {
        return {
            totalItems: total,
            successfulItems: successful,
            failedItems: failed,
            totalTimeMs: 1000,
            mapPhaseTimeMs: 800,
            reducePhaseTimeMs: 200
        };
    }

    suite('formatResultsAsList', () => {
        test('formats successful results', () => {
            const results: PipelineMapResult[] = [
                createTestResult(
                    { id: '1', title: 'Bug A' },
                    { severity: 'high', category: 'backend' }
                ),
                createTestResult(
                    { id: '2', title: 'Bug B' },
                    { severity: 'low', category: 'ui' }
                )
            ];

            const stats = createTestStats(2, 2, 0);
            const output = formatResultsAsList(results, stats);

            assert.ok(output.includes('## Results (2 items)'));
            assert.ok(output.includes('### Item 1'));
            assert.ok(output.includes('### Item 2'));
            assert.ok(output.includes('Bug A'));
            assert.ok(output.includes('severity=high'));
            assert.ok(output.includes('2 succeeded, 0 failed'));
        });

        test('shows warning for failed items', () => {
            const results: PipelineMapResult[] = [
                createTestResult({ id: '1' }, { result: 'ok' }, true),
                createTestResult({ id: '2' }, {}, false, 'AI error')
            ];

            const stats = createTestStats(2, 1, 1);
            const output = formatResultsAsList(results, stats);

            assert.ok(output.includes('⚠️ 1 items failed'));
            assert.ok(output.includes('**Error:** AI error'));
        });

        test('respects showNumbers option', () => {
            const results: PipelineMapResult[] = [
                createTestResult({ id: '1' }, { result: 'ok' })
            ];

            const stats = createTestStats(1, 1, 0);

            const withNumbers = formatResultsAsList(results, stats, { showNumbers: true });
            const withoutNumbers = formatResultsAsList(results, stats, { showNumbers: false });

            assert.ok(withNumbers.includes('### Item 1'));
            assert.ok(withoutNumbers.includes('### Item'));
            assert.ok(!withoutNumbers.includes('### Item 1'));
        });

        test('respects showInput option', () => {
            const results: PipelineMapResult[] = [
                createTestResult({ id: '1', title: 'Test' }, { result: 'ok' })
            ];

            const stats = createTestStats(1, 1, 0);

            const withInput = formatResultsAsList(results, stats, { showInput: true });
            const withoutInput = formatResultsAsList(results, stats, { showInput: false });

            assert.ok(withInput.includes('**Input:**'));
            assert.ok(!withoutInput.includes('**Input:**'));
        });

        test('respects showOutput option', () => {
            const results: PipelineMapResult[] = [
                createTestResult({ id: '1' }, { result: 'ok' })
            ];

            const stats = createTestStats(1, 1, 0);

            const withOutput = formatResultsAsList(results, stats, { showOutput: true });
            const withoutOutput = formatResultsAsList(results, stats, { showOutput: false });

            assert.ok(withOutput.includes('**Output:**'));
            assert.ok(!withoutOutput.includes('**Output:**'));
        });

        test('respects showErrors option', () => {
            const results: PipelineMapResult[] = [
                createTestResult({ id: '1' }, {}, false, 'Some error')
            ];

            const stats = createTestStats(1, 0, 1);

            const withErrors = formatResultsAsList(results, stats, { showErrors: true });
            const withoutErrors = formatResultsAsList(results, stats, { showErrors: false });

            assert.ok(withErrors.includes('**Error:** Some error'));
            assert.ok(!withoutErrors.includes('**Error:**'));
        });

        test('respects maxItems option', () => {
            const results: PipelineMapResult[] = Array.from({ length: 10 }, (_, i) =>
                createTestResult({ id: String(i) }, { result: `ok${i}` })
            );

            const stats = createTestStats(10, 10, 0);
            const output = formatResultsAsList(results, stats, { maxItems: 3 });

            assert.ok(output.includes('### Item 1'));
            assert.ok(output.includes('### Item 2'));
            assert.ok(output.includes('### Item 3'));
            assert.ok(!output.includes('### Item 4'));
            assert.ok(output.includes('... and 7 more items'));
        });

        test('uses verbose format', () => {
            const results: PipelineMapResult[] = [
                createTestResult(
                    { name: 'Alice', age: '30' },
                    { status: 'active', level: 'admin' }
                )
            ];

            const stats = createTestStats(1, 1, 0);
            const output = formatResultsAsList(results, stats, { format: 'verbose' });

            assert.ok(output.includes('- name:'));
            assert.ok(output.includes('- age:'));
            assert.ok(output.includes('- status:'));
        });

        test('handles empty results', () => {
            const stats = createTestStats(0, 0, 0);
            const output = formatResultsAsList([], stats);

            assert.ok(output.includes('## Results (0 items)'));
        });
    });

    suite('formatItem', () => {
        test('formats item in compact mode', () => {
            const item = { name: 'Alice', age: '30', city: 'NYC' };
            const result = formatItem(item, 'compact');

            assert.ok(result.includes('name=Alice'));
            assert.ok(result.includes('age=30'));
            assert.ok(result.includes('city=NYC'));
        });

        test('formats item in verbose mode', () => {
            const item = { name: 'Alice', age: '30' };
            const result = formatItem(item, 'verbose');

            assert.ok(result.includes('- name: Alice'));
            assert.ok(result.includes('- age: 30'));
        });

        test('truncates long values in compact mode', () => {
            const item = { description: 'x'.repeat(100) };
            const result = formatItem(item, 'compact');

            assert.ok(result.length < 100);
            assert.ok(result.includes('...'));
        });
    });

    suite('formatOutput', () => {
        test('formats output in compact mode', () => {
            const output = { severity: 'high', category: 'backend' };
            const result = formatOutput(output, 'compact');

            assert.ok(result.includes('severity=high'));
            assert.ok(result.includes('category=backend'));
        });

        test('formats output in verbose mode', () => {
            const output = { severity: 'high', effort: 4 };
            const result = formatOutput(output, 'verbose');

            assert.ok(result.includes('- severity: high'));
            assert.ok(result.includes('- effort: 4'));
        });

        test('handles various value types', () => {
            const output = {
                str: 'hello',
                num: 42,
                bool: true,
                nil: null,
                arr: [1, 2, 3]
            };

            const result = formatOutput(output, 'compact');

            assert.ok(result.includes('str=hello'));
            assert.ok(result.includes('num=42'));
            assert.ok(result.includes('bool=true'));
            assert.ok(result.includes('nil=null'));
            assert.ok(result.includes('arr=[3 items]'));
        });
    });

    suite('formatValue', () => {
        test('formats string', () => {
            assert.strictEqual(formatValue('hello'), 'hello');
        });

        test('truncates long string', () => {
            const longStr = 'x'.repeat(100);
            const result = formatValue(longStr);
            assert.ok(result.length <= 53); // 50 + '...'
            assert.ok(result.endsWith('...'));
        });

        test('formats number', () => {
            assert.strictEqual(formatValue(42), '42');
            assert.strictEqual(formatValue(3.14), '3.14');
        });

        test('formats boolean', () => {
            assert.strictEqual(formatValue(true), 'true');
            assert.strictEqual(formatValue(false), 'false');
        });

        test('formats null/undefined', () => {
            assert.strictEqual(formatValue(null), 'null');
            assert.strictEqual(formatValue(undefined), 'null');
        });

        test('formats array', () => {
            assert.strictEqual(formatValue([1, 2, 3]), '[3 items]');
            assert.strictEqual(formatValue([]), '[0 items]');
        });

        test('formats object as JSON', () => {
            const result = formatValue({ a: 1 });
            assert.strictEqual(result, '{"a":1}');
        });
    });

    suite('truncateValue', () => {
        test('returns short string unchanged', () => {
            assert.strictEqual(truncateValue('hello', 10), 'hello');
        });

        test('truncates long string', () => {
            assert.strictEqual(truncateValue('hello world', 8), 'hello...');
        });

        test('handles exact length', () => {
            assert.strictEqual(truncateValue('hello', 5), 'hello');
        });

        test('uses default max length', () => {
            const longStr = 'x'.repeat(100);
            const result = truncateValue(longStr);
            assert.strictEqual(result.length, 50);
            assert.ok(result.endsWith('...'));
        });
    });

    suite('formatResultsAsTable', () => {
        test('generates markdown table', () => {
            const results: PipelineMapResult[] = [
                createTestResult(
                    { id: '1', title: 'Bug A' },
                    { severity: 'high' }
                ),
                createTestResult(
                    { id: '2', title: 'Bug B' },
                    { severity: 'low' }
                )
            ];

            const output = formatResultsAsTable(results);

            assert.ok(output.includes('|'));
            assert.ok(output.includes('---'));
            assert.ok(output.includes('[in] id'));
            assert.ok(output.includes('[out] severity'));
            assert.ok(output.includes('Bug A'));
            assert.ok(output.includes('high'));
        });

        test('respects maxRows option', () => {
            const results: PipelineMapResult[] = Array.from({ length: 10 }, (_, i) =>
                createTestResult({ id: String(i) }, { val: i })
            );

            const output = formatResultsAsTable(results, { maxRows: 3 });

            assert.ok(output.includes('| 1 |'));
            assert.ok(output.includes('| 2 |'));
            assert.ok(output.includes('| 3 |'));
            assert.ok(!output.includes('| 4 |'));
            assert.ok(output.includes('... and 7 more rows'));
        });

        test('handles empty results', () => {
            const output = formatResultsAsTable([]);
            assert.strictEqual(output, 'No results to display.');
        });

        test('shows success/failure status', () => {
            const results: PipelineMapResult[] = [
                createTestResult({ id: '1' }, { val: 1 }, true),
                createTestResult({ id: '2' }, {}, false, 'error')
            ];

            const output = formatResultsAsTable(results);

            assert.ok(output.includes('✓'));
            assert.ok(output.includes('✗'));
        });
    });

    suite('formatResultsAsJSON', () => {
        test('generates valid JSON', () => {
            const results: PipelineMapResult[] = [
                createTestResult(
                    { id: '1', title: 'Test' },
                    { severity: 'high', count: 42 }
                )
            ];

            const output = formatResultsAsJSON(results);
            const parsed = JSON.parse(output);

            assert.ok(Array.isArray(parsed));
            assert.strictEqual(parsed.length, 1);
            assert.deepStrictEqual(parsed[0].input, { id: '1', title: 'Test' });
            assert.deepStrictEqual(parsed[0].output, { severity: 'high', count: 42 });
            assert.strictEqual(parsed[0].success, true);
        });

        test('includes error for failed items', () => {
            const results: PipelineMapResult[] = [
                createTestResult({ id: '1' }, {}, false, 'Something went wrong')
            ];

            const output = formatResultsAsJSON(results);
            const parsed = JSON.parse(output);

            assert.strictEqual(parsed[0].success, false);
            assert.strictEqual(parsed[0].error, 'Something went wrong');
        });

        test('handles empty results', () => {
            const output = formatResultsAsJSON([]);
            assert.strictEqual(output, '[]');
        });

        test('handles complex nested values', () => {
            const results: PipelineMapResult[] = [
                createTestResult(
                    { id: '1' },
                    {
                        nested: { deep: { value: 'test' } },
                        array: [1, 2, { three: 3 }]
                    }
                )
            ];

            const output = formatResultsAsJSON(results);
            const parsed = JSON.parse(output);

            assert.deepStrictEqual(parsed[0].output.nested, { deep: { value: 'test' } });
            assert.deepStrictEqual(parsed[0].output.array, [1, 2, { three: 3 }]);
        });
    });

    suite('formatResultsAsCSV', () => {
        test('generates valid CSV', () => {
            const results: PipelineMapResult[] = [
                createTestResult(
                    { id: '1', title: 'Bug A' },
                    { severity: 'high' }
                ),
                createTestResult(
                    { id: '2', title: 'Bug B' },
                    { severity: 'low' }
                )
            ];

            const output = formatResultsAsCSV(results);
            const lines = output.split('\n');

            // Header
            assert.ok(lines[0].includes('id'));
            assert.ok(lines[0].includes('title'));
            assert.ok(lines[0].includes('out_severity'));
            assert.ok(lines[0].includes('success'));

            // Data rows
            assert.ok(lines[1].includes('1'));
            assert.ok(lines[1].includes('Bug A'));
            assert.ok(lines[1].includes('high'));
            assert.ok(lines[1].includes('true'));
        });

        test('escapes values with commas', () => {
            const results: PipelineMapResult[] = [
                createTestResult(
                    { description: 'Hello, World' },
                    { note: 'Item 1, Item 2' }
                )
            ];

            const output = formatResultsAsCSV(results);

            assert.ok(output.includes('"Hello, World"'));
            assert.ok(output.includes('"Item 1, Item 2"'));
        });

        test('escapes values with quotes', () => {
            const results: PipelineMapResult[] = [
                createTestResult(
                    { quote: 'She said "Hello"' },
                    { result: 'ok' }
                )
            ];

            const output = formatResultsAsCSV(results);

            assert.ok(output.includes('"She said ""Hello"""'));
        });

        test('escapes values with newlines', () => {
            const results: PipelineMapResult[] = [
                createTestResult(
                    { description: 'Line 1\nLine 2' },
                    { result: 'ok' }
                )
            ];

            const output = formatResultsAsCSV(results);

            assert.ok(output.includes('"Line 1\nLine 2"'));
        });

        test('handles empty results', () => {
            const output = formatResultsAsCSV([]);
            assert.strictEqual(output, '');
        });

        test('prefixes output columns with out_', () => {
            const results: PipelineMapResult[] = [
                createTestResult({ id: '1' }, { severity: 'high', category: 'bug' })
            ];

            const output = formatResultsAsCSV(results);
            const header = output.split('\n')[0];

            assert.ok(header.includes('out_severity'));
            assert.ok(header.includes('out_category'));
        });
    });

    suite('DEFAULT_LIST_FORMAT_OPTIONS', () => {
        test('has correct default values', () => {
            assert.strictEqual(DEFAULT_LIST_FORMAT_OPTIONS.showNumbers, true);
            assert.strictEqual(DEFAULT_LIST_FORMAT_OPTIONS.showInput, true);
            assert.strictEqual(DEFAULT_LIST_FORMAT_OPTIONS.showOutput, true);
            assert.strictEqual(DEFAULT_LIST_FORMAT_OPTIONS.showErrors, true);
            assert.strictEqual(DEFAULT_LIST_FORMAT_OPTIONS.maxItems, Number.MAX_SAFE_INTEGER);
            assert.strictEqual(DEFAULT_LIST_FORMAT_OPTIONS.format, 'compact');
        });
    });

    suite('integration with design doc example', () => {
        test('formats bug triage results as expected', () => {
            const results: PipelineMapResult[] = [
                createTestResult(
                    { id: '1', title: 'Login broken', priority: 'high' },
                    { severity: 'critical', category: 'backend', effort_hours: 4, needs_more_info: false }
                ),
                createTestResult(
                    { id: '2', title: 'Slow search', priority: 'medium' },
                    { severity: 'medium', category: 'database', effort_hours: 8, needs_more_info: false }
                )
            ];

            const stats = createTestStats(2, 2, 0);
            const output = formatResultsAsList(results, stats);

            // Verify header
            assert.ok(output.includes('## Results (2 items)'));

            // Verify items are formatted
            assert.ok(output.includes('### Item 1'));
            assert.ok(output.includes('### Item 2'));

            // Verify input is shown
            assert.ok(output.includes('id=1'));
            assert.ok(output.includes('title=Login broken'));

            // Verify output is shown
            assert.ok(output.includes('severity=critical'));
            assert.ok(output.includes('category=backend'));
            assert.ok(output.includes('effort_hours=4'));

            // Verify stats
            assert.ok(output.includes('2 succeeded, 0 failed'));
        });
    });
});
