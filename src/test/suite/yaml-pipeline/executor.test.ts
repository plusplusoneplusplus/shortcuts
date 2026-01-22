/**
 * Tests for Pipeline Executor
 *
 * Comprehensive tests for pipeline execution using the map-reduce framework.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    DEFAULT_PARALLEL_LIMIT,
    executePipeline,
    executePipelineWithItems,
    parsePipelineYAML,
    parsePipelineYAMLSync,
    PipelineExecutionError
} from '../../../shortcuts/yaml-pipeline/executor';
import {
    AIInvokerResult,
    JobProgress,
    PipelineConfig,
    isCSVSource
} from '../../../shortcuts/yaml-pipeline/types';

suite('Pipeline Executor', () => {
    let tempDir: string;

    setup(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pipeline-test-'));
    });

    teardown(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    // Helper to create a mock AI invoker
    function createMockAIInvoker(
        responses: Map<string, string> | ((prompt: string, options?: { model?: string }) => AIInvokerResult)
    ): (prompt: string, options?: { model?: string }) => Promise<AIInvokerResult> {
        return async (prompt: string, options?: { model?: string }): Promise<AIInvokerResult> => {
            if (typeof responses === 'function') {
                return responses(prompt, options);
            }

            // Look for matching response based on content
            for (const [key, response] of responses) {
                if (prompt.includes(key)) {
                    return { success: true, response };
                }
            }

            return { success: true, response: '{"result": "default"}' };
        };
    }

    // Helper to create test CSV
    async function createTestCSV(filename: string, content: string): Promise<string> {
        const filePath = path.join(tempDir, filename);
        await fs.promises.writeFile(filePath, content);
        return filePath;
    }

    suite('executePipeline - inline items', () => {
        test('executes pipeline with inline items successfully', async () => {
            const config: PipelineConfig = {
                name: 'Test Pipeline',
                input: {
                    items: [
                        { id: '1', title: 'Bug A' },
                        { id: '2', title: 'Bug B' }
                    ]
                },
                map: {
                    prompt: 'Analyze: {{title}}',
                    output: ['severity']
                },
                reduce: { type: 'list' }
            };

            const responses = new Map([
                ['Bug A', '{"severity": "high"}'],
                ['Bug B', '{"severity": "low"}']
            ]);

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(responses),
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.ok(result.output);
            assert.strictEqual(result.output.results.length, 2);

            assert.strictEqual(result.output.results[0].success, true);
            assert.strictEqual(result.output.results[0].output.severity, 'high');

            assert.strictEqual(result.output.results[1].success, true);
            assert.strictEqual(result.output.results[1].output.severity, 'low');
        });

        test('handles empty inline items', async () => {
            const config: PipelineConfig = {
                name: 'Empty Test',
                input: { items: [] },
                map: { prompt: '{{title}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(new Map()),
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.executionStats.totalItems, 0);
        });

        test('applies limit to inline items', async () => {
            const config: PipelineConfig = {
                name: 'Limit Test',
                input: {
                    items: [
                        { id: '1', title: 'Item 1' },
                        { id: '2', title: 'Item 2' },
                        { id: '3', title: 'Item 3' },
                        { id: '4', title: 'Item 4' },
                        { id: '5', title: 'Item 5' }
                    ],
                    limit: 2
                },
                map: { prompt: '{{title}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(new Map()),
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.executionStats.totalItems, 2);
            assert.ok(result.output);
            assert.strictEqual(result.output.results.length, 2);
            assert.strictEqual(result.output.results[0].item.title, 'Item 1');
            assert.strictEqual(result.output.results[1].item.title, 'Item 2');
        });

        test('handles multiple output fields with inline items', async () => {
            const config: PipelineConfig = {
                name: 'Multi-output Test',
                input: {
                    items: [
                        { id: '1', title: 'Bug', description: 'Something broke' }
                    ]
                },
                map: {
                    prompt: 'Title: {{title}}\nDescription: {{description}}',
                    output: ['severity', 'category', 'effort_hours', 'needs_more_info']
                },
                reduce: { type: 'list' }
            };

            const aiInvoker = async (): Promise<AIInvokerResult> => ({
                success: true,
                response: '{"severity": "high", "category": "backend", "effort_hours": 4, "needs_more_info": false}'
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.ok(result.output);
            assert.deepStrictEqual(result.output.results[0].output, {
                severity: 'high',
                category: 'backend',
                effort_hours: 4,
                needs_more_info: false
            });
        });

        test('validates inline items have required template variables', async () => {
            const config: PipelineConfig = {
                name: 'Validation Test',
                input: {
                    items: [
                        { id: '1', name: 'Test' }  // Missing 'title' field
                    ]
                },
                map: { prompt: '{{title}} {{description}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                /missing required fields.*title.*description/i
            );
        });

        test('passes model to AI invoker from map config', async () => {
            const config: PipelineConfig = {
                name: 'Model Test',
                input: {
                    items: [{ id: '1', title: 'Test Item' }]
                },
                map: {
                    prompt: 'Analyze: {{title}}',
                    output: ['result'],
                    model: 'gpt-4'
                },
                reduce: { type: 'list' }
            };

            let receivedModel: string | undefined;

            const aiInvoker = async (_prompt: string, options?: { model?: string }): Promise<AIInvokerResult> => {
                receivedModel = options?.model;
                return { success: true, response: '{"result": "ok"}' };
            };

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(receivedModel, 'gpt-4');
        });

        test('does not pass model if not specified in config', async () => {
            const config: PipelineConfig = {
                name: 'No Model Test',
                input: {
                    items: [{ id: '1', title: 'Test Item' }]
                },
                map: {
                    prompt: 'Analyze: {{title}}',
                    output: ['result']
                    // No model specified
                },
                reduce: { type: 'list' }
            };

            let receivedModel: string | undefined = 'should-be-undefined';

            const aiInvoker = async (_prompt: string, options?: { model?: string }): Promise<AIInvokerResult> => {
                receivedModel = options?.model;
                return { success: true, response: '{"result": "ok"}' };
            };

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(receivedModel, undefined);
        });

        test('uses custom timeout from map config', async () => {
            const config: PipelineConfig = {
                name: 'Timeout Test',
                input: {
                    items: [{ id: '1', title: 'Test Item' }]
                },
                map: {
                    prompt: 'Analyze: {{title}}',
                    output: ['result'],
                    timeoutMs: 50 // Very short timeout to trigger timeout
                },
                reduce: { type: 'list' }
            };

            const aiInvoker = async (): Promise<AIInvokerResult> => {
                // Simulate a slow AI response that exceeds both initial timeout (50ms) 
                // and doubled retry timeout (100ms)
                await new Promise(resolve => setTimeout(resolve, 500));
                return { success: true, response: '{"result": "ok"}' };
            };

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            // When a timeout occurs (after retry with doubled timeout), the overall job is marked as failed
            assert.strictEqual(result.success, false);
            assert.strictEqual(result.executionStats.failedMaps, 1);
            assert.ok(result.mapResults);
            assert.ok(result.mapResults[0].error?.includes('timed out'), 'Error should mention timeout');
        });

        test('timeout retry succeeds with doubled timeout', async () => {
            let attemptCount = 0;

            const config: PipelineConfig = {
                name: 'Timeout Retry Test',
                input: {
                    items: [{ id: '1', title: 'Test Item' }]
                },
                map: {
                    prompt: 'Analyze: {{title}}',
                    output: ['result'],
                    timeoutMs: 50 // First timeout at 50ms, retry at 100ms
                },
                reduce: { type: 'list' }
            };

            const aiInvoker = async (): Promise<AIInvokerResult> => {
                attemptCount++;
                // 75ms delay: will timeout on first attempt (50ms) but succeed on retry (100ms)
                await new Promise(resolve => setTimeout(resolve, 75));
                return { success: true, response: '{"result": "ok"}' };
            };

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            // Should succeed on retry with doubled timeout
            assert.strictEqual(result.success, true);
            assert.strictEqual(attemptCount, 2, 'Should have attempted twice (initial + timeout retry)');
            assert.ok(result.output);
            assert.strictEqual(result.output.results[0].success, true);
        });

        test('uses default timeout (10 minutes) when not specified', async () => {
            const config: PipelineConfig = {
                name: 'Default Timeout Test',
                input: {
                    items: [{ id: '1', title: 'Test Item' }]
                },
                map: {
                    prompt: 'Analyze: {{title}}',
                    output: ['result']
                    // No timeout specified - should default to 600000ms (10 minutes)
                },
                reduce: { type: 'list' }
            };

            const aiInvoker = async (): Promise<AIInvokerResult> => {
                // Simulate a reasonably fast response
                await new Promise(resolve => setTimeout(resolve, 10));
                return { success: true, response: '{"result": "ok"}' };
            };

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            // Should succeed with default timeout
            assert.strictEqual(result.success, true);
            assert.ok(result.output);
            assert.strictEqual(result.output.results[0].success, true);
        });
    });

    suite('executePipeline - CSV from file', () => {
        test('executes simple pipeline successfully', async () => {
            await createTestCSV('data.csv', 'id,title\n1,Bug A\n2,Bug B');

            const config: PipelineConfig = {
                name: 'Test Pipeline',
                input: { from: { type: 'csv', path: './data.csv' } },
                map: {
                    prompt: 'Analyze: {{title}}',
                    output: ['severity']
                },
                reduce: { type: 'list' }
            };

            const responses = new Map([
                ['Bug A', '{"severity": "high"}'],
                ['Bug B', '{"severity": "low"}']
            ]);

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(responses),
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.ok(result.output);
            assert.strictEqual(result.output.results.length, 2);

            assert.strictEqual(result.output.results[0].success, true);
            assert.strictEqual(result.output.results[0].output.severity, 'high');

            assert.strictEqual(result.output.results[1].success, true);
            assert.strictEqual(result.output.results[1].output.severity, 'low');
        });

        test('handles empty CSV', async () => {
            await createTestCSV('empty.csv', 'id,title');

            const config: PipelineConfig = {
                name: 'Empty Test',
                input: { from: { type: 'csv', path: './empty.csv' } },
                map: { prompt: '{{title}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(new Map()),
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.executionStats.totalItems, 0);
        });

        test('applies limit to CSV items', async () => {
            await createTestCSV('data.csv', 'id,title\n1,A\n2,B\n3,C\n4,D\n5,E');

            const config: PipelineConfig = {
                name: 'Limit Test',
                input: {
                    from: { type: 'csv', path: './data.csv' },
                    limit: 3
                },
                map: { prompt: '{{title}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(new Map()),
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.executionStats.totalItems, 3);
            assert.ok(result.output);
            assert.strictEqual(result.output.results.length, 3);
        });

        test('handles AI failures gracefully', async () => {
            await createTestCSV('data.csv', 'id,title\n1,Good\n2,Bad');

            const config: PipelineConfig = {
                name: 'Failure Test',
                input: { from: { type: 'csv', path: './data.csv' } },
                map: { prompt: '{{title}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const aiInvoker = async (prompt: string): Promise<AIInvokerResult> => {
                if (prompt.includes('Bad')) {
                    return { success: false, error: 'AI service unavailable' };
                }
                return { success: true, response: '{"result": "ok"}' };
            };

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            // The executor considers the job successful if all map operations completed
            // (even if some returned failure results). Individual failures are tracked
            // in the output results.
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.executionStats.successfulMaps, 2); // Both maps completed
            assert.strictEqual(result.executionStats.failedMaps, 0); // No map operations threw

            assert.ok(result.output);
            assert.strictEqual(result.output.results[0].success, true);
            assert.strictEqual(result.output.results[1].success, false); // AI failure tracked in result
            assert.ok(result.output.results[1].error?.includes('AI service unavailable'));
        });

        test('handles JSON parse failures', async () => {
            await createTestCSV('data.csv', 'id,title\n1,Test');

            const config: PipelineConfig = {
                name: 'Parse Failure Test',
                input: { from: { type: 'csv', path: './data.csv' } },
                map: { prompt: '{{title}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const aiInvoker = async (): Promise<AIInvokerResult> => {
                return { success: true, response: 'This is not JSON at all!' };
            };

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            // The executor considers the job successful if all map operations completed
            // Parse failures are tracked in individual results, not as map failures
            assert.strictEqual(result.success, true);
            assert.ok(result.output);
            assert.strictEqual(result.output.results[0].success, false);
            assert.ok(result.output.results[0].error?.includes('parse'));
        });

        test('respects parallel limit', async () => {
            // Create CSV with many rows
            const rows = Array.from({ length: 10 }, (_, i) => `${i},Item${i}`).join('\n');
            await createTestCSV('data.csv', `id,title\n${rows}`);

            const config: PipelineConfig = {
                name: 'Parallel Test',
                input: { from: { type: 'csv', path: './data.csv' } },
                map: {
                    prompt: '{{title}}',
                    output: ['result'],
                    parallel: 2 // Limit to 2 concurrent
                },
                reduce: { type: 'list' }
            };

            let maxConcurrent = 0;
            let currentConcurrent = 0;

            const aiInvoker = async (): Promise<AIInvokerResult> => {
                currentConcurrent++;
                maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

                // Simulate some work
                await new Promise(resolve => setTimeout(resolve, 10));

                currentConcurrent--;
                return { success: true, response: '{"result": "ok"}' };
            };

            await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.ok(maxConcurrent <= 2, `Max concurrent was ${maxConcurrent}, expected <= 2`);
        });

        test('reports progress during execution', async () => {
            await createTestCSV('data.csv', 'id,title\n1,A\n2,B\n3,C');

            const config: PipelineConfig = {
                name: 'Progress Test',
                input: { from: { type: 'csv', path: './data.csv' } },
                map: { prompt: '{{title}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const progressUpdates: JobProgress[] = [];

            await executePipeline(config, {
                aiInvoker: createMockAIInvoker(new Map()),
                pipelineDirectory: tempDir,
                onProgress: (progress) => progressUpdates.push({ ...progress })
            });

            // Verify progress updates were received
            assert.ok(progressUpdates.length > 0, 'Should have progress updates');

            // Verify final progress
            const finalProgress = progressUpdates[progressUpdates.length - 1];
            assert.strictEqual(finalProgress.percentage, 100);
        });

        test('handles multiple output fields', async () => {
            await createTestCSV('data.csv', 'id,title,description\n1,Bug,Something broke');

            const config: PipelineConfig = {
                name: 'Multi-output Test',
                input: { from: { type: 'csv', path: './data.csv' } },
                map: {
                    prompt: 'Title: {{title}}\nDescription: {{description}}',
                    output: ['severity', 'category', 'effort_hours', 'needs_more_info']
                },
                reduce: { type: 'list' }
            };

            const aiInvoker = async (): Promise<AIInvokerResult> => ({
                success: true,
                response: '{"severity": "high", "category": "backend", "effort_hours": 4, "needs_more_info": false}'
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.ok(result.output);
            assert.deepStrictEqual(result.output.results[0].output, {
                severity: 'high',
                category: 'backend',
                effort_hours: 4,
                needs_more_info: false
            });
        });

        test('uses custom delimiter', async () => {
            await createTestCSV('data.csv', 'id;title;value\n1;Test;100');

            const config: PipelineConfig = {
                name: 'Delimiter Test',
                input: { from: { type: 'csv', path: './data.csv', delimiter: ';' } },
                map: { prompt: '{{title}} {{value}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(new Map([['Test 100', '{"result": "ok"}']])),
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.ok(result.output);
            assert.strictEqual(result.output.results[0].item.title, 'Test');
            assert.strictEqual(result.output.results[0].item.value, '100');
        });

        test('records execution statistics', async () => {
            await createTestCSV('data.csv', 'id,title\n1,A\n2,B\n3,C');

            const config: PipelineConfig = {
                name: 'Stats Test',
                input: { from: { type: 'csv', path: './data.csv' } },
                map: { prompt: '{{title}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(new Map()),
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.executionStats.totalItems, 3);
            assert.strictEqual(result.executionStats.successfulMaps, 3);
            assert.strictEqual(result.executionStats.failedMaps, 0);
            assert.ok(result.totalTimeMs >= 0);
            assert.ok(result.executionStats.mapPhaseTimeMs >= 0);
            assert.ok(result.executionStats.reducePhaseTimeMs >= 0);
        });

        test('resolves CSV path relative to pipeline directory', async () => {
            // Create a subdirectory structure mimicking a pipeline package
            const packageDir = path.join(tempDir, 'my-pipeline');
            await fs.promises.mkdir(packageDir, { recursive: true });

            // Create CSV in the package directory
            const csvContent = 'id,title\n1,PackageItem';
            await fs.promises.writeFile(path.join(packageDir, 'input.csv'), csvContent);

            const config: PipelineConfig = {
                name: 'Package Path Test',
                input: { from: { type: 'csv', path: 'input.csv' } }, // Relative to package
                map: { prompt: '{{title}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(new Map([['PackageItem', '{"result": "ok"}']])),
                pipelineDirectory: packageDir // Pass package directory, not workspace root
            });

            assert.strictEqual(result.success, true);
            assert.ok(result.output);
            assert.strictEqual(result.output.results.length, 1);
            assert.strictEqual(result.output.results[0].item.title, 'PackageItem');
        });

        test('resolves nested CSV path relative to pipeline directory', async () => {
            // Create package with nested data directory
            const packageDir = path.join(tempDir, 'nested-package');
            const dataDir = path.join(packageDir, 'data');
            await fs.promises.mkdir(dataDir, { recursive: true });

            // Create CSV in nested directory
            const csvContent = 'id,title\n1,NestedItem';
            await fs.promises.writeFile(path.join(dataDir, 'input.csv'), csvContent);

            const config: PipelineConfig = {
                name: 'Nested Path Test',
                input: { from: { type: 'csv', path: 'data/input.csv' } }, // Nested relative path
                map: { prompt: '{{title}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(new Map([['NestedItem', '{"result": "ok"}']])),
                pipelineDirectory: packageDir
            });

            assert.strictEqual(result.success, true);
            assert.ok(result.output);
            assert.strictEqual(result.output.results[0].item.title, 'NestedItem');
        });

        test('resolves shared CSV path via parent directory reference', async () => {
            // Create shared directory alongside package
            const pipelinesDir = path.join(tempDir, 'pipelines');
            const sharedDir = path.join(pipelinesDir, 'shared');
            const packageDir = path.join(pipelinesDir, 'my-package');
            await fs.promises.mkdir(sharedDir, { recursive: true });
            await fs.promises.mkdir(packageDir, { recursive: true });

            // Create CSV in shared directory
            const csvContent = 'id,title\n1,SharedItem';
            await fs.promises.writeFile(path.join(sharedDir, 'common.csv'), csvContent);

            const config: PipelineConfig = {
                name: 'Shared Path Test',
                input: { from: { type: 'csv', path: '../shared/common.csv' } }, // Parent directory reference
                map: { prompt: '{{title}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(new Map([['SharedItem', '{"result": "ok"}']])),
                pipelineDirectory: packageDir
            });

            assert.strictEqual(result.success, true);
            assert.ok(result.output);
            assert.strictEqual(result.output.results[0].item.title, 'SharedItem');
        });
    });

    suite('validation errors', () => {
        test('throws for missing name', async () => {
            const config = {
                input: { items: [{ x: '1' }] },
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                PipelineExecutionError
            );
        });

        test('throws for missing input (neither items, from, nor generate)', async () => {
            const config = {
                name: 'Test',
                input: {},
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                /must have one of "items", "from", or "generate"/
            );
        });

        test('throws for having both items and from', async () => {
            const config = {
                name: 'Test',
                input: {
                    items: [{ x: '1' }],
                    from: { type: 'csv', path: './data.csv' }
                },
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                /can only have one of "items", "from", or "generate"/
            );
        });

        test('throws for having both items and generate', async () => {
            const config = {
                name: 'Test',
                input: {
                    items: [{ x: '1' }],
                    generate: { prompt: 'Generate items', schema: ['x'] }
                },
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                /can only have one of "items", "from", or "generate"/
            );
        });

        test('throws for having both from and generate', async () => {
            const config = {
                name: 'Test',
                input: {
                    from: { type: 'csv', path: './data.csv' },
                    generate: { prompt: 'Generate items', schema: ['x'] }
                },
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                /can only have one of "items", "from", or "generate"/
            );
        });

        test('throws for unsupported source type', async () => {
            const config = {
                name: 'Test',
                input: { from: { type: 'json', path: './data.json' } },
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                /Unsupported source type/
            );
        });

        test('throws for missing CSV path', async () => {
            const config = {
                name: 'Test',
                input: { from: { type: 'csv' } },
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                /Invalid "from" configuration|missing.*path/i
            );
        });

        test('accepts empty output fields (text mode)', async () => {
            // Empty output fields are now valid - enables text mode
            const config: PipelineConfig = {
                name: 'Test',
                input: { items: [{ x: '1' }] },
                map: { prompt: '{{x}}', output: [] },
                reduce: { type: 'text' }
            };

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(new Map([['1', 'Raw text response']])),
                pipelineDirectory: tempDir
            });

            assert.ok(result.success);
            assert.ok(result.output!.formattedOutput.includes('Raw text response'));
        });

        test('throws for unsupported reduce type', async () => {
            const config = {
                name: 'Test',
                input: { items: [{ x: '1' }] },
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'invalid' }
            } as unknown as PipelineConfig;

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                /Unsupported reduce type/
            );
        });

        test('throws for missing CSV columns', async () => {
            await createTestCSV('data.csv', 'id,name\n1,Test');

            const config: PipelineConfig = {
                name: 'Test',
                input: { from: { type: 'csv', path: './data.csv' } },
                map: { prompt: '{{title}} {{description}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                /missing required fields.*title.*description/i
            );
        });

        test('throws for missing CSV file', async () => {
            const config: PipelineConfig = {
                name: 'Test',
                input: { from: { type: 'csv', path: './nonexistent.csv' } },
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'list' }
            };

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                PipelineExecutionError
            );
        });

        test('throws for invalid parameters (not array)', async () => {
            const config = {
                name: 'Test',
                input: {
                    items: [{ x: '1' }],
                    parameters: 'not-an-array'
                },
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                /parameters.*must be an array/i
            );
        });

        test('throws for parameter without name', async () => {
            const config = {
                name: 'Test',
                input: {
                    items: [{ x: '1' }],
                    parameters: [{ value: 'test' }]
                },
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                /must have a "name"/
            );
        });

        test('throws for parameter without value', async () => {
            const config = {
                name: 'Test',
                input: {
                    items: [{ x: '1' }],
                    parameters: [{ name: 'test' }]
                },
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                /must have a "value"/
            );
        });
    });

    suite('validation errors - generate config', () => {
        test('throws for generate config requiring interactive approval', async () => {
            const config: PipelineConfig = {
                name: 'Generate Test',
                input: {
                    generate: {
                        prompt: 'Generate 5 test cases',
                        schema: ['name', 'value']
                    }
                },
                map: { prompt: '{{name}}: {{value}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                /interactive approval|Pipeline Preview/i
            );
        });

        test('throws for generate config with missing prompt', async () => {
            const config = {
                name: 'Generate Test',
                input: {
                    generate: {
                        schema: ['name', 'value']
                    }
                },
                map: { prompt: '{{name}}', output: ['result'] },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                /Invalid generate configuration|prompt/i
            );
        });

        test('throws for generate config with missing schema', async () => {
            const config = {
                name: 'Generate Test',
                input: {
                    generate: {
                        prompt: 'Generate items'
                    }
                },
                map: { prompt: '{{name}}', output: ['result'] },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                /Invalid generate configuration|schema/i
            );
        });

        test('throws for generate config with empty schema', async () => {
            const config: PipelineConfig = {
                name: 'Generate Test',
                input: {
                    generate: {
                        prompt: 'Generate items',
                        schema: []
                    }
                },
                map: { prompt: '{{name}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                /at least one field/i
            );
        });

        test('throws for generate config with invalid schema field names', async () => {
            const config: PipelineConfig = {
                name: 'Generate Test',
                input: {
                    generate: {
                        prompt: 'Generate items',
                        schema: ['validName', '123invalid']
                    }
                },
                map: { prompt: '{{name}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                /valid identifier/i
            );
        });
    });

    suite('executePipeline - parameters', () => {
        test('uses parameters in template substitution', async () => {
            const config: PipelineConfig = {
                name: 'Parameters Test',
                input: {
                    items: [
                        { title: 'Bug A' },
                        { title: 'Bug B' }
                    ],
                    parameters: [
                        { name: 'project', value: 'MyProject' },
                        { name: 'version', value: '1.0.0' }
                    ]
                },
                map: {
                    prompt: 'Project: {{project}} v{{version}}, Bug: {{title}}',
                    output: ['result']
                },
                reduce: { type: 'list' }
            };

            let capturedPrompts: string[] = [];
            const aiInvoker = async (prompt: string) => {
                capturedPrompts.push(prompt);
                return { success: true, response: '{"result": "ok"}' };
            };

            await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(capturedPrompts.length, 2);
            assert.ok(capturedPrompts[0].includes('Project: MyProject v1.0.0'));
            assert.ok(capturedPrompts[0].includes('Bug: Bug A'));
            assert.ok(capturedPrompts[1].includes('Project: MyProject v1.0.0'));
            assert.ok(capturedPrompts[1].includes('Bug: Bug B'));
        });

        test('item fields take precedence over parameters', async () => {
            const config: PipelineConfig = {
                name: 'Override Test',
                input: {
                    items: [
                        { title: 'Bug Title', project: 'ItemProject' }
                    ],
                    parameters: [
                        { name: 'project', value: 'ParamProject' }
                    ]
                },
                map: {
                    prompt: '{{project}}: {{title}}',
                    output: ['result']
                },
                reduce: { type: 'list' }
            };

            let capturedPrompt = '';
            const aiInvoker = async (prompt: string) => {
                capturedPrompt = prompt;
                return { success: true, response: '{"result": "ok"}' };
            };

            await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            // Item's 'project' should override parameter's 'project'
            assert.ok(capturedPrompt.includes('ItemProject: Bug Title'));
            assert.ok(!capturedPrompt.includes('ParamProject'));
        });

        test('parameters work with CSV input', async () => {
            await createTestCSV('bugs.csv', 'id,title\n1,Bug One\n2,Bug Two');

            const config: PipelineConfig = {
                name: 'CSV Parameters Test',
                input: {
                    from: { type: 'csv', path: './bugs.csv' },
                    parameters: [
                        { name: 'env', value: 'production' }
                    ]
                },
                map: {
                    prompt: 'Env: {{env}}, ID: {{id}}, Title: {{title}}',
                    output: ['severity']
                },
                reduce: { type: 'list' }
            };

            let capturedPrompts: string[] = [];
            const aiInvoker = async (prompt: string) => {
                capturedPrompts.push(prompt);
                return { success: true, response: '{"severity": "low"}' };
            };

            await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(capturedPrompts.length, 2);
            assert.ok(capturedPrompts[0].includes('Env: production'));
            assert.ok(capturedPrompts[0].includes('ID: 1'));
            assert.ok(capturedPrompts[1].includes('Env: production'));
            assert.ok(capturedPrompts[1].includes('ID: 2'));
        });

        test('parameters satisfy missing template variables', async () => {
            // This tests that parameters can provide values that items don't have
            const config: PipelineConfig = {
                name: 'Satisfy Variables Test',
                input: {
                    items: [{ title: 'Test Bug' }],
                    parameters: [
                        { name: 'system_prompt', value: 'You are a helpful assistant' }
                    ]
                },
                map: {
                    prompt: '{{system_prompt}}\n\nAnalyze: {{title}}',
                    output: ['result']
                },
                reduce: { type: 'list' }
            };

            let capturedPrompt = '';
            const aiInvoker = async (prompt: string) => {
                capturedPrompt = prompt;
                return { success: true, response: '{"result": "done"}' };
            };

            // Should not throw - parameters provide the missing 'system_prompt'
            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.ok(capturedPrompt.includes('You are a helpful assistant'));
            assert.ok(capturedPrompt.includes('Analyze: Test Bug'));
        });

        test('empty parameters array is valid', async () => {
            const config: PipelineConfig = {
                name: 'Empty Params Test',
                input: {
                    items: [{ title: 'Bug' }],
                    parameters: []
                },
                map: {
                    prompt: '{{title}}',
                    output: ['result']
                },
                reduce: { type: 'list' }
            };

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(new Map()),
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
        });

        test('parameters with limit', async () => {
            const config: PipelineConfig = {
                name: 'Params with Limit',
                input: {
                    items: [
                        { title: 'A' },
                        { title: 'B' },
                        { title: 'C' }
                    ],
                    parameters: [{ name: 'prefix', value: 'TEST' }],
                    limit: 2
                },
                map: {
                    prompt: '{{prefix}}: {{title}}',
                    output: ['result']
                },
                reduce: { type: 'list' }
            };

            let callCount = 0;
            const aiInvoker = async () => {
                callCount++;
                return { success: true, response: '{"result": "ok"}' };
            };

            await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(callCount, 2);
        });
    });

    suite('parsePipelineYAML', () => {
        test('parses valid YAML config with CSV source', async () => {
            const yaml = `
name: "Bug Triage"
input:
  from:
    type: csv
    path: "./bugs.csv"
map:
  prompt: |
    Analyze: {{title}}
  output: [severity, category]
reduce:
  type: list
`;

            const config = await parsePipelineYAML(yaml);

            assert.strictEqual(config.name, 'Bug Triage');
            assert.ok(config.input.from);
            assert.ok(isCSVSource(config.input.from));
            if (isCSVSource(config.input.from)) {
                assert.strictEqual(config.input.from.type, 'csv');
                assert.strictEqual(config.input.from.path, './bugs.csv');
            }
            assert.ok(config.map.prompt.includes('Analyze: {{title}}'));
            assert.deepStrictEqual(config.map.output, ['severity', 'category']);
            assert.strictEqual(config.reduce.type, 'list');
        });

        test('parses valid YAML config with inline items', async () => {
            const yaml = `
name: "Inline Test"
input:
  items:
    - feature: "User Auth"
      status: "in-progress"
    - feature: "Payments"
      status: "planned"
map:
  prompt: "{{feature}}: {{status}}"
  output: [next_steps]
reduce:
  type: table
`;

            const config = await parsePipelineYAML(yaml);

            assert.strictEqual(config.name, 'Inline Test');
            assert.ok(config.input.items);
            assert.strictEqual(config.input.items.length, 2);
            assert.strictEqual(config.input.items[0].feature, 'User Auth');
            assert.strictEqual(config.input.items[1].status, 'planned');
            assert.strictEqual(config.reduce.type, 'table');
        });

        test('parses YAML with limit option', async () => {
            const yaml = `
name: "Limit Test"
input:
  from:
    type: csv
    path: "./data.csv"
  limit: 20
map:
  prompt: "{{x}}"
  output: [y]
reduce:
  type: list
`;

            const config = await parsePipelineYAML(yaml);

            assert.strictEqual(config.input.limit, 20);
        });

        test('parses YAML with custom CSV delimiter', async () => {
            const yaml = `
name: "Test"
input:
  from:
    type: csv
    path: "./data.csv"
    delimiter: "\\t"
map:
  prompt: "{{x}}"
  output: [y]
  parallel: 3
reduce:
  type: list
`;

            const config = await parsePipelineYAML(yaml);

            assert.ok(config.input.from);
            assert.ok(isCSVSource(config.input.from));
            if (isCSVSource(config.input.from)) {
                assert.strictEqual(config.input.from.delimiter, '\t');
            }
            assert.strictEqual(config.map.parallel, 3);
        });

        test('parses YAML with model option', async () => {
            const yaml = `
name: "Model Test"
input:
  items:
    - title: "Item 1"
map:
  prompt: "{{title}}"
  output: [result]
  model: "gpt-4-turbo"
reduce:
  type: list
`;

            const config = await parsePipelineYAML(yaml);

            assert.strictEqual(config.map.model, 'gpt-4-turbo');
        });

        test('parses YAML with model and parallel options', async () => {
            const yaml = `
name: "Full Config Test"
input:
  from:
    type: csv
    path: "./data.csv"
map:
  prompt: "{{x}}"
  output: [y]
  model: "claude-3-opus"
  parallel: 10
reduce:
  type: json
`;

            const config = await parsePipelineYAML(yaml);

            assert.strictEqual(config.map.model, 'claude-3-opus');
            assert.strictEqual(config.map.parallel, 10);
            assert.strictEqual(config.reduce.type, 'json');
        });

        test('throws on invalid YAML config - missing input source', async () => {
            const yaml = `
name: "Test"
input: {}
map:
  prompt: "{{x}}"
  output: [y]
reduce:
  type: list
`;

            await assert.rejects(
                async () => parsePipelineYAML(yaml),
                PipelineExecutionError
            );
        });

        test('parses YAML with parameters', async () => {
            const yaml = `
name: "Parameters Test"
input:
  items:
    - title: "Bug A"
  parameters:
    - name: project
      value: MyProject
    - name: version
      value: "2.0"
map:
  prompt: "{{project}} v{{version}}: {{title}}"
  output: [result]
reduce:
  type: list
`;

            const config = await parsePipelineYAML(yaml);

            assert.ok(config.input.parameters);
            assert.strictEqual(config.input.parameters.length, 2);
            assert.strictEqual(config.input.parameters[0].name, 'project');
            assert.strictEqual(config.input.parameters[0].value, 'MyProject');
            assert.strictEqual(config.input.parameters[1].name, 'version');
            assert.strictEqual(config.input.parameters[1].value, '2.0');
        });

        test('parses YAML with parameters and CSV', async () => {
            const yaml = `
name: "CSV with Params"
input:
  from:
    type: csv
    path: "./data.csv"
  parameters:
    - name: env
      value: production
map:
  prompt: "{{env}}: {{title}}"
  output: [result]
reduce:
  type: list
`;

            const config = await parsePipelineYAML(yaml);

            assert.ok(config.input.from);
            assert.ok(config.input.parameters);
            assert.strictEqual(config.input.parameters.length, 1);
            assert.strictEqual(config.input.parameters[0].name, 'env');
            assert.strictEqual(config.input.parameters[0].value, 'production');
        });
    });

    suite('parsePipelineYAMLSync', () => {
        test('parses valid YAML config synchronously with CSV', () => {
            const yaml = `
name: "Sync Test"
input:
  from:
    type: csv
    path: "./data.csv"
map:
  prompt: "{{title}}"
  output: [result]
reduce:
  type: list
`;

            const config = parsePipelineYAMLSync(yaml);

            assert.strictEqual(config.name, 'Sync Test');
            assert.ok(config.input.from);
            assert.ok(isCSVSource(config.input.from));
            if (isCSVSource(config.input.from)) {
                assert.strictEqual(config.input.from.type, 'csv');
            }
        });

        test('parses valid YAML config synchronously with inline items', () => {
            const yaml = `
name: "Sync Inline Test"
input:
  items:
    - title: "Item 1"
    - title: "Item 2"
map:
  prompt: "{{title}}"
  output: [result]
reduce:
  type: json
`;

            const config = parsePipelineYAMLSync(yaml);

            assert.strictEqual(config.name, 'Sync Inline Test');
            assert.ok(config.input.items);
            assert.strictEqual(config.input.items.length, 2);
            assert.strictEqual(config.reduce.type, 'json');
        });
    });

    suite('DEFAULT_PARALLEL_LIMIT', () => {
        test('has reasonable default value', () => {
            assert.strictEqual(DEFAULT_PARALLEL_LIMIT, 5);
        });
    });

    suite('real-world scenarios from design doc', () => {
        test('executes bug triage pipeline with CSV', async () => {
            const csvContent = `id,title,description,priority
1,Login broken,Users can't login,high
2,Slow search,Search takes 10s,medium
3,UI glitch,"Button misaligned",low`;

            await createTestCSV('bugs.csv', csvContent);

            const config: PipelineConfig = {
                name: 'Bug Triage',
                input: { from: { type: 'csv', path: './bugs.csv' } },
                map: {
                    prompt: `Analyze this bug:

Title: {{title}}
Description: {{description}}
Reporter Priority: {{priority}}

Classify the severity (critical/high/medium/low), 
category (ui/backend/database/infra),
estimate effort in hours,
and note if more info is needed.`,
                    output: ['severity', 'category', 'effort_hours', 'needs_more_info'],
                    parallel: 3
                },
                reduce: { type: 'list' }
            };

            const responses = new Map([
                ['Login broken', '{"severity": "critical", "category": "backend", "effort_hours": 4, "needs_more_info": false}'],
                ['Slow search', '{"severity": "medium", "category": "database", "effort_hours": 8, "needs_more_info": false}'],
                ['UI glitch', '{"severity": "low", "category": "ui", "effort_hours": 2, "needs_more_info": true}']
            ]);

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(responses),
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.ok(result.output);
            assert.strictEqual(result.output.results.length, 3);

            // Verify first bug
            const loginBug = result.output.results.find((r) => r.item['title'] === 'Login broken');
            assert.ok(loginBug);
            assert.strictEqual(loginBug.output.severity, 'critical');
            assert.strictEqual(loginBug.output.category, 'backend');
            assert.strictEqual(loginBug.output.effort_hours, 4);
            assert.strictEqual(loginBug.output.needs_more_info, false);

            // Verify formatted output
            assert.ok(result.output.formattedOutput.includes('## Results (3 items)'));
            assert.ok(result.output.formattedOutput.includes('Login broken'));
            assert.ok(result.output.formattedOutput.includes('critical'));
        });

        test('executes feature review pipeline with inline items', async () => {
            const config: PipelineConfig = {
                name: 'Review Features',
                input: {
                    items: [
                        { feature: 'User Authentication', status: 'in-progress', owner: 'john' },
                        { feature: 'Payment Integration', status: 'planned', owner: 'jane' },
                        { feature: 'Dashboard Redesign', status: 'complete', owner: 'bob' }
                    ]
                },
                map: {
                    prompt: `Feature: {{feature}}
Status: {{status}}
Owner: {{owner}}

What are the next steps?`,
                    output: ['next_steps', 'priority']
                },
                reduce: { type: 'table' }
            };

            const responses = new Map([
                ['User Authentication', '{"next_steps": "Complete OAuth integration", "priority": "high"}'],
                ['Payment Integration', '{"next_steps": "Setup Stripe account", "priority": "medium"}'],
                ['Dashboard Redesign', '{"next_steps": "Gather feedback", "priority": "low"}']
            ]);

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(responses),
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.ok(result.output);
            assert.strictEqual(result.output.results.length, 3);

            // Verify results
            const authFeature = result.output.results.find((r) => r.item['feature'] === 'User Authentication');
            assert.ok(authFeature);
            assert.strictEqual(authFeature.output.next_steps, 'Complete OAuth integration');
            assert.strictEqual(authFeature.output.priority, 'high');
        });

        test('executes pipeline with CSV and limit', async () => {
            // Create CSV with many rows
            const rows = Array.from({ length: 100 }, (_, i) => `${i + 1},Item ${i + 1},Description ${i + 1}`).join('\n');
            await createTestCSV('large.csv', `id,name,description\n${rows}`);

            const config: PipelineConfig = {
                name: 'Process CSV Data',
                input: {
                    from: { type: 'csv', path: './large.csv' },
                    limit: 20
                },
                map: {
                    prompt: 'Analyze: {{name}} - {{description}}',
                    output: ['category', 'score']
                },
                reduce: { type: 'json' }
            };

            const result = await executePipeline(config, {
                aiInvoker: async () => ({ success: true, response: '{"category": "test", "score": 5}' }),
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.executionStats.totalItems, 20);
            assert.ok(result.output);
            assert.strictEqual(result.output.results.length, 20);
        });
    });

    suite('executePipelineWithItems - pre-approved items', () => {
        test('executes pipeline with pre-approved items successfully', async () => {
            // Config with generate config (which would normally fail validation)
            const config: PipelineConfig = {
                name: 'Generated Items Pipeline',
                input: {
                    generate: {
                        prompt: 'Generate test cases',
                        schema: ['testName', 'input', 'expected']
                    }
                },
                map: {
                    prompt: 'Run test: {{testName}}\nInput: {{input}}\nExpected: {{expected}}',
                    output: ['actual', 'passed']
                },
                reduce: { type: 'list' }
            };

            // Pre-approved items (as if user approved them in the UI)
            const items = [
                { testName: 'Valid Login', input: 'user@test.com', expected: 'Success' },
                { testName: 'Empty Password', input: '', expected: 'Error' }
            ];

            const responses = new Map([
                ['Valid Login', '{"actual": "Success", "passed": true}'],
                ['Empty Password', '{"actual": "Error", "passed": true}']
            ]);

            const result = await executePipelineWithItems(config, items, {
                aiInvoker: createMockAIInvoker(responses),
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.ok(result.output);
            assert.strictEqual(result.output.results.length, 2);

            assert.strictEqual(result.output.results[0].success, true);
            assert.strictEqual(result.output.results[0].output.actual, 'Success');
            assert.strictEqual(result.output.results[0].output.passed, true);

            assert.strictEqual(result.output.results[1].success, true);
            assert.strictEqual(result.output.results[1].output.actual, 'Error');
            assert.strictEqual(result.output.results[1].output.passed, true);
        });

        test('handles empty items array', async () => {
            const config: PipelineConfig = {
                name: 'Empty Items Test',
                input: {
                    generate: {
                        prompt: 'Generate items',
                        schema: ['name']
                    }
                },
                map: { prompt: '{{name}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const result = await executePipelineWithItems(config, [], {
                aiInvoker: createMockAIInvoker(new Map()),
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.executionStats.totalItems, 0);
        });

        test('applies limit to pre-approved items', async () => {
            const config: PipelineConfig = {
                name: 'Limit Test',
                input: {
                    generate: {
                        prompt: 'Generate items',
                        schema: ['name']
                    },
                    limit: 2
                },
                map: { prompt: '{{name}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const items = [
                { name: 'Item 1' },
                { name: 'Item 2' },
                { name: 'Item 3' },
                { name: 'Item 4' },
                { name: 'Item 5' }
            ];

            const result = await executePipelineWithItems(config, items, {
                aiInvoker: createMockAIInvoker(new Map()),
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.executionStats.totalItems, 2);
            assert.ok(result.output);
            assert.strictEqual(result.output.results.length, 2);
            assert.strictEqual(result.output.results[0].item.name, 'Item 1');
            assert.strictEqual(result.output.results[1].item.name, 'Item 2');
        });

        test('merges parameters into pre-approved items', async () => {
            const config: PipelineConfig = {
                name: 'Parameters Test',
                input: {
                    generate: {
                        prompt: 'Generate items',
                        schema: ['testName']
                    },
                    parameters: [
                        { name: 'project', value: 'MyProject' },
                        { name: 'version', value: '1.0.0' }
                    ]
                },
                map: {
                    prompt: 'Project: {{project}} v{{version}}, Test: {{testName}}',
                    output: ['result']
                },
                reduce: { type: 'list' }
            };

            const items = [
                { testName: 'Test A' },
                { testName: 'Test B' }
            ];

            let capturedPrompts: string[] = [];
            const aiInvoker = async (prompt: string) => {
                capturedPrompts.push(prompt);
                return { success: true, response: '{"result": "ok"}' };
            };

            await executePipelineWithItems(config, items, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(capturedPrompts.length, 2);
            assert.ok(capturedPrompts[0].includes('Project: MyProject v1.0.0'));
            assert.ok(capturedPrompts[0].includes('Test: Test A'));
            assert.ok(capturedPrompts[1].includes('Project: MyProject v1.0.0'));
            assert.ok(capturedPrompts[1].includes('Test: Test B'));
        });

        test('item fields take precedence over parameters', async () => {
            const config: PipelineConfig = {
                name: 'Override Test',
                input: {
                    generate: {
                        prompt: 'Generate items',
                        schema: ['name', 'project']
                    },
                    parameters: [
                        { name: 'project', value: 'DefaultProject' }
                    ]
                },
                map: {
                    prompt: '{{project}}: {{name}}',
                    output: ['result']
                },
                reduce: { type: 'list' }
            };

            const items = [
                { name: 'Item 1', project: 'CustomProject' }
            ];

            let capturedPrompt = '';
            const aiInvoker = async (prompt: string) => {
                capturedPrompt = prompt;
                return { success: true, response: '{"result": "ok"}' };
            };

            await executePipelineWithItems(config, items, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            // Item's 'project' should override parameter's 'project'
            assert.ok(capturedPrompt.includes('CustomProject: Item 1'));
            assert.ok(!capturedPrompt.includes('DefaultProject'));
        });

        test('validates items have required template variables', async () => {
            const config: PipelineConfig = {
                name: 'Validation Test',
                input: {
                    generate: {
                        prompt: 'Generate items',
                        schema: ['name']
                    }
                },
                map: { prompt: '{{name}} {{description}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const items = [
                { name: 'Test' }  // Missing 'description' field
            ];

            await assert.rejects(
                async () => executePipelineWithItems(config, items, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                /missing required fields.*description/i
            );
        });

        test('passes model to AI invoker', async () => {
            const config: PipelineConfig = {
                name: 'Model Test',
                input: {
                    generate: {
                        prompt: 'Generate items',
                        schema: ['name']
                    }
                },
                map: {
                    prompt: '{{name}}',
                    output: ['result'],
                    model: 'gpt-4'
                },
                reduce: { type: 'list' }
            };

            const items = [{ name: 'Test' }];

            let receivedModel: string | undefined;
            const aiInvoker = async (_prompt: string, options?: { model?: string }) => {
                receivedModel = options?.model;
                return { success: true, response: '{"result": "ok"}' };
            };

            const result = await executePipelineWithItems(config, items, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(receivedModel, 'gpt-4');
        });

        test('handles AI failures gracefully', async () => {
            const config: PipelineConfig = {
                name: 'Failure Test',
                input: {
                    generate: {
                        prompt: 'Generate items',
                        schema: ['name']
                    }
                },
                map: { prompt: '{{name}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const items = [
                { name: 'Good' },
                { name: 'Bad' }
            ];

            const aiInvoker = async (prompt: string) => {
                if (prompt.includes('Bad')) {
                    return { success: false, error: 'AI service unavailable' };
                }
                return { success: true, response: '{"result": "ok"}' };
            };

            const result = await executePipelineWithItems(config, items, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            // The executor considers the job successful if all map operations completed
            assert.strictEqual(result.success, true);
            assert.ok(result.output);
            assert.strictEqual(result.output.results[0].success, true);
            assert.strictEqual(result.output.results[1].success, false);
            assert.ok(result.output.results[1].error?.includes('AI service unavailable'));
        });

        test('reports progress during execution', async () => {
            const config: PipelineConfig = {
                name: 'Progress Test',
                input: {
                    generate: {
                        prompt: 'Generate items',
                        schema: ['name']
                    }
                },
                map: { prompt: '{{name}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const items = [
                { name: 'A' },
                { name: 'B' },
                { name: 'C' }
            ];

            const progressUpdates: JobProgress[] = [];

            await executePipelineWithItems(config, items, {
                aiInvoker: createMockAIInvoker(new Map()),
                pipelineDirectory: tempDir,
                onProgress: (progress) => progressUpdates.push({ ...progress })
            });

            // Verify progress updates were received
            assert.ok(progressUpdates.length > 0, 'Should have progress updates');

            // Verify final progress
            const finalProgress = progressUpdates[progressUpdates.length - 1];
            assert.strictEqual(finalProgress.percentage, 100);
        });

        test('works with AI reduce type', async () => {
            const config: PipelineConfig = {
                name: 'AI Reduce Test',
                input: {
                    generate: {
                        prompt: 'Generate items',
                        schema: ['name', 'category']
                    }
                },
                map: {
                    prompt: 'Analyze: {{name}} ({{category}})',
                    output: ['score']
                },
                reduce: {
                    type: 'ai',
                    prompt: 'Summarize {{COUNT}} results:\n{{RESULTS}}',
                    output: ['summary']
                }
            };

            const items = [
                { name: 'Item A', category: 'cat1' },
                { name: 'Item B', category: 'cat2' }
            ];

            let reducePromptReceived = false;
            const aiInvoker = async (prompt: string) => {
                if (prompt.includes('Summarize')) {
                    reducePromptReceived = true;
                    return { success: true, response: '{"summary": "All items processed successfully"}' };
                }
                return { success: true, response: '{"score": 5}' };
            };

            const result = await executePipelineWithItems(config, items, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.ok(reducePromptReceived, 'AI reduce should have been called');
        });

        test('throws for missing map config', async () => {
            const config = {
                name: 'Test',
                input: {
                    generate: {
                        prompt: 'Generate items',
                        schema: ['name']
                    }
                },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            const items = [{ name: 'Test' }];

            await assert.rejects(
                async () => executePipelineWithItems(config, items, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                /missing "map"/
            );
        });

        test('throws for unsupported reduce type', async () => {
            const config = {
                name: 'Test',
                input: {
                    generate: {
                        prompt: 'Generate items',
                        schema: ['name']
                    }
                },
                map: { prompt: '{{name}}', output: ['result'] },
                reduce: { type: 'invalid' }
            } as unknown as PipelineConfig;

            const items = [{ name: 'Test' }];

            await assert.rejects(
                async () => executePipelineWithItems(config, items, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                /Unsupported reduce type/
            );
        });

        test('records execution statistics', async () => {
            const config: PipelineConfig = {
                name: 'Stats Test',
                input: {
                    generate: {
                        prompt: 'Generate items',
                        schema: ['name']
                    }
                },
                map: { prompt: '{{name}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const items = [
                { name: 'A' },
                { name: 'B' },
                { name: 'C' }
            ];

            const result = await executePipelineWithItems(config, items, {
                aiInvoker: createMockAIInvoker(new Map()),
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.executionStats.totalItems, 3);
            assert.strictEqual(result.executionStats.successfulMaps, 3);
            assert.strictEqual(result.executionStats.failedMaps, 0);
            assert.ok(result.totalTimeMs >= 0);
            assert.ok(result.executionStats.mapPhaseTimeMs >= 0);
            assert.ok(result.executionStats.reducePhaseTimeMs >= 0);
        });
    });
});
