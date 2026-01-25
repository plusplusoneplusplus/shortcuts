/**
 * Tests for Pipeline Batch Mapping
 *
 * Comprehensive tests for batch processing in pipeline execution.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    executePipeline,
    executePipelineWithItems,
    parsePipelineYAML,
    PipelineExecutionError
} from '../../../shortcuts/yaml-pipeline/executor';
import {
    AIInvokerResult,
    PipelineConfig
} from '../../../shortcuts/yaml-pipeline/types';

suite('Pipeline Batch Mapping', () => {
    let tempDir: string;

    setup(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'batch-test-'));
    });

    teardown(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    // Helper to create a mock AI invoker
    function createMockAIInvoker(
        handler: (prompt: string, options?: { model?: string }) => AIInvokerResult | Promise<AIInvokerResult>
    ): (prompt: string, options?: { model?: string }) => Promise<AIInvokerResult> {
        return async (prompt: string, options?: { model?: string }): Promise<AIInvokerResult> => {
            const result = handler(prompt, options);
            return result instanceof Promise ? result : result;
        };
    }

    suite('Basic batch processing', () => {
        test('processes items in batches when batchSize > 1', async () => {
            const config: PipelineConfig = {
                name: 'Batch Test',
                input: {
                    items: [
                        { id: '1', title: 'Bug A' },
                        { id: '2', title: 'Bug B' },
                        { id: '3', title: 'Bug C' },
                        { id: '4', title: 'Bug D' },
                        { id: '5', title: 'Bug E' }
                    ]
                },
                map: {
                    prompt: `Analyze these items:\n{{ITEMS}}\n\nReturn JSON array with results for each.`,
                    output: ['severity'],
                    batchSize: 2  // Process 2 items per AI call
                },
                reduce: { type: 'list' }
            };

            let callCount = 0;
            const aiInvoker = createMockAIInvoker((prompt) => {
                callCount++;
                // Parse the items from the prompt to determine batch size
                const itemsMatch = prompt.match(/\[[\s\S]*?\]/);
                if (itemsMatch) {
                    const items = JSON.parse(itemsMatch[0]);
                    // Return array with one result per item
                    const results = items.map((item: { id: string }) => ({
                        severity: item.id === '1' || item.id === '2' ? 'high' : 'low'
                    }));
                    return { success: true, response: JSON.stringify(results) };
                }
                return { success: true, response: '[{"severity": "medium"}]' };
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.ok(result.output);
            assert.strictEqual(result.output.results.length, 5);
            
            // With 5 items and batchSize 2, we should have 3 AI calls (2+2+1)
            assert.strictEqual(callCount, 3, 'Should make 3 AI calls for 5 items with batchSize 2');
        });

        test('batchSize 1 behaves like standard mode', async () => {
            const config: PipelineConfig = {
                name: 'Single Batch Test',
                input: {
                    items: [
                        { id: '1', title: 'Bug A' },
                        { id: '2', title: 'Bug B' }
                    ]
                },
                map: {
                    prompt: 'Analyze: {{title}}',
                    output: ['severity'],
                    batchSize: 1  // Explicit batchSize 1
                },
                reduce: { type: 'list' }
            };

            let callCount = 0;
            const aiInvoker = createMockAIInvoker(() => {
                callCount++;
                return { success: true, response: '{"severity": "high"}' };
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(callCount, 2, 'Should make 2 AI calls for 2 items with batchSize 1');
        });

        test('default batchSize is 1 (backward compatible)', async () => {
            const config: PipelineConfig = {
                name: 'Default Batch Test',
                input: {
                    items: [
                        { id: '1', title: 'Bug A' },
                        { id: '2', title: 'Bug B' }
                    ]
                },
                map: {
                    prompt: 'Analyze: {{title}}',
                    output: ['severity']
                    // No batchSize specified - should default to 1
                },
                reduce: { type: 'list' }
            };

            let callCount = 0;
            const aiInvoker = createMockAIInvoker(() => {
                callCount++;
                return { success: true, response: '{"severity": "high"}' };
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(callCount, 2, 'Should make 2 AI calls for 2 items without batchSize');
        });
    });

    suite('Batch size calculations', () => {
        test('handles exact batch division (10 items, batchSize 5)', async () => {
            const items = Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1), title: `Item ${i + 1}` }));
            
            const config: PipelineConfig = {
                name: 'Exact Division Test',
                input: { items },
                map: {
                    prompt: 'Analyze:\n{{ITEMS}}',
                    output: ['result'],
                    batchSize: 5
                },
                reduce: { type: 'list' }
            };

            let callCount = 0;
            const batchSizes: number[] = [];
            
            const aiInvoker = createMockAIInvoker((prompt) => {
                callCount++;
                const itemsMatch = prompt.match(/\[[\s\S]*?\]/);
                if (itemsMatch) {
                    const items = JSON.parse(itemsMatch[0]);
                    batchSizes.push(items.length);
                    const results = items.map(() => ({ result: 'ok' }));
                    return { success: true, response: JSON.stringify(results) };
                }
                return { success: true, response: '[{"result": "ok"}]' };
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(callCount, 2, 'Should make 2 AI calls for 10 items with batchSize 5');
            assert.deepStrictEqual(batchSizes, [5, 5], 'Each batch should have 5 items');
        });

        test('handles remainder batch (95 items, batchSize 10)', async () => {
            const items = Array.from({ length: 95 }, (_, i) => ({ id: String(i + 1), title: `Item ${i + 1}` }));
            
            const config: PipelineConfig = {
                name: 'Remainder Test',
                input: { items },
                map: {
                    prompt: 'Analyze:\n{{ITEMS}}',
                    output: ['result'],
                    batchSize: 10,
                    parallel: 10  // Allow more concurrency for faster test
                },
                reduce: { type: 'list' }
            };

            let callCount = 0;
            const batchSizes: number[] = [];
            
            const aiInvoker = createMockAIInvoker((prompt) => {
                callCount++;
                const itemsMatch = prompt.match(/\[[\s\S]*?\]/);
                if (itemsMatch) {
                    const items = JSON.parse(itemsMatch[0]);
                    batchSizes.push(items.length);
                    const results = items.map(() => ({ result: 'ok' }));
                    return { success: true, response: JSON.stringify(results) };
                }
                return { success: true, response: '[{"result": "ok"}]' };
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(callCount, 10, 'Should make 10 AI calls for 95 items with batchSize 10');
            
            // 9 batches of 10, 1 batch of 5
            const expectedBatches = [...Array(9).fill(10), 5];
            batchSizes.sort((a, b) => b - a);  // Sort descending for comparison
            expectedBatches.sort((a, b) => b - a);
            assert.deepStrictEqual(batchSizes, expectedBatches, 'Should have 9 batches of 10 and 1 batch of 5');
        });

        test('handles single item with batchSize > 1', async () => {
            const config: PipelineConfig = {
                name: 'Single Item Test',
                input: {
                    items: [{ id: '1', title: 'Only Item' }]
                },
                map: {
                    prompt: 'Analyze:\n{{ITEMS}}',
                    output: ['result'],
                    batchSize: 10
                },
                reduce: { type: 'list' }
            };

            let callCount = 0;
            const aiInvoker = createMockAIInvoker(() => {
                callCount++;
                return { success: true, response: '[{"result": "ok"}]' };
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(callCount, 1, 'Should make 1 AI call for 1 item');
            assert.strictEqual(result.output?.results.length, 1);
        });

        test('handles empty items with batchSize > 1', async () => {
            const config: PipelineConfig = {
                name: 'Empty Items Test',
                input: { items: [] },
                map: {
                    prompt: 'Analyze:\n{{ITEMS}}',
                    output: ['result'],
                    batchSize: 10
                },
                reduce: { type: 'list' }
            };

            let callCount = 0;
            const aiInvoker = createMockAIInvoker(() => {
                callCount++;
                return { success: true, response: '[]' };
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(callCount, 0, 'Should make 0 AI calls for empty items');
        });
    });

    suite('Error handling', () => {
        test('marks all items in batch as failed when AI returns wrong count', async () => {
            const config: PipelineConfig = {
                name: 'Wrong Count Test',
                input: {
                    items: [
                        { id: '1', title: 'Bug A' },
                        { id: '2', title: 'Bug B' },
                        { id: '3', title: 'Bug C' }
                    ]
                },
                map: {
                    prompt: 'Analyze:\n{{ITEMS}}',
                    output: ['severity'],
                    batchSize: 3
                },
                reduce: { type: 'list' }
            };

            const aiInvoker = createMockAIInvoker(() => {
                // Return only 2 results instead of 3
                return { 
                    success: true, 
                    response: '[{"severity": "high"}, {"severity": "low"}]' 
                };
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            // All items should be marked as failed due to count mismatch
            assert.strictEqual(result.success, false);
            assert.ok(result.output);
            assert.strictEqual(result.output.results.length, 3);
            assert.ok(result.output.results.every(r => !r.success));
            assert.ok(result.output.results[0].error?.includes('returned 2 results but batch has 3 items'));
        });

        test('handles AI failure for entire batch', async () => {
            const config: PipelineConfig = {
                name: 'AI Failure Test',
                input: {
                    items: [
                        { id: '1', title: 'Bug A' },
                        { id: '2', title: 'Bug B' }
                    ]
                },
                map: {
                    prompt: 'Analyze:\n{{ITEMS}}',
                    output: ['severity'],
                    batchSize: 2
                },
                reduce: { type: 'list' }
            };

            const aiInvoker = createMockAIInvoker(() => {
                return { success: false, error: 'AI service unavailable' };
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, false);
            assert.ok(result.output);
            assert.strictEqual(result.output.results.length, 2);
            assert.ok(result.output.results.every(r => !r.success));
            assert.ok(result.output.results[0].error?.includes('AI service unavailable'));
        });

        test('handles invalid JSON response', async () => {
            const config: PipelineConfig = {
                name: 'Invalid JSON Test',
                input: {
                    items: [
                        { id: '1', title: 'Bug A' },
                        { id: '2', title: 'Bug B' }
                    ]
                },
                map: {
                    prompt: 'Analyze:\n{{ITEMS}}',
                    output: ['severity'],
                    batchSize: 2
                },
                reduce: { type: 'list' }
            };

            const aiInvoker = createMockAIInvoker(() => {
                return { success: true, response: 'This is not JSON at all!' };
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, false);
            assert.ok(result.output);
            assert.strictEqual(result.output.results.length, 2);
            assert.ok(result.output.results.every(r => !r.success));
            assert.ok(result.output.results[0].error?.includes('parse'));
        });

        test('retries batch on timeout with doubled timeout', async () => {
            let attemptCount = 0;

            const config: PipelineConfig = {
                name: 'Timeout Retry Test',
                input: {
                    items: [
                        { id: '1', title: 'Bug A' },
                        { id: '2', title: 'Bug B' }
                    ]
                },
                map: {
                    prompt: 'Analyze:\n{{ITEMS}}',
                    output: ['severity'],
                    batchSize: 2,
                    timeoutMs: 50  // First timeout at 50ms, retry at 100ms
                },
                reduce: { type: 'list' }
            };

            const aiInvoker = createMockAIInvoker(async () => {
                attemptCount++;
                // 75ms delay: will timeout on first attempt (50ms) but succeed on retry (100ms)
                await new Promise(resolve => setTimeout(resolve, 75));
                return { 
                    success: true, 
                    response: '[{"severity": "high"}, {"severity": "low"}]' 
                };
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(attemptCount, 2, 'Should have attempted twice (initial + timeout retry)');
        });
    });

    suite('Validation', () => {
        test('throws for invalid batchSize (not a number)', async () => {
            const config = {
                name: 'Invalid BatchSize Test',
                input: {
                    items: [{ id: '1', title: 'Bug A' }]
                },
                map: {
                    prompt: 'Analyze:\n{{ITEMS}}',
                    output: ['severity'],
                    batchSize: 'ten'  // Invalid - should be number
                },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(() => ({ success: true, response: '[]' })),
                    pipelineDirectory: tempDir
                }),
                /batchSize.*must be.*positive integer/i
            );
        });

        test('throws for invalid batchSize (less than 1)', async () => {
            const config: PipelineConfig = {
                name: 'Zero BatchSize Test',
                input: {
                    items: [{ id: '1', title: 'Bug A' }]
                },
                map: {
                    prompt: 'Analyze:\n{{ITEMS}}',
                    output: ['severity'],
                    batchSize: 0  // Invalid - must be at least 1
                },
                reduce: { type: 'list' }
            };

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(() => ({ success: true, response: '[]' })),
                    pipelineDirectory: tempDir
                }),
                /batchSize.*must be at least 1/i
            );
        });

        test('throws for negative batchSize', async () => {
            const config: PipelineConfig = {
                name: 'Negative BatchSize Test',
                input: {
                    items: [{ id: '1', title: 'Bug A' }]
                },
                map: {
                    prompt: 'Analyze:\n{{ITEMS}}',
                    output: ['severity'],
                    batchSize: -5  // Invalid - must be positive
                },
                reduce: { type: 'list' }
            };

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(() => ({ success: true, response: '[]' })),
                    pipelineDirectory: tempDir
                }),
                /batchSize.*must be at least 1/i
            );
        });

        test('throws for non-integer batchSize', async () => {
            const config: PipelineConfig = {
                name: 'Float BatchSize Test',
                input: {
                    items: [{ id: '1', title: 'Bug A' }]
                },
                map: {
                    prompt: 'Analyze:\n{{ITEMS}}',
                    output: ['severity'],
                    batchSize: 2.5  // Invalid - must be integer
                },
                reduce: { type: 'list' }
            };

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(() => ({ success: true, response: '[]' })),
                    pipelineDirectory: tempDir
                }),
                /batchSize.*must be.*positive integer/i
            );
        });
    });

    suite('YAML parsing', () => {
        test('parses YAML with batchSize', async () => {
            const yaml = `
name: "Batch Pipeline"
input:
  items:
    - id: "1"
      title: "Bug A"
map:
  prompt: |
    Analyze these items:
    {{ITEMS}}
  output: [severity]
  batchSize: 10
reduce:
  type: list
`;

            const config = await parsePipelineYAML(yaml);

            assert.strictEqual(config.map.batchSize, 10);
        });

        test('parses YAML without batchSize (defaults to undefined)', async () => {
            const yaml = `
name: "No Batch Pipeline"
input:
  items:
    - id: "1"
      title: "Bug A"
map:
  prompt: "Analyze: {{title}}"
  output: [severity]
reduce:
  type: list
`;

            const config = await parsePipelineYAML(yaml);

            assert.strictEqual(config.map.batchSize, undefined);
        });
    });

    suite('Integration with other features', () => {
        test('batch mode works with parameters', async () => {
            const config: PipelineConfig = {
                name: 'Batch with Params Test',
                input: {
                    items: [
                        { id: '1', title: 'Bug A' },
                        { id: '2', title: 'Bug B' }
                    ],
                    parameters: [
                        { name: 'project', value: 'MyProject' }
                    ]
                },
                map: {
                    prompt: 'Project: {{project}}\nItems:\n{{ITEMS}}',
                    output: ['severity'],
                    batchSize: 2
                },
                reduce: { type: 'list' }
            };

            let receivedPrompt = '';
            const aiInvoker = createMockAIInvoker((prompt) => {
                receivedPrompt = prompt;
                return { 
                    success: true, 
                    response: '[{"severity": "high"}, {"severity": "low"}]' 
                };
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            // Parameters should be merged into items before batching
            assert.ok(receivedPrompt.includes('Project: MyProject'));
        });

        test('batch mode works with limit', async () => {
            const config: PipelineConfig = {
                name: 'Batch with Limit Test',
                input: {
                    items: Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1), title: `Item ${i + 1}` })),
                    limit: 5  // Only process first 5 items
                },
                map: {
                    prompt: 'Analyze:\n{{ITEMS}}',
                    output: ['result'],
                    batchSize: 2
                },
                reduce: { type: 'list' }
            };

            let callCount = 0;
            const aiInvoker = createMockAIInvoker((prompt) => {
                callCount++;
                const itemsMatch = prompt.match(/\[[\s\S]*?\]/);
                if (itemsMatch) {
                    const items = JSON.parse(itemsMatch[0]);
                    const results = items.map(() => ({ result: 'ok' }));
                    return { success: true, response: JSON.stringify(results) };
                }
                return { success: true, response: '[{"result": "ok"}]' };
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.output?.results.length, 5, 'Should only process 5 items');
            assert.strictEqual(callCount, 3, 'Should make 3 AI calls for 5 items with batchSize 2');
        });

        test('batch mode works with AI reduce', async () => {
            const config: PipelineConfig = {
                name: 'Batch with AI Reduce Test',
                input: {
                    items: [
                        { id: '1', title: 'Bug A' },
                        { id: '2', title: 'Bug B' },
                        { id: '3', title: 'Bug C' },
                        { id: '4', title: 'Bug D' }
                    ]
                },
                map: {
                    prompt: 'Analyze:\n{{ITEMS}}',
                    output: ['severity'],
                    batchSize: 2
                },
                reduce: {
                    type: 'ai',
                    prompt: 'Summarize {{COUNT}} results:\n{{RESULTS}}',
                    output: ['summary']
                }
            };

            let reducePromptReceived = false;
            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Summarize')) {
                    reducePromptReceived = true;
                    return { success: true, response: '{"summary": "All bugs analyzed"}' };
                }
                // Map phase - return batch results
                const itemsMatch = prompt.match(/\[[\s\S]*?\]/);
                if (itemsMatch) {
                    const items = JSON.parse(itemsMatch[0]);
                    const results = items.map(() => ({ severity: 'high' }));
                    return { success: true, response: JSON.stringify(results) };
                }
                return { success: true, response: '[{"severity": "high"}]' };
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.ok(reducePromptReceived, 'AI reduce should have been called');
        });

        test('batch mode works with executePipelineWithItems', async () => {
            const config: PipelineConfig = {
                name: 'Batch with Pre-approved Items Test',
                input: {
                    generate: {
                        prompt: 'Generate items',
                        schema: ['name', 'value']
                    }
                },
                map: {
                    prompt: 'Analyze:\n{{ITEMS}}',
                    output: ['result'],
                    batchSize: 2
                },
                reduce: { type: 'list' }
            };

            const items = [
                { name: 'Item 1', value: '100' },
                { name: 'Item 2', value: '200' },
                { name: 'Item 3', value: '300' }
            ];

            let callCount = 0;
            const aiInvoker = createMockAIInvoker((prompt) => {
                callCount++;
                const itemsMatch = prompt.match(/\[[\s\S]*?\]/);
                if (itemsMatch) {
                    const items = JSON.parse(itemsMatch[0]);
                    const results = items.map(() => ({ result: 'ok' }));
                    return { success: true, response: JSON.stringify(results) };
                }
                return { success: true, response: '[{"result": "ok"}]' };
            });

            const result = await executePipelineWithItems(config, items, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.output?.results.length, 3);
            assert.strictEqual(callCount, 2, 'Should make 2 AI calls for 3 items with batchSize 2');
        });
    });

    suite('Progress reporting', () => {
        test('reports progress in batch mode', async () => {
            const config: PipelineConfig = {
                name: 'Progress Test',
                input: {
                    items: Array.from({ length: 6 }, (_, i) => ({ id: String(i + 1), title: `Item ${i + 1}` }))
                },
                map: {
                    prompt: 'Analyze:\n{{ITEMS}}',
                    output: ['result'],
                    batchSize: 2
                },
                reduce: { type: 'list' }
            };

            const progressUpdates: { phase: string; message?: string }[] = [];

            const aiInvoker = createMockAIInvoker((prompt) => {
                const itemsMatch = prompt.match(/\[[\s\S]*?\]/);
                if (itemsMatch) {
                    const items = JSON.parse(itemsMatch[0]);
                    const results = items.map(() => ({ result: 'ok' }));
                    return { success: true, response: JSON.stringify(results) };
                }
                return { success: true, response: '[{"result": "ok"}]' };
            });

            await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir,
                onProgress: (progress) => {
                    progressUpdates.push({ phase: progress.phase, message: progress.message });
                }
            });

            // Should have progress updates for mapping phase
            const mappingUpdates = progressUpdates.filter(p => p.phase === 'mapping');
            assert.ok(mappingUpdates.length > 0, 'Should have mapping progress updates');
            
            // Should mention batches in progress messages
            assert.ok(
                mappingUpdates.some(p => p.message?.includes('batch')),
                'Progress should mention batches'
            );

            // Should have complete phase
            const completeUpdate = progressUpdates.find(p => p.phase === 'complete');
            assert.ok(completeUpdate, 'Should have complete progress update');
        });
    });

    suite('Concurrency', () => {
        test('respects parallel limit in batch mode', async () => {
            const config: PipelineConfig = {
                name: 'Concurrency Test',
                input: {
                    items: Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1), title: `Item ${i + 1}` }))
                },
                map: {
                    prompt: 'Analyze:\n{{ITEMS}}',
                    output: ['result'],
                    batchSize: 2,
                    parallel: 2  // Only 2 concurrent batches
                },
                reduce: { type: 'list' }
            };

            let maxConcurrent = 0;
            let currentConcurrent = 0;

            const aiInvoker = createMockAIInvoker(async (prompt) => {
                currentConcurrent++;
                maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

                // Simulate some work
                await new Promise(resolve => setTimeout(resolve, 10));

                currentConcurrent--;
                
                const itemsMatch = prompt.match(/\[[\s\S]*?\]/);
                if (itemsMatch) {
                    const items = JSON.parse(itemsMatch[0]);
                    const results = items.map(() => ({ result: 'ok' }));
                    return { success: true, response: JSON.stringify(results) };
                }
                return { success: true, response: '[{"result": "ok"}]' };
            });

            await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.ok(maxConcurrent <= 2, `Max concurrent was ${maxConcurrent}, expected <= 2`);
        });
    });

    suite('Output formats', () => {
        test('batch mode works with table reduce', async () => {
            const config: PipelineConfig = {
                name: 'Table Reduce Test',
                input: {
                    items: [
                        { id: '1', title: 'Bug A' },
                        { id: '2', title: 'Bug B' }
                    ]
                },
                map: {
                    prompt: 'Analyze:\n{{ITEMS}}',
                    output: ['severity', 'category'],
                    batchSize: 2
                },
                reduce: { type: 'table' }
            };

            const aiInvoker = createMockAIInvoker(() => {
                return { 
                    success: true, 
                    response: '[{"severity": "high", "category": "backend"}, {"severity": "low", "category": "frontend"}]' 
                };
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.ok(result.output?.formattedOutput.includes('|'));  // Table format
            assert.ok(result.output?.formattedOutput.includes('severity'));
            assert.ok(result.output?.formattedOutput.includes('category'));
        });

        test('batch mode works with json reduce', async () => {
            const config: PipelineConfig = {
                name: 'JSON Reduce Test',
                input: {
                    items: [
                        { id: '1', title: 'Bug A' },
                        { id: '2', title: 'Bug B' }
                    ]
                },
                map: {
                    prompt: 'Analyze:\n{{ITEMS}}',
                    output: ['severity'],
                    batchSize: 2
                },
                reduce: { type: 'json' }
            };

            const aiInvoker = createMockAIInvoker(() => {
                return { 
                    success: true, 
                    response: '[{"severity": "high"}, {"severity": "low"}]' 
                };
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            // Should be valid JSON
            const parsed = JSON.parse(result.output!.formattedOutput);
            assert.ok(Array.isArray(parsed));
        });

        test('batch mode works with csv reduce', async () => {
            const config: PipelineConfig = {
                name: 'CSV Reduce Test',
                input: {
                    items: [
                        { id: '1', title: 'Bug A' },
                        { id: '2', title: 'Bug B' }
                    ]
                },
                map: {
                    prompt: 'Analyze:\n{{ITEMS}}',
                    output: ['severity'],
                    batchSize: 2
                },
                reduce: { type: 'csv' }
            };

            const aiInvoker = createMockAIInvoker(() => {
                return { 
                    success: true, 
                    response: '[{"severity": "high"}, {"severity": "low"}]' 
                };
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.ok(result.output?.formattedOutput.includes(','));  // CSV format
            assert.ok(result.output?.formattedOutput.includes('severity') || result.output?.formattedOutput.includes('out_severity'));
        });
    });
});
