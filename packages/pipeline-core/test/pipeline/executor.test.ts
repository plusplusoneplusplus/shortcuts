/**
 * Tests for Pipeline Executor
 *
 * Comprehensive tests for pipeline execution using the map-reduce framework.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    DEFAULT_PARALLEL_LIMIT,
    executePipeline,
    executePipelineWithItems,
    parsePipelineYAML,
    parsePipelineYAMLSync,
    PipelineExecutionError,
    PipelineConfig,
    isCSVSource,
    AIInvokerResult,
    JobProgress
} from '../../src/pipeline';

describe('Pipeline Executor', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pipeline-test-'));
    });

    afterEach(async () => {
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

    describe('executePipeline - inline items', () => {
        it('executes pipeline with inline items successfully', async () => {
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

            expect(result.success).toBe(true);
            expect(result.output).toBeTruthy();
            expect(result.output!.results.length).toBe(2);

            expect(result.output!.results[0].success).toBe(true);
            expect(result.output!.results[0].output.severity).toBe('high');

            expect(result.output!.results[1].success).toBe(true);
            expect(result.output!.results[1].output.severity).toBe('low');
        });

        it('handles empty inline items', async () => {
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

            expect(result.success).toBe(true);
            expect(result.executionStats.totalItems).toBe(0);
        });

        it('applies limit to inline items', async () => {
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

            expect(result.success).toBe(true);
            expect(result.executionStats.totalItems).toBe(2);
            expect(result.output).toBeTruthy();
            expect(result.output!.results.length).toBe(2);
            expect(result.output!.results[0].item.title).toBe('Item 1');
            expect(result.output!.results[1].item.title).toBe('Item 2');
        });

        it('handles multiple output fields with inline items', async () => {
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

            expect(result.success).toBe(true);
            expect(result.output).toBeTruthy();
            expect(result.output!.results[0].output).toEqual({
                severity: 'high',
                category: 'backend',
                effort_hours: 4,
                needs_more_info: false
            });
        });

        it('validates inline items have required template variables', async () => {
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

            await expect(
                executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                })
            ).rejects.toThrow(/missing required fields.*title.*description/i);
        });

        it('passes model to AI invoker from map config', async () => {
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

            expect(result.success).toBe(true);
            expect(receivedModel).toBe('gpt-4');
        });

        it('does not pass model if not specified in config', async () => {
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

            expect(result.success).toBe(true);
            expect(receivedModel).toBeUndefined();
        });

        it('uses custom timeout from map config', async () => {
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
            expect(result.success).toBe(false);
            expect(result.executionStats.failedMaps).toBe(1);
            expect(result.mapResults).toBeTruthy();
            expect(result.mapResults![0].error).toMatch(/timed out/);
        });

        it('timeout retry succeeds with doubled timeout', async () => {
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
            expect(result.success).toBe(true);
            expect(attemptCount).toBe(2);
            expect(result.output).toBeTruthy();
            expect(result.output!.results[0].success).toBe(true);
        });

        it('uses default timeout (10 minutes) when not specified', async () => {
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
            expect(result.success).toBe(true);
            expect(result.output).toBeTruthy();
            expect(result.output!.results[0].success).toBe(true);
        });
    });

    describe('executePipeline - CSV from file', () => {
        it('executes simple pipeline successfully', async () => {
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

            expect(result.success).toBe(true);
            expect(result.output).toBeTruthy();
            expect(result.output!.results.length).toBe(2);

            expect(result.output!.results[0].success).toBe(true);
            expect(result.output!.results[0].output.severity).toBe('high');

            expect(result.output!.results[1].success).toBe(true);
            expect(result.output!.results[1].output.severity).toBe('low');
        });

        it('handles empty CSV', async () => {
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

            expect(result.success).toBe(true);
            expect(result.executionStats.totalItems).toBe(0);
        });

        it('applies limit to CSV items', async () => {
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

            expect(result.success).toBe(true);
            expect(result.executionStats.totalItems).toBe(3);
            expect(result.output).toBeTruthy();
            expect(result.output!.results.length).toBe(3);
        });

        it('handles AI failures gracefully', async () => {
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
            expect(result.success).toBe(true);
            expect(result.executionStats.successfulMaps).toBe(2);
            expect(result.executionStats.failedMaps).toBe(0);

            expect(result.output).toBeTruthy();
            expect(result.output!.results[0].success).toBe(true);
            expect(result.output!.results[1].success).toBe(false);
            expect(result.output!.results[1].error).toMatch(/AI service unavailable/);
        });

        it('handles JSON parse failures', async () => {
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

            expect(result.success).toBe(true);
            expect(result.output).toBeTruthy();
            expect(result.output!.results[0].success).toBe(false);
            expect(result.output!.results[0].error).toMatch(/parse/);
        });

        it('respects parallel limit', async () => {
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

            expect(maxConcurrent).toBeLessThanOrEqual(2);
        });

        it('reports progress during execution', async () => {
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
            expect(progressUpdates.length).toBeGreaterThan(0);

            // Verify final progress
            const finalProgress = progressUpdates[progressUpdates.length - 1];
            expect(finalProgress.percentage).toBe(100);
        });

        it('handles multiple output fields', async () => {
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

            expect(result.success).toBe(true);
            expect(result.output).toBeTruthy();
            expect(result.output!.results[0].output).toEqual({
                severity: 'high',
                category: 'backend',
                effort_hours: 4,
                needs_more_info: false
            });
        });

        it('uses custom delimiter', async () => {
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

            expect(result.success).toBe(true);
            expect(result.output).toBeTruthy();
            expect(result.output!.results[0].item.title).toBe('Test');
            expect(result.output!.results[0].item.value).toBe('100');
        });

        it('records execution statistics', async () => {
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

            expect(result.executionStats.totalItems).toBe(3);
            expect(result.executionStats.successfulMaps).toBe(3);
            expect(result.executionStats.failedMaps).toBe(0);
            expect(result.totalTimeMs).toBeGreaterThanOrEqual(0);
            expect(result.executionStats.mapPhaseTimeMs).toBeGreaterThanOrEqual(0);
            expect(result.executionStats.reducePhaseTimeMs).toBeGreaterThanOrEqual(0);
        });

        it('resolves CSV path relative to pipeline directory', async () => {
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

            expect(result.success).toBe(true);
            expect(result.output).toBeTruthy();
            expect(result.output!.results.length).toBe(1);
            expect(result.output!.results[0].item.title).toBe('PackageItem');
        });

        it('resolves nested CSV path relative to pipeline directory', async () => {
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

            expect(result.success).toBe(true);
            expect(result.output).toBeTruthy();
            expect(result.output!.results[0].item.title).toBe('NestedItem');
        });

        it('resolves shared CSV path via parent directory reference', async () => {
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

            expect(result.success).toBe(true);
            expect(result.output).toBeTruthy();
            expect(result.output!.results[0].item.title).toBe('SharedItem');
        });
    });

    describe('validation errors', () => {
        it('throws for missing name', async () => {
            const config = {
                input: { items: [{ x: '1' }] },
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            await expect(
                executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                })
            ).rejects.toThrow(PipelineExecutionError);
        });

        it('throws for missing input (neither items, from, nor generate)', async () => {
            const config = {
                name: 'Test',
                input: {},
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            await expect(
                executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                })
            ).rejects.toThrow(/must have one of "items", "from", or "generate"/);
        });

        it('throws for having both items and from', async () => {
            const config = {
                name: 'Test',
                input: {
                    items: [{ x: '1' }],
                    from: { type: 'csv', path: './data.csv' }
                },
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            await expect(
                executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                })
            ).rejects.toThrow(/can only have one of "items", "from", or "generate"/);
        });

        it('throws for unsupported source type', async () => {
            const config = {
                name: 'Test',
                input: { from: { type: 'json', path: './data.json' } },
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            await expect(
                executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                })
            ).rejects.toThrow(/Unsupported source type/);
        });

        it('throws for missing CSV path', async () => {
            const config = {
                name: 'Test',
                input: { from: { type: 'csv' } },
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            await expect(
                executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                })
            ).rejects.toThrow(/Invalid "from" configuration|missing.*path/i);
        });

        it('accepts empty output fields (text mode)', async () => {
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

            expect(result.success).toBe(true);
            expect(result.output!.formattedOutput).toContain('Raw text response');
        });

        it('throws for unsupported reduce type', async () => {
            const config = {
                name: 'Test',
                input: { items: [{ x: '1' }] },
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'invalid' }
            } as unknown as PipelineConfig;

            await expect(
                executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                })
            ).rejects.toThrow(/Unsupported reduce type/);
        });

        it('throws for missing CSV columns', async () => {
            await createTestCSV('data.csv', 'id,name\n1,Test');

            const config: PipelineConfig = {
                name: 'Test',
                input: { from: { type: 'csv', path: './data.csv' } },
                map: { prompt: '{{title}} {{description}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            await expect(
                executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                })
            ).rejects.toThrow(/missing required fields.*title.*description/i);
        });

        it('throws for missing CSV file', async () => {
            const config: PipelineConfig = {
                name: 'Test',
                input: { from: { type: 'csv', path: './nonexistent.csv' } },
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'list' }
            };

            await expect(
                executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                })
            ).rejects.toThrow(PipelineExecutionError);
        });

        it('throws for invalid parameters (not array)', async () => {
            const config = {
                name: 'Test',
                input: {
                    items: [{ x: '1' }],
                    parameters: 'not-an-array'
                },
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            await expect(
                executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                })
            ).rejects.toThrow(/parameters.*must be an array/i);
        });

        it('throws for parameter without name', async () => {
            const config = {
                name: 'Test',
                input: {
                    items: [{ x: '1' }],
                    parameters: [{ value: 'test' }]
                },
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            await expect(
                executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                })
            ).rejects.toThrow(/must have a "name"/);
        });

        it('throws for parameter without value', async () => {
            const config = {
                name: 'Test',
                input: {
                    items: [{ x: '1' }],
                    parameters: [{ name: 'test' }]
                },
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            await expect(
                executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                })
            ).rejects.toThrow(/must have a "value"/);
        });
    });

    describe('executePipeline - parameters', () => {
        it('uses parameters in template substitution', async () => {
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

            expect(capturedPrompts.length).toBe(2);
            expect(capturedPrompts[0]).toContain('Project: MyProject v1.0.0');
            expect(capturedPrompts[0]).toContain('Bug: Bug A');
            expect(capturedPrompts[1]).toContain('Project: MyProject v1.0.0');
            expect(capturedPrompts[1]).toContain('Bug: Bug B');
        });

        it('item fields take precedence over parameters', async () => {
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
            expect(capturedPrompt).toContain('ItemProject: Bug Title');
            expect(capturedPrompt).not.toContain('ParamProject');
        });

        it('parameters work with CSV input', async () => {
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

            expect(capturedPrompts.length).toBe(2);
            expect(capturedPrompts[0]).toContain('Env: production');
            expect(capturedPrompts[0]).toContain('ID: 1');
            expect(capturedPrompts[1]).toContain('Env: production');
            expect(capturedPrompts[1]).toContain('ID: 2');
        });

        it('parameters satisfy missing template variables', async () => {
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

            expect(result.success).toBe(true);
            expect(capturedPrompt).toContain('You are a helpful assistant');
            expect(capturedPrompt).toContain('Analyze: Test Bug');
        });

        it('empty parameters array is valid', async () => {
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

            expect(result.success).toBe(true);
        });

        it('parameters with limit', async () => {
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

            expect(callCount).toBe(2);
        });
    });

    describe('parsePipelineYAML', () => {
        it('parses valid YAML config with CSV source', async () => {
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

            expect(config.name).toBe('Bug Triage');
            expect(config.input.from).toBeTruthy();
            expect(isCSVSource(config.input.from!)).toBe(true);
            if (isCSVSource(config.input.from!)) {
                expect(config.input.from.type).toBe('csv');
                expect(config.input.from.path).toBe('./bugs.csv');
            }
            expect(config.map.prompt).toContain('Analyze: {{title}}');
            expect(config.map.output).toEqual(['severity', 'category']);
            expect(config.reduce.type).toBe('list');
        });

        it('parses valid YAML config with inline items', async () => {
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

            expect(config.name).toBe('Inline Test');
            expect(config.input.items).toBeTruthy();
            expect(config.input.items!.length).toBe(2);
            expect(config.input.items![0].feature).toBe('User Auth');
            expect(config.input.items![1].status).toBe('planned');
            expect(config.reduce.type).toBe('table');
        });

        it('parses YAML with limit option', async () => {
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

            expect(config.input.limit).toBe(20);
        });

        it('parses YAML with custom CSV delimiter', async () => {
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

            expect(config.input.from).toBeTruthy();
            expect(isCSVSource(config.input.from!)).toBe(true);
            if (isCSVSource(config.input.from!)) {
                expect(config.input.from.delimiter).toBe('\t');
            }
            expect(config.map.parallel).toBe(3);
        });

        it('parses YAML with model option', async () => {
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

            expect(config.map.model).toBe('gpt-4-turbo');
        });

        it('parses YAML with model and parallel options', async () => {
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

            expect(config.map.model).toBe('claude-3-opus');
            expect(config.map.parallel).toBe(10);
            expect(config.reduce.type).toBe('json');
        });

        it('throws on invalid YAML config - missing input source', async () => {
            const yaml = `
name: "Test"
input: {}
map:
  prompt: "{{x}}"
  output: [y]
reduce:
  type: list
`;

            await expect(parsePipelineYAML(yaml)).rejects.toThrow(PipelineExecutionError);
        });

        it('parses YAML with parameters', async () => {
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

            expect(config.input.parameters).toBeTruthy();
            expect(config.input.parameters!.length).toBe(2);
            expect(config.input.parameters![0].name).toBe('project');
            expect(config.input.parameters![0].value).toBe('MyProject');
            expect(config.input.parameters![1].name).toBe('version');
            expect(config.input.parameters![1].value).toBe('2.0');
        });

        it('parses YAML with parameters and CSV', async () => {
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

            expect(config.input.from).toBeTruthy();
            expect(config.input.parameters).toBeTruthy();
            expect(config.input.parameters!.length).toBe(1);
            expect(config.input.parameters![0].name).toBe('env');
            expect(config.input.parameters![0].value).toBe('production');
        });
    });

    describe('parsePipelineYAMLSync', () => {
        it('parses valid YAML config synchronously with CSV', () => {
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

            expect(config.name).toBe('Sync Test');
            expect(config.input.from).toBeTruthy();
            expect(isCSVSource(config.input.from!)).toBe(true);
            if (isCSVSource(config.input.from!)) {
                expect(config.input.from.type).toBe('csv');
            }
        });

        it('parses valid YAML config synchronously with inline items', () => {
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

            expect(config.name).toBe('Sync Inline Test');
            expect(config.input.items).toBeTruthy();
            expect(config.input.items!.length).toBe(2);
            expect(config.reduce.type).toBe('json');
        });
    });

    describe('DEFAULT_PARALLEL_LIMIT', () => {
        it('has reasonable default value', () => {
            expect(DEFAULT_PARALLEL_LIMIT).toBe(5);
        });
    });

    describe('real-world scenarios from design doc', () => {
        it('executes bug triage pipeline with CSV', async () => {
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

            expect(result.success).toBe(true);
            expect(result.output).toBeTruthy();
            expect(result.output!.results.length).toBe(3);

            // Verify first bug
            const loginBug = result.output!.results.find((r) => r.item['title'] === 'Login broken');
            expect(loginBug).toBeTruthy();
            expect(loginBug!.output.severity).toBe('critical');
            expect(loginBug!.output.category).toBe('backend');
            expect(loginBug!.output.effort_hours).toBe(4);
            expect(loginBug!.output.needs_more_info).toBe(false);

            // Verify formatted output
            expect(result.output!.formattedOutput).toContain('## Results (3 items)');
            expect(result.output!.formattedOutput).toContain('Login broken');
            expect(result.output!.formattedOutput).toContain('critical');
        });

        it('executes feature review pipeline with inline items', async () => {
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

            expect(result.success).toBe(true);
            expect(result.output).toBeTruthy();
            expect(result.output!.results.length).toBe(3);

            // Verify results
            const authFeature = result.output!.results.find((r) => r.item['feature'] === 'User Authentication');
            expect(authFeature).toBeTruthy();
            expect(authFeature!.output.next_steps).toBe('Complete OAuth integration');
            expect(authFeature!.output.priority).toBe('high');
        });

        it('executes pipeline with CSV and limit', async () => {
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

            expect(result.success).toBe(true);
            expect(result.executionStats.totalItems).toBe(20);
            expect(result.output).toBeTruthy();
            expect(result.output!.results.length).toBe(20);
        });
    });
});
