/**
 * Pipeline Result Viewer Tests
 *
 * Comprehensive tests for the enhanced pipeline result viewer.
 * Tests cover types, content generation, and formatting utilities.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
import {
    mapResultToNode,
    getItemPreview,
    formatDuration,
    getStatusIcon,
    getStatusClass,
    PipelineResultViewData,
    PipelineItemResultNode,
    ResultViewerFilterState,
    RetryState,
    ResultViewerMessage,
    ResultViewerExtensionMessage
} from '../../../shortcuts/yaml-pipeline/ui/result-viewer-types';
import {
    getItemDetailContent,
    getReduceResultSection
} from '../../../shortcuts/yaml-pipeline/ui/result-viewer-content';
import { PromptMapResult, ExecutionStats, ReduceStats } from '@plusplusoneplusplus/pipeline-core';

suite('Pipeline Result Viewer Tests', () => {
    // Sample execution stats
    const sampleExecutionStats: ExecutionStats = {
        totalItems: 5,
        successfulMaps: 4,
        failedMaps: 1,
        mapPhaseTimeMs: 5000,
        reducePhaseTimeMs: 100,
        maxConcurrency: 3
    };

    // Sample successful result
    const sampleSuccessResult: PromptMapResult = {
        item: { id: '1', title: 'Bug A', description: 'Login fails' },
        output: { severity: 'high', category: 'backend' },
        success: true,
        rawResponse: '{"severity": "high", "category": "backend"}'
    };

    // Sample failed result
    const sampleFailedResult: PromptMapResult = {
        item: { id: '2', title: 'Bug B', description: 'UI issue' },
        output: {},
        success: false,
        error: 'AI service unavailable',
        rawResponse: 'Error: connection timeout'
    };

    // Sample item result nodes
    const sampleSuccessNode: PipelineItemResultNode = {
        id: 'item-0',
        index: 0,
        input: { id: '1', title: 'Bug A', description: 'Login fails' },
        output: { severity: 'high', category: 'backend' },
        success: true,
        rawResponse: '{"severity": "high", "category": "backend"}',
        executionTimeMs: 1500
    };

    const sampleFailedNode: PipelineItemResultNode = {
        id: 'item-1',
        index: 1,
        input: { id: '2', title: 'Bug B', description: 'UI issue' },
        output: {},
        success: false,
        error: 'AI service unavailable',
        executionTimeMs: 500
    };

    // Sample view data
    const sampleViewData: PipelineResultViewData = {
        pipelineName: 'Bug Triage',
        packageName: 'bug-triage',
        success: true,
        totalTimeMs: 5100,
        executionStats: sampleExecutionStats,
        itemResults: [sampleSuccessNode, sampleFailedNode],
        completedAt: new Date('2024-01-15T10:30:00Z')
    };

    suite('mapResultToNode', () => {
        test('should convert successful PromptMapResult to node', () => {
            const node = mapResultToNode(sampleSuccessResult, 0, 1500);

            assert.strictEqual(node.id, 'item-0');
            assert.strictEqual(node.index, 0);
            assert.deepStrictEqual(node.input, sampleSuccessResult.item);
            assert.deepStrictEqual(node.output, sampleSuccessResult.output);
            assert.strictEqual(node.success, true);
            assert.strictEqual(node.rawResponse, sampleSuccessResult.rawResponse);
            assert.strictEqual(node.executionTimeMs, 1500);
            assert.strictEqual(node.error, undefined);
        });

        test('should convert failed PromptMapResult to node', () => {
            const node = mapResultToNode(sampleFailedResult, 1, 500);

            assert.strictEqual(node.id, 'item-1');
            assert.strictEqual(node.index, 1);
            assert.strictEqual(node.success, false);
            assert.strictEqual(node.error, 'AI service unavailable');
            assert.strictEqual(node.executionTimeMs, 500);
        });

        test('should preserve rawResponse for failed results', () => {
            const node = mapResultToNode(sampleFailedResult, 1, 500);

            assert.strictEqual(node.rawResponse, 'Error: connection timeout');
        });

        test('should handle undefined rawResponse gracefully', () => {
            const resultWithoutRaw: PromptMapResult = {
                item: { id: '3', title: 'Bug C' },
                output: {},
                success: false,
                error: 'Timeout before AI response',
                rawResponse: undefined
            };

            const node = mapResultToNode(resultWithoutRaw, 2);
            
            assert.strictEqual(node.rawResponse, undefined);
            assert.strictEqual(node.error, 'Timeout before AI response');
        });

        test('should preserve rawResponse for parse errors', () => {
            const parseErrorResult: PromptMapResult = {
                item: { id: '4', title: 'Bug D' },
                output: {},
                success: false,
                error: 'Failed to parse AI response: Unexpected token',
                rawResponse: 'This is not valid JSON { broken'
            };

            const node = mapResultToNode(parseErrorResult, 3, 1200);
            
            assert.strictEqual(node.success, false);
            assert.strictEqual(node.rawResponse, 'This is not valid JSON { broken');
            assert.ok(node.error?.includes('parse'));
        });

        test('should preserve multiline rawResponse', () => {
            const multilineResult: PromptMapResult = {
                item: { id: '5', title: 'Bug E' },
                output: { status: 'analyzed' },
                success: true,
                rawResponse: '{\n  "status": "analyzed",\n  "details": "line1\\nline2"\n}'
            };

            const node = mapResultToNode(multilineResult, 4);
            
            assert.ok(node.rawResponse?.includes('\n'));
            assert.strictEqual(node.success, true);
        });

        test('should handle missing executionTimeMs', () => {
            const node = mapResultToNode(sampleSuccessResult, 0);

            assert.strictEqual(node.executionTimeMs, undefined);
        });

        test('should generate unique IDs based on index', () => {
            const node0 = mapResultToNode(sampleSuccessResult, 0);
            const node1 = mapResultToNode(sampleSuccessResult, 1);
            const node99 = mapResultToNode(sampleSuccessResult, 99);

            assert.strictEqual(node0.id, 'item-0');
            assert.strictEqual(node1.id, 'item-1');
            assert.strictEqual(node99.id, 'item-99');
        });
    });

    suite('getItemPreview', () => {
        test('should return first field value as preview', () => {
            const preview = getItemPreview(sampleSuccessNode);

            assert.strictEqual(preview, '1');
        });

        test('should truncate long values', () => {
            const longNode: PipelineItemResultNode = {
                ...sampleSuccessNode,
                input: { title: 'This is a very long title that should be truncated for display purposes' }
            };

            const preview = getItemPreview(longNode, 30);

            assert.ok(preview.length <= 30, 'Preview should be truncated');
            assert.ok(preview.endsWith('...'), 'Should end with ellipsis');
        });

        test('should not truncate short values', () => {
            const shortNode: PipelineItemResultNode = {
                ...sampleSuccessNode,
                input: { title: 'Short' }
            };

            const preview = getItemPreview(shortNode, 50);

            assert.strictEqual(preview, 'Short');
            assert.ok(!preview.includes('...'), 'Should not have ellipsis');
        });

        test('should handle empty input', () => {
            const emptyNode: PipelineItemResultNode = {
                ...sampleSuccessNode,
                input: {}
            };

            const preview = getItemPreview(emptyNode);

            assert.strictEqual(preview, '');
        });

        test('should respect custom maxLength', () => {
            const node: PipelineItemResultNode = {
                ...sampleSuccessNode,
                input: { title: '1234567890' }
            };

            const preview5 = getItemPreview(node, 5);
            const preview10 = getItemPreview(node, 10);
            const preview20 = getItemPreview(node, 20);

            assert.ok(preview5.length <= 5);
            assert.strictEqual(preview10, '1234567890'); // Exactly 10 chars
            assert.strictEqual(preview20, '1234567890'); // Shorter than max
        });
    });

    suite('formatDuration', () => {
        test('should format milliseconds', () => {
            assert.strictEqual(formatDuration(0), '0ms');
            assert.strictEqual(formatDuration(1), '1ms');
            assert.strictEqual(formatDuration(500), '500ms');
            assert.strictEqual(formatDuration(999), '999ms');
        });

        test('should format seconds', () => {
            assert.strictEqual(formatDuration(1000), '1.0s');
            assert.strictEqual(formatDuration(1500), '1.5s');
            assert.strictEqual(formatDuration(30000), '30.0s');
            assert.strictEqual(formatDuration(59999), '60.0s');
        });

        test('should format minutes and seconds', () => {
            assert.strictEqual(formatDuration(60000), '1m 0s');
            assert.strictEqual(formatDuration(90000), '1m 30s');
            assert.strictEqual(formatDuration(300000), '5m 0s');
            assert.strictEqual(formatDuration(3600000), '60m 0s');
        });

        test('should handle edge cases', () => {
            // Boundary between ms and s
            assert.strictEqual(formatDuration(999), '999ms');
            assert.strictEqual(formatDuration(1000), '1.0s');

            // Boundary between s and m
            assert.strictEqual(formatDuration(59999), '60.0s');
            assert.strictEqual(formatDuration(60000), '1m 0s');
        });
    });

    suite('getStatusIcon', () => {
        test('should return check mark for success', () => {
            assert.strictEqual(getStatusIcon(true), '✅');
        });

        test('should return X mark for failure', () => {
            assert.strictEqual(getStatusIcon(false), '❌');
        });
    });

    suite('getStatusClass', () => {
        test('should return success class for success', () => {
            assert.strictEqual(getStatusClass(true), 'status-success');
        });

        test('should return error class for failure', () => {
            assert.strictEqual(getStatusClass(false), 'status-error');
        });
    });

    suite('getItemDetailContent', () => {
        test('should generate detail HTML for successful result', () => {
            const html = getItemDetailContent(sampleSuccessNode);

            assert.ok(html.includes('detail-section'), 'Should have detail-section class');
            assert.ok(html.includes('Item #1'), 'Should show item number');
            assert.ok(html.includes('✅'), 'Should show success icon');
            assert.ok(html.includes('Input'), 'Should have Input section');
            assert.ok(html.includes('Output'), 'Should have Output section');
        });

        test('should show input fields correctly', () => {
            const html = getItemDetailContent(sampleSuccessNode);

            assert.ok(html.includes('id:'), 'Should show id field');
            assert.ok(html.includes('title:'), 'Should show title field');
            assert.ok(html.includes('Bug A'), 'Should show title value');
        });

        test('should show output fields for successful result', () => {
            const html = getItemDetailContent(sampleSuccessNode);

            assert.ok(html.includes('severity:'), 'Should show severity field');
            assert.ok(html.includes('high'), 'Should show severity value');
            assert.ok(html.includes('category:'), 'Should show category field');
            assert.ok(html.includes('backend'), 'Should show category value');
        });

        test('should show error for failed result', () => {
            const html = getItemDetailContent(sampleFailedNode);

            assert.ok(html.includes('❌'), 'Should show error icon');
            assert.ok(html.includes('Error'), 'Should have Error section');
            assert.ok(html.includes('AI service unavailable'), 'Should show error message');
            assert.ok(html.includes('error-content'), 'Should have error-content class');
        });

        test('should include raw response section when available', () => {
            const html = getItemDetailContent(sampleSuccessNode);

            assert.ok(html.includes('Raw AI Response'), 'Should have raw response section');
            assert.ok(html.includes('raw-response'), 'Should have raw-response class');
        });

        test('should use data attribute for toggle instead of inline onclick', () => {
            const html = getItemDetailContent(sampleSuccessNode);

            // Should use data-toggle attribute for CSP compliance
            assert.ok(html.includes('data-toggle="raw-response"'), 'Should use data-toggle attribute');
            // Should NOT use inline onclick (blocked by CSP)
            assert.ok(!html.includes('onclick='), 'Should not use inline onclick handler');
        });

        test('should not include raw response section when not available', () => {
            const nodeWithoutRaw: PipelineItemResultNode = {
                ...sampleSuccessNode,
                rawResponse: undefined
            };

            const html = getItemDetailContent(nodeWithoutRaw);

            assert.ok(!html.includes('Raw AI Response'), 'Should not have raw response section');
        });

        test('should include raw response section for failed results when available', () => {
            const failedNodeWithRaw: PipelineItemResultNode = {
                ...sampleFailedNode,
                rawResponse: 'Connection error: ECONNREFUSED'
            };

            const html = getItemDetailContent(failedNodeWithRaw);

            assert.ok(html.includes('Raw AI Response'), 'Should have raw response section for failed item');
            assert.ok(html.includes('ECONNREFUSED'), 'Should include the raw response content');
        });

        test('should escape HTML in raw response', () => {
            const nodeWithHtmlInRaw: PipelineItemResultNode = {
                ...sampleSuccessNode,
                rawResponse: '<script>malicious()</script>{"data": true}'
            };

            const html = getItemDetailContent(nodeWithHtmlInRaw);

            assert.ok(html.includes('&lt;script&gt;'), 'Should escape HTML in raw response');
            assert.ok(!html.includes('<script>malicious'), 'Should not have unescaped script in raw response');
        });

        test('should handle special characters in raw response', () => {
            const nodeWithSpecialChars: PipelineItemResultNode = {
                ...sampleSuccessNode,
                rawResponse: '{"message": "Hello & goodbye < world > test \'quoted\' \"double\"}'
            };

            const html = getItemDetailContent(nodeWithSpecialChars);

            assert.ok(html.includes('&amp;'), 'Should escape ampersand');
            assert.ok(html.includes('&lt;'), 'Should escape less than');
            assert.ok(html.includes('&gt;'), 'Should escape greater than');
        });

        test('should escape HTML in input values', () => {
            const nodeWithHtml: PipelineItemResultNode = {
                ...sampleSuccessNode,
                input: { title: '<script>alert("xss")</script>' }
            };

            const html = getItemDetailContent(nodeWithHtml);

            assert.ok(html.includes('&lt;script&gt;'), 'Should escape HTML tags');
            assert.ok(!html.includes('<script>alert'), 'Should not have unescaped script');
        });

        test('should escape HTML in error messages', () => {
            const nodeWithHtmlError: PipelineItemResultNode = {
                ...sampleFailedNode,
                error: '<img onerror="alert(1)" src="x">'
            };

            const html = getItemDetailContent(nodeWithHtmlError);

            assert.ok(html.includes('&lt;img'), 'Should escape HTML tags in error');
        });

        test('should handle various output value types', () => {
            const nodeWithVariousTypes: PipelineItemResultNode = {
                ...sampleSuccessNode,
                output: {
                    stringField: 'hello',
                    numberField: 42,
                    booleanField: true,
                    nullField: null,
                    arrayField: [1, 2, 3],
                    objectField: { nested: 'value' }
                }
            };

            const html = getItemDetailContent(nodeWithVariousTypes);

            assert.ok(html.includes('hello'), 'Should show string value');
            assert.ok(html.includes('42'), 'Should show number value');
            assert.ok(html.includes('true'), 'Should show boolean value');
            assert.ok(html.includes('null'), 'Should show null value');
            assert.ok(html.includes('[1,2,3]'), 'Should show array value');
        });
    });

    suite('PipelineResultViewData structure', () => {
        test('should have all required fields', () => {
            assert.ok(sampleViewData.pipelineName, 'Should have pipelineName');
            assert.ok(sampleViewData.packageName, 'Should have packageName');
            assert.ok(typeof sampleViewData.success === 'boolean', 'Should have success boolean');
            assert.ok(typeof sampleViewData.totalTimeMs === 'number', 'Should have totalTimeMs');
            assert.ok(sampleViewData.executionStats, 'Should have executionStats');
            assert.ok(Array.isArray(sampleViewData.itemResults), 'Should have itemResults array');
            assert.ok(sampleViewData.completedAt instanceof Date, 'Should have completedAt Date');
        });

        test('should allow optional fields', () => {
            const minimalViewData: PipelineResultViewData = {
                pipelineName: 'Test',
                packageName: 'test-pkg',
                success: false,
                totalTimeMs: 0,
                executionStats: {
                    totalItems: 0,
                    successfulMaps: 0,
                    failedMaps: 0,
                    mapPhaseTimeMs: 0,
                    reducePhaseTimeMs: 0,
                    maxConcurrency: 1
                },
                itemResults: [],
                completedAt: new Date()
            };

            assert.ok(minimalViewData.output === undefined, 'output should be optional');
            assert.ok(minimalViewData.error === undefined, 'error should be optional');
        });
    });

    suite('PipelineItemResultNode structure', () => {
        test('should have all required fields for success', () => {
            assert.ok(sampleSuccessNode.id, 'Should have id');
            assert.ok(typeof sampleSuccessNode.index === 'number', 'Should have index');
            assert.ok(sampleSuccessNode.input, 'Should have input');
            assert.ok(sampleSuccessNode.output, 'Should have output');
            assert.ok(sampleSuccessNode.success === true, 'Should have success true');
        });

        test('should have error for failed node', () => {
            assert.ok(sampleFailedNode.error, 'Failed node should have error');
            assert.ok(sampleFailedNode.success === false, 'Failed node should have success false');
        });

        test('should allow optional fields', () => {
            const minimalNode: PipelineItemResultNode = {
                id: 'test-0',
                index: 0,
                input: {},
                output: {},
                success: true
            };

            assert.ok(minimalNode.error === undefined, 'error should be optional');
            assert.ok(minimalNode.rawResponse === undefined, 'rawResponse should be optional');
            assert.ok(minimalNode.executionTimeMs === undefined, 'executionTimeMs should be optional');
        });
    });

    suite('Edge Cases and Error Handling', () => {
        test('should handle empty results array', () => {
            const emptyViewData: PipelineResultViewData = {
                ...sampleViewData,
                itemResults: [],
                executionStats: {
                    ...sampleExecutionStats,
                    totalItems: 0,
                    successfulMaps: 0,
                    failedMaps: 0
                }
            };

            assert.strictEqual(emptyViewData.itemResults.length, 0);
        });

        test('should handle very long field values', () => {
            const longValue = 'A'.repeat(10000);
            const nodeWithLongValues: PipelineItemResultNode = {
                ...sampleSuccessNode,
                input: { longField: longValue },
                output: { longOutput: longValue }
            };

            // Should not crash
            const html = getItemDetailContent(nodeWithLongValues);
            assert.ok(html.includes('longField'), 'Should include field name');
        });

        test('should handle special characters in field names', () => {
            const nodeWithSpecialFields: PipelineItemResultNode = {
                ...sampleSuccessNode,
                input: {
                    'field-with-dash': 'value1',
                    'field_with_underscore': 'value2',
                    'field.with.dots': 'value3'
                }
            };

            const html = getItemDetailContent(nodeWithSpecialFields);
            assert.ok(html.includes('field-with-dash'), 'Should handle dashes');
            assert.ok(html.includes('field_with_underscore'), 'Should handle underscores');
        });

        test('should handle Unicode in values', () => {
            const nodeWithUnicode: PipelineItemResultNode = {
                ...sampleSuccessNode,
                input: {
                    emoji: '🚀 Launch!',
                    chinese: '你好世界',
                    arabic: 'مرحبا بالعالم'
                }
            };

            const html = getItemDetailContent(nodeWithUnicode);
            assert.ok(html.includes('🚀'), 'Should handle emoji');
            assert.ok(html.includes('你好'), 'Should handle Chinese');
        });

        test('should handle undefined output fields gracefully', () => {
            const nodeWithUndefined: PipelineItemResultNode = {
                ...sampleSuccessNode,
                output: {
                    definedField: 'value',
                    undefinedField: undefined as unknown as string
                }
            };

            // Should not crash
            const html = getItemDetailContent(nodeWithUndefined);
            assert.ok(html.includes('definedField'), 'Should include defined field');
        });
    });

    suite('Cross-Platform Path Handling', () => {
        test('should handle Windows-style paths in error messages', () => {
            const windowsError = 'File not found: C:\\Users\\test\\file.csv';
            const nodeWithWindowsPath: PipelineItemResultNode = {
                ...sampleFailedNode,
                error: windowsError
            };

            const html = getItemDetailContent(nodeWithWindowsPath);
            // Backslashes should be preserved (they're valid characters)
            assert.ok(html.includes('file.csv'), 'Should include filename');
        });

        test('should handle Unix-style paths in error messages', () => {
            const unixError = 'File not found: /home/user/data/file.csv';
            const nodeWithUnixPath: PipelineItemResultNode = {
                ...sampleFailedNode,
                error: unixError
            };

            const html = getItemDetailContent(nodeWithUnixPath);
            assert.ok(html.includes('/home/user/data/file.csv'), 'Should include Unix path');
        });

        test('should handle Windows-style paths in rawResponse', () => {
            const windowsRaw = '{"file": "C:\\\\Users\\\\test\\\\output.json"}';
            const nodeWithWindowsRaw: PipelineItemResultNode = {
                ...sampleSuccessNode,
                rawResponse: windowsRaw
            };

            const html = getItemDetailContent(nodeWithWindowsRaw);
            assert.ok(html.includes('Raw AI Response'), 'Should show raw response section');
            assert.ok(html.includes('output.json'), 'Should include filename from raw response');
        });

        test('should handle Unix-style paths in rawResponse', () => {
            const unixRaw = '{"file": "/var/log/output.json", "path": "/tmp/data"}';
            const nodeWithUnixRaw: PipelineItemResultNode = {
                ...sampleSuccessNode,
                rawResponse: unixRaw
            };

            const html = getItemDetailContent(nodeWithUnixRaw);
            assert.ok(html.includes('Raw AI Response'), 'Should show raw response section');
            assert.ok(html.includes('/var/log/'), 'Should include Unix path');
        });
    });

    suite('ResultViewerFilterState', () => {
        test('should define filter state structure', () => {
            const filterState: ResultViewerFilterState = {
                showAll: true,
                showSuccess: false,
                showFailed: false
            };

            assert.ok(typeof filterState.showAll === 'boolean');
            assert.ok(typeof filterState.showSuccess === 'boolean');
            assert.ok(typeof filterState.showFailed === 'boolean');
        });
    });
});

suite('Pipeline Result Viewer Integration Tests', () => {
    test('should process a complete pipeline result workflow', () => {
        // Simulate a pipeline execution result
        const results: PromptMapResult[] = [
            {
                item: { id: '1', title: 'Task 1' },
                output: { status: 'completed', priority: 'high' },
                success: true
            },
            {
                item: { id: '2', title: 'Task 2' },
                output: { status: 'pending', priority: 'low' },
                success: true
            },
            {
                item: { id: '3', title: 'Task 3' },
                output: {},
                success: false,
                error: 'Processing failed'
            }
        ];

        // Convert to nodes
        const nodes = results.map((r, i) => mapResultToNode(r, i, 100 + i * 50));

        // Verify all nodes were created
        assert.strictEqual(nodes.length, 3);

        // Verify success/failure counts
        const successCount = nodes.filter(n => n.success).length;
        const failedCount = nodes.filter(n => !n.success).length;
        assert.strictEqual(successCount, 2);
        assert.strictEqual(failedCount, 1);

        // Verify detail content can be generated for each
        nodes.forEach(node => {
            const html = getItemDetailContent(node);
            assert.ok(html.length > 0, 'Should generate HTML content');
            assert.ok(html.includes(`Item #${node.index + 1}`), 'Should include item number');
        });
    });

    test('should preserve rawResponse through complete workflow', () => {
        // Simulate results with various rawResponse scenarios
        const results: PromptMapResult[] = [
            {
                item: { id: '1', title: 'Success with raw' },
                output: { result: 'ok' },
                success: true,
                rawResponse: '{"result": "ok", "extra": "metadata"}'
            },
            {
                item: { id: '2', title: 'Parse error with raw' },
                output: {},
                success: false,
                error: 'Failed to parse JSON',
                rawResponse: 'Invalid JSON: {broken'
            },
            {
                item: { id: '3', title: 'Timeout - no raw' },
                output: {},
                success: false,
                error: 'Timeout',
                rawResponse: undefined
            }
        ];

        // Convert to nodes
        const nodes = results.map((r, i) => mapResultToNode(r, i));

        // Verify rawResponse preservation
        assert.strictEqual(nodes[0].rawResponse, '{"result": "ok", "extra": "metadata"}');
        assert.strictEqual(nodes[1].rawResponse, 'Invalid JSON: {broken');
        assert.strictEqual(nodes[2].rawResponse, undefined);

        // Verify HTML generation handles all cases
        nodes.forEach((node, i) => {
            const html = getItemDetailContent(node);
            
            if (node.rawResponse) {
                assert.ok(html.includes('Raw AI Response'), `Node ${i} should have raw response section`);
                assert.ok(html.includes('raw-response'), `Node ${i} should have raw-response class`);
            } else {
                assert.ok(!html.includes('Raw AI Response'), `Node ${i} should NOT have raw response section`);
            }
        });
    });

    test('should handle rawResponse with special content', () => {
        const results: PromptMapResult[] = [
            {
                item: { id: '1', title: 'Multiline' },
                output: { data: 'test' },
                success: true,
                rawResponse: 'Line 1\nLine 2\n{\n  "nested": true\n}'
            },
            {
                item: { id: '2', title: 'Unicode' },
                output: { emoji: '🚀' },
                success: true,
                rawResponse: '{"emoji": "🚀", "text": "日本語"}'
            },
            {
                item: { id: '3', title: 'Large response' },
                output: { count: 100 },
                success: true,
                rawResponse: 'x'.repeat(10000)
            }
        ];

        const nodes = results.map((r, i) => mapResultToNode(r, i));

        // All should have rawResponse preserved
        nodes.forEach((node, i) => {
            assert.ok(node.rawResponse, `Node ${i} should have rawResponse`);
            
            const html = getItemDetailContent(node);
            assert.ok(html.includes('Raw AI Response'), `Node ${i} should have raw response section`);
        });

        // Verify specific content is preserved
        assert.ok(nodes[0].rawResponse?.includes('\n'), 'Multiline should be preserved');
        assert.ok(nodes[1].rawResponse?.includes('🚀'), 'Unicode should be preserved');
        assert.strictEqual(nodes[2].rawResponse?.length, 10000, 'Large response should be fully preserved');
    });

    test('should calculate statistics correctly', () => {
        const stats: ExecutionStats = {
            totalItems: 100,
            successfulMaps: 95,
            failedMaps: 5,
            mapPhaseTimeMs: 30000,
            reducePhaseTimeMs: 500,
            maxConcurrency: 5
        };

        // Calculate success rate
        const successRate = (stats.successfulMaps / stats.totalItems) * 100;
        assert.strictEqual(successRate, 95);

        // Format durations
        const mapDuration = formatDuration(stats.mapPhaseTimeMs);
        const reduceDuration = formatDuration(stats.reducePhaseTimeMs);
        assert.strictEqual(mapDuration, '30.0s');
        assert.strictEqual(reduceDuration, '500ms');
    });
});

suite('Pipeline Result Viewer - Reduce Result Display Tests', () => {
    // Sample execution stats for testing
    const baseExecutionStats: ExecutionStats = {
        totalItems: 5,
        successfulMaps: 5,
        failedMaps: 0,
        mapPhaseTimeMs: 4000,
        reducePhaseTimeMs: 1000,
        maxConcurrency: 3
    };

    test('getReduceResultSection returns empty string when no reduce output', () => {
        const viewData: PipelineResultViewData = {
            pipelineName: 'Test',
            packageName: 'test-pkg',
            success: true,
            totalTimeMs: 1000,
            executionStats: baseExecutionStats,
            itemResults: [],
            completedAt: new Date()
        };

        const html = getReduceResultSection(viewData);
        assert.strictEqual(html, '', 'Should return empty string when no output');
    });

    test('getReduceResultSection shows AI Reduce Result for AI reduce', () => {
        const viewData: PipelineResultViewData = {
            pipelineName: 'AI Test',
            packageName: 'ai-pkg',
            success: true,
            totalTimeMs: 5000,
            executionStats: baseExecutionStats,
            reduceStats: {
                inputCount: 5,
                outputCount: 1,
                mergedCount: 5,
                reduceTimeMs: 1000,
                usedAIReduce: true
            },
            output: {
                results: [],
                formattedOutput: '{"summary": "AI result"}',
                summary: { totalItems: 5, successfulItems: 5, failedItems: 0, outputFields: ['summary'] }
            },
            itemResults: [],
            completedAt: new Date()
        };

        const html = getReduceResultSection(viewData);
        assert.ok(html.includes('AI Reduce Result'), 'Should show AI Reduce Result title');
        assert.ok(html.includes('🤖'), 'Should have robot emoji for AI reduce');
        assert.ok(html.includes('reduce-section'), 'Should have reduce-section class');
    });

    test('getReduceResultSection shows Reduce Result for deterministic reduce', () => {
        const viewData: PipelineResultViewData = {
            pipelineName: 'List Test',
            packageName: 'list-pkg',
            success: true,
            totalTimeMs: 3000,
            executionStats: baseExecutionStats,
            reduceStats: {
                inputCount: 5,
                outputCount: 5,
                mergedCount: 0,
                reduceTimeMs: 500,
                usedAIReduce: false
            },
            output: {
                results: [],
                formattedOutput: '## Results\n...',
                summary: { totalItems: 5, successfulItems: 5, failedItems: 0, outputFields: [] }
            },
            itemResults: [],
            completedAt: new Date()
        };

        const html = getReduceResultSection(viewData);
        assert.ok(html.includes('Reduce Result'), 'Should show Reduce Result title');
        assert.ok(html.includes('📋'), 'Should have clipboard emoji for deterministic reduce');
        assert.ok(!html.includes('AI Reduce'), 'Should NOT have AI Reduce text');
    });

    test('getReduceResultSection displays reduce stats', () => {
        const viewData: PipelineResultViewData = {
            pipelineName: 'Stats Test',
            packageName: 'stats-pkg',
            success: true,
            totalTimeMs: 5000,
            executionStats: baseExecutionStats,
            reduceStats: {
                inputCount: 10,
                outputCount: 1,
                mergedCount: 10,
                reduceTimeMs: 2500,
                usedAIReduce: true
            },
            output: {
                results: [],
                formattedOutput: '{"data": "test"}',
                summary: { totalItems: 10, successfulItems: 10, failedItems: 0, outputFields: [] }
            },
            itemResults: [],
            completedAt: new Date()
        };

        const html = getReduceResultSection(viewData);
        assert.ok(html.includes('Inputs:'), 'Should show Inputs label');
        assert.ok(html.includes('10'), 'Should show input count');
        assert.ok(html.includes('Merged:'), 'Should show Merged label');
        assert.ok(html.includes('Duration:'), 'Should show Duration label');
        assert.ok(html.includes('2.5s'), 'Should show formatted duration');
    });

    test('getReduceResultSection displays formatted output', () => {
        const viewData: PipelineResultViewData = {
            pipelineName: 'Output Test',
            packageName: 'output-pkg',
            success: true,
            totalTimeMs: 3000,
            executionStats: baseExecutionStats,
            reduceStats: {
                inputCount: 3,
                outputCount: 1,
                mergedCount: 3,
                reduceTimeMs: 1000,
                usedAIReduce: true
            },
            output: {
                results: [],
                formattedOutput: '{"summary": "All tasks completed", "count": 3}',
                summary: { totalItems: 3, successfulItems: 3, failedItems: 0, outputFields: ['summary', 'count'] }
            },
            itemResults: [],
            completedAt: new Date()
        };

        const html = getReduceResultSection(viewData);
        assert.ok(html.includes('reduce-output'), 'Should have reduce-output class');
        assert.ok(html.includes('reduce-output-content'), 'Should have reduce-output-content class');
        assert.ok(html.includes('All tasks completed'), 'Should show formatted output content');
    });

    test('getReduceResultSection pretty-prints JSON output', () => {
        const viewData: PipelineResultViewData = {
            pipelineName: 'Pretty Print Test',
            packageName: 'pretty-pkg',
            success: true,
            totalTimeMs: 3000,
            executionStats: baseExecutionStats,
            reduceStats: {
                inputCount: 2,
                outputCount: 1,
                mergedCount: 2,
                reduceTimeMs: 1000,
                usedAIReduce: true
            },
            output: {
                results: [],
                // Compact JSON input
                formattedOutput: '{"summary":"Test result","items":["a","b"]}',
                summary: { totalItems: 2, successfulItems: 2, failedItems: 0, outputFields: ['summary', 'items'] }
            },
            itemResults: [],
            completedAt: new Date()
        };

        const html = getReduceResultSection(viewData);
        // Should contain indented JSON (check for newline followed by spaces)
        assert.ok(html.includes('&quot;summary&quot;'), 'Should have summary key');
        // Pretty-printed JSON should have the value on same line or properly formatted
        assert.ok(html.includes('Test result'), 'Should show value');
    });

    test('getReduceResultSection escapes HTML in output', () => {
        const viewData: PipelineResultViewData = {
            pipelineName: 'XSS Test',
            packageName: 'xss-pkg',
            success: true,
            totalTimeMs: 2000,
            executionStats: baseExecutionStats,
            reduceStats: {
                inputCount: 1,
                outputCount: 1,
                mergedCount: 1,
                reduceTimeMs: 500,
                usedAIReduce: true
            },
            output: {
                results: [],
                formattedOutput: '{"message": "<script>alert(1)</script>"}',
                summary: { totalItems: 1, successfulItems: 1, failedItems: 0, outputFields: ['message'] }
            },
            itemResults: [],
            completedAt: new Date()
        };

        const html = getReduceResultSection(viewData);
        assert.ok(html.includes('&lt;script&gt;'), 'Should escape HTML in output');
        assert.ok(!html.includes('<script>alert'), 'Should NOT have unescaped script tag');
    });

    test('getReduceResultSection shows output without reduceStats', () => {
        // This tests the case where there's output but no reduceStats (backwards compatibility)
        const viewData: PipelineResultViewData = {
            pipelineName: 'No Stats Test',
            packageName: 'nostats-pkg',
            success: true,
            totalTimeMs: 2000,
            executionStats: baseExecutionStats,
            // No reduceStats
            output: {
                results: [],
                formattedOutput: '## Simple formatted output',
                summary: { totalItems: 2, successfulItems: 2, failedItems: 0, outputFields: [] }
            },
            itemResults: [],
            completedAt: new Date()
        };

        const html = getReduceResultSection(viewData);
        assert.ok(html.includes('Reduce Result'), 'Should show section even without reduceStats');
        assert.ok(html.includes('Simple formatted output'), 'Should show formatted output');
        assert.ok(!html.includes('reduce-stats'), 'Should NOT show stats section');
    });

    test('PipelineResultViewData should support reduceStats', () => {
        const viewData: PipelineResultViewData = {
            pipelineName: 'Test Pipeline',
            packageName: 'test-pkg',
            success: true,
            totalTimeMs: 5000,
            executionStats: {
                totalItems: 5,
                successfulMaps: 5,
                failedMaps: 0,
                mapPhaseTimeMs: 4000,
                reducePhaseTimeMs: 1000,
                maxConcurrency: 3
            },
            reduceStats: {
                inputCount: 5,
                outputCount: 1,
                mergedCount: 5,
                reduceTimeMs: 1000,
                usedAIReduce: true
            },
            output: {
                results: [],
                formattedOutput: '{"summary": "AI synthesized result", "priorities": ["P1", "P2"]}',
                summary: {
                    totalItems: 5,
                    successfulItems: 5,
                    failedItems: 0,
                    outputFields: ['summary', 'priorities']
                }
            },
            itemResults: [],
            completedAt: new Date()
        };

        assert.ok(viewData.reduceStats, 'Should have reduceStats');
        assert.strictEqual(viewData.reduceStats.usedAIReduce, true, 'Should have usedAIReduce flag');
        assert.strictEqual(viewData.reduceStats.inputCount, 5, 'Should have inputCount');
        assert.strictEqual(viewData.reduceStats.mergedCount, 5, 'Should have mergedCount');
    });

    test('PipelineResultViewData should work without reduceStats', () => {
        const viewData: PipelineResultViewData = {
            pipelineName: 'Simple Pipeline',
            packageName: 'simple-pkg',
            success: true,
            totalTimeMs: 2000,
            executionStats: {
                totalItems: 2,
                successfulMaps: 2,
                failedMaps: 0,
                mapPhaseTimeMs: 1500,
                reducePhaseTimeMs: 500,
                maxConcurrency: 2
            },
            itemResults: [],
            completedAt: new Date()
        };

        assert.strictEqual(viewData.reduceStats, undefined, 'reduceStats should be optional');
    });

    test('PipelineResultViewData should support formattedOutput for deterministic reduce', () => {
        const viewData: PipelineResultViewData = {
            pipelineName: 'List Pipeline',
            packageName: 'list-pkg',
            success: true,
            totalTimeMs: 3000,
            executionStats: {
                totalItems: 3,
                successfulMaps: 3,
                failedMaps: 0,
                mapPhaseTimeMs: 2500,
                reducePhaseTimeMs: 500,
                maxConcurrency: 3
            },
            reduceStats: {
                inputCount: 3,
                outputCount: 3,
                mergedCount: 0,
                reduceTimeMs: 500,
                usedAIReduce: false
            },
            output: {
                results: [],
                formattedOutput: '## Results (3 items)\n\n### Item 1\n...',
                summary: {
                    totalItems: 3,
                    successfulItems: 3,
                    failedItems: 0,
                    outputFields: ['status']
                }
            },
            itemResults: [],
            completedAt: new Date()
        };

        assert.ok(viewData.output, 'Should have output');
        assert.ok(viewData.output.formattedOutput, 'Should have formattedOutput');
        assert.strictEqual(viewData.reduceStats?.usedAIReduce, false, 'Should not be AI reduce');
    });

    test('reduceStats should have all required fields for AI reduce', () => {
        const reduceStats = {
            inputCount: 10,
            outputCount: 1,
            mergedCount: 10,
            reduceTimeMs: 2500,
            usedAIReduce: true
        };

        assert.strictEqual(typeof reduceStats.inputCount, 'number');
        assert.strictEqual(typeof reduceStats.outputCount, 'number');
        assert.strictEqual(typeof reduceStats.mergedCount, 'number');
        assert.strictEqual(typeof reduceStats.reduceTimeMs, 'number');
        assert.strictEqual(typeof reduceStats.usedAIReduce, 'boolean');
    });

    test('formattedOutput should contain AI reduce result', () => {
        const aiReduceOutput = {
            summary: 'All bugs analyzed and categorized',
            topPriorities: ['Fix login', 'Update API'],
            riskLevel: 'medium'
        };

        const formattedOutput = JSON.stringify(aiReduceOutput, null, 2);

        assert.ok(formattedOutput.includes('summary'));
        assert.ok(formattedOutput.includes('topPriorities'));
        assert.ok(formattedOutput.includes('Fix login'));
    });

    test('should handle empty formattedOutput gracefully', () => {
        const viewData: PipelineResultViewData = {
            pipelineName: 'Empty Output Pipeline',
            packageName: 'empty-pkg',
            success: true,
            totalTimeMs: 1000,
            executionStats: {
                totalItems: 0,
                successfulMaps: 0,
                failedMaps: 0,
                mapPhaseTimeMs: 0,
                reducePhaseTimeMs: 0,
                maxConcurrency: 1
            },
            output: {
                results: [],
                formattedOutput: '',
                summary: {
                    totalItems: 0,
                    successfulItems: 0,
                    failedItems: 0,
                    outputFields: []
                }
            },
            itemResults: [],
            completedAt: new Date()
        };

        assert.strictEqual(viewData.output?.formattedOutput, '');
    });

    test('should preserve complex JSON structure in formattedOutput', () => {
        const complexOutput = {
            analysis: {
                bugs: [
                    { id: 1, severity: 'high' },
                    { id: 2, severity: 'low' }
                ],
                recommendations: ['Increase coverage', 'Add logging']
            },
            metadata: {
                processedAt: '2024-01-15T10:00:00Z',
                version: '1.0'
            }
        };

        const formattedOutput = JSON.stringify(complexOutput, null, 2);

        // Parse back to verify structure preserved
        const parsed = JSON.parse(formattedOutput);
        assert.strictEqual(parsed.analysis.bugs.length, 2);
        assert.strictEqual(parsed.analysis.bugs[0].severity, 'high');
    });
});

suite('Pipeline Result Viewer - Retry Functionality Tests', () => {
    // Sample execution stats for testing
    const baseExecutionStats: ExecutionStats = {
        totalItems: 5,
        successfulMaps: 3,
        failedMaps: 2,
        mapPhaseTimeMs: 4000,
        reducePhaseTimeMs: 1000,
        maxConcurrency: 3
    };

    test('PipelineItemResultNode should support retry-related fields', () => {
        const nodeWithRetry: PipelineItemResultNode = {
            id: 'item-0',
            index: 0,
            input: { id: '1', title: 'Test' },
            output: { result: 'success' },
            success: true,
            retryCount: 2,
            originalError: 'Connection timeout',
            retriedAt: new Date('2024-01-15T10:30:00Z'),
            executionTimeMs: 1500
        };

        assert.strictEqual(nodeWithRetry.retryCount, 2);
        assert.strictEqual(nodeWithRetry.originalError, 'Connection timeout');
        assert.ok(nodeWithRetry.retriedAt instanceof Date);
    });

    test('PipelineItemResultNode retry fields should be optional', () => {
        const nodeWithoutRetry: PipelineItemResultNode = {
            id: 'item-0',
            index: 0,
            input: { id: '1', title: 'Test' },
            output: { result: 'success' },
            success: true
        };

        assert.strictEqual(nodeWithoutRetry.retryCount, undefined);
        assert.strictEqual(nodeWithoutRetry.originalError, undefined);
        assert.strictEqual(nodeWithoutRetry.retriedAt, undefined);
    });

    test('PipelineResultViewData should support pipelineConfig for retry', () => {
        const viewData: PipelineResultViewData = {
            pipelineName: 'Test Pipeline',
            packageName: 'test-pkg',
            success: false,
            totalTimeMs: 5000,
            executionStats: baseExecutionStats,
            itemResults: [],
            completedAt: new Date(),
            pipelineConfig: {
                name: 'Test Pipeline',
                input: { items: [{ id: '1' }] },
                map: { prompt: 'Test {{id}}', output: ['result'], parallel: 5 },
                reduce: { type: 'json' }
            },
            pipelineDirectory: '/path/to/pipeline'
        };

        assert.ok(viewData.pipelineConfig);
        assert.strictEqual(viewData.pipelineConfig.name, 'Test Pipeline');
        assert.strictEqual(viewData.pipelineDirectory, '/path/to/pipeline');
    });

    test('PipelineResultViewData should support lastRetryAt timestamp', () => {
        const viewData: PipelineResultViewData = {
            pipelineName: 'Test Pipeline',
            packageName: 'test-pkg',
            success: true,
            totalTimeMs: 5000,
            executionStats: baseExecutionStats,
            itemResults: [],
            completedAt: new Date('2024-01-15T10:00:00Z'),
            lastRetryAt: new Date('2024-01-15T10:30:00Z')
        };

        assert.ok(viewData.lastRetryAt);
        assert.ok(viewData.lastRetryAt > viewData.completedAt);
    });

    test('getItemDetailContent should show retry information for retried items', () => {
        const retriedNode: PipelineItemResultNode = {
            id: 'item-0',
            index: 0,
            input: { id: '1', title: 'Test Bug' },
            output: { severity: 'high' },
            success: true,
            retryCount: 1,
            originalError: 'Connection timeout after 600000ms',
            retriedAt: new Date('2024-01-15T10:30:00Z'),
            executionTimeMs: 2500
        };

        const html = getItemDetailContent(retriedNode);

        // Should show retry info section
        assert.ok(html.includes('Retry Information'), 'Should show retry info section');
        assert.ok(html.includes('🔄'), 'Should have retry emoji');
        assert.ok(html.includes('Succeeded (after retry)'), 'Should show success after retry');
        assert.ok(html.includes('Original Error'), 'Should show original error');
        assert.ok(html.includes('Connection timeout'), 'Should show original error message');
        assert.ok(html.includes('Retry Attempts'), 'Should show retry count');
        assert.ok(html.includes('retry-badge-large'), 'Should have retry badge');
    });

    test('getItemDetailContent should show retry failed state', () => {
        const stillFailedNode: PipelineItemResultNode = {
            id: 'item-1',
            index: 1,
            input: { id: '2', title: 'Failing Bug' },
            output: {},
            success: false,
            error: 'Rate limit exceeded',
            retryCount: 2,
            originalError: 'Connection timeout',
            retriedAt: new Date('2024-01-15T10:30:00Z'),
            executionTimeMs: 500
        };

        const html = getItemDetailContent(stillFailedNode);

        // Should show retry info with failed state
        assert.ok(html.includes('Retry Information'), 'Should show retry info section');
        assert.ok(html.includes('Still failed'), 'Should show still failed status');
        assert.ok(html.includes('Original Error'), 'Should show original error');
        assert.ok(html.includes('Connection timeout'), 'Should show original error');
        assert.ok(html.includes('Rate limit exceeded'), 'Should show current error');
    });

    test('getItemDetailContent should not show retry info for non-retried items', () => {
        const normalNode: PipelineItemResultNode = {
            id: 'item-0',
            index: 0,
            input: { id: '1', title: 'Normal Bug' },
            output: { severity: 'low' },
            success: true,
            executionTimeMs: 1000
        };

        const html = getItemDetailContent(normalNode);

        assert.ok(!html.includes('Retry Information'), 'Should not show retry info');
        assert.ok(!html.includes('retry-badge-large'), 'Should not have retry badge');
    });

    test('mapResultToNode should preserve retry fields', () => {
        const resultWithRetry: PromptMapResult = {
            item: { id: '1', title: 'Test' },
            output: { result: 'ok' },
            success: true,
            rawResponse: '{"result": "ok"}'
        };

        const node = mapResultToNode(resultWithRetry, 0, 1500);

        // Default values - no retry info
        assert.strictEqual(node.retryCount, undefined);
        assert.strictEqual(node.originalError, undefined);
        assert.strictEqual(node.retriedAt, undefined);
    });

    test('should calculate correct statistics after retry', () => {
        const itemResults: PipelineItemResultNode[] = [
            { id: 'item-0', index: 0, input: {}, output: {}, success: true },
            { id: 'item-1', index: 1, input: {}, output: {}, success: true, retryCount: 1, originalError: 'Timeout' },
            { id: 'item-2', index: 2, input: {}, output: {}, success: false, error: 'Still failing', retryCount: 2 },
            { id: 'item-3', index: 3, input: {}, output: {}, success: true },
            { id: 'item-4', index: 4, input: {}, output: {}, success: false, error: 'New failure' }
        ];

        const successCount = itemResults.filter(r => r.success).length;
        const failedCount = itemResults.filter(r => !r.success).length;
        const retriedCount = itemResults.filter(r => r.retryCount && r.retryCount > 0).length;
        const retriedSuccessCount = itemResults.filter(r => r.success && r.retryCount && r.retryCount > 0).length;

        assert.strictEqual(successCount, 3, 'Should have 3 successful items');
        assert.strictEqual(failedCount, 2, 'Should have 2 failed items');
        assert.strictEqual(retriedCount, 2, 'Should have 2 retried items');
        assert.strictEqual(retriedSuccessCount, 1, 'Should have 1 item that succeeded after retry');
    });

    test('should track max retry attempts correctly', () => {
        const itemsAtMaxRetry: PipelineItemResultNode[] = [
            { id: 'item-0', index: 0, input: {}, output: {}, success: false, error: 'Error', retryCount: 2 },
            { id: 'item-1', index: 1, input: {}, output: {}, success: false, error: 'Error', retryCount: 1 },
            { id: 'item-2', index: 2, input: {}, output: {}, success: false, error: 'Error' }
        ];

        const maxRetryAttempts = 2;
        
        // Items that can still be retried
        const canRetry = itemsAtMaxRetry.filter(r => 
            !r.success && (r.retryCount ?? 0) < maxRetryAttempts
        );

        assert.strictEqual(canRetry.length, 2, 'Should have 2 items that can still be retried');
        assert.ok(canRetry.some(r => r.id === 'item-1'), 'item-1 should be retryable');
        assert.ok(canRetry.some(r => r.id === 'item-2'), 'item-2 should be retryable');
        assert.ok(!canRetry.some(r => r.id === 'item-0'), 'item-0 should not be retryable (max attempts)');
    });

    test('should handle empty retry scenario', () => {
        const allSuccessful: PipelineItemResultNode[] = [
            { id: 'item-0', index: 0, input: {}, output: {}, success: true },
            { id: 'item-1', index: 1, input: {}, output: {}, success: true },
            { id: 'item-2', index: 2, input: {}, output: {}, success: true }
        ];

        const failedItems = allSuccessful.filter(r => !r.success);
        assert.strictEqual(failedItems.length, 0, 'Should have no failed items to retry');
    });

    test('should preserve original error through multiple retries', () => {
        const multiRetryNode: PipelineItemResultNode = {
            id: 'item-0',
            index: 0,
            input: { id: '1' },
            output: {},
            success: false,
            error: 'Third attempt: Rate limit exceeded',
            retryCount: 3,
            originalError: 'First attempt: Connection timeout',
            retriedAt: new Date()
        };

        // Original error should be preserved from first failure
        assert.strictEqual(multiRetryNode.originalError, 'First attempt: Connection timeout');
        // Current error should reflect latest attempt
        assert.strictEqual(multiRetryNode.error, 'Third attempt: Rate limit exceeded');
        // Retry count should reflect total attempts
        assert.strictEqual(multiRetryNode.retryCount, 3);
    });

    test('should handle retry with different error types', () => {
        const errorTypes = [
            'Connection timeout after 600000ms',
            'Rate limit exceeded',
            'AI service unavailable',
            'Failed to parse AI response: Unexpected token',
            'Network error: ECONNREFUSED'
        ];

        errorTypes.forEach((error, index) => {
            const node: PipelineItemResultNode = {
                id: `item-${index}`,
                index,
                input: { id: String(index) },
                output: {},
                success: false,
                error,
                retryCount: 1,
                originalError: 'Initial error'
            };

            const html = getItemDetailContent(node);
            assert.ok(html.includes('Retry Information'), `Should show retry info for error: ${error}`);
            assert.ok(html.includes('Still failed'), `Should show failed status for error: ${error}`);
        });
    });

    test('PipelineResultViewData pipelineConfig should be optional', () => {
        const viewDataWithoutConfig: PipelineResultViewData = {
            pipelineName: 'Test Pipeline',
            packageName: 'test-pkg',
            success: true,
            totalTimeMs: 5000,
            executionStats: baseExecutionStats,
            itemResults: [],
            completedAt: new Date()
        };

        assert.strictEqual(viewDataWithoutConfig.pipelineConfig, undefined);
        assert.strictEqual(viewDataWithoutConfig.pipelineDirectory, undefined);
    });
});
