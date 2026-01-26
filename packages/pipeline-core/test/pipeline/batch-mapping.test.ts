/**
 * Tests for Pipeline Batch Mapping
 *
 * Comprehensive tests for batch processing in pipeline execution.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    executePipeline,
    executePipelineWithItems,
    parsePipelineYAML
} from '../../src/pipeline';
import {
    AIInvokerResult,
    PipelineConfig
} from '../../src/pipeline/types';

describe('Pipeline Batch Mapping', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'batch-test-'));
    });

    afterEach(async () => {
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

    describe('Basic batch processing', () => {
        it('processes items in batches when batchSize > 1', async () => {
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

            expect(result.success).toBe(true);
            expect(result.output).toBeTruthy();
            expect(result.output!.results.length).toBe(5);
            
            // With 5 items and batchSize 2, we should have 3 AI calls (2+2+1)
            expect(callCount).toBe(3);
        });

        it('batchSize 1 behaves like standard mode', async () => {
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

            expect(result.success).toBe(true);
            expect(callCount).toBe(2);
        });

        it('default batchSize is 1 (backward compatible)', async () => {
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

            expect(result.success).toBe(true);
            expect(callCount).toBe(2);
        });
    });

    describe('Batch size calculations', () => {
        it('handles exact batch division (10 items, batchSize 5)', async () => {
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

            expect(result.success).toBe(true);
            expect(callCount).toBe(2);
            expect(batchSizes).toEqual([5, 5]);
        });

        it('handles remainder batch (95 items, batchSize 10)', async () => {
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

            expect(result.success).toBe(true);
            expect(callCount).toBe(10);
            
            // 9 batches of 10, 1 batch of 5
            const expectedBatches = [...Array(9).fill(10), 5];
            batchSizes.sort((a, b) => b - a);  // Sort descending for comparison
            expectedBatches.sort((a, b) => b - a);
            expect(batchSizes).toEqual(expectedBatches);
        });

        it('handles single item with batchSize > 1', async () => {
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

            expect(result.success).toBe(true);
            expect(callCount).toBe(1);
            expect(result.output?.results.length).toBe(1);
        });

        it('handles empty items with batchSize > 1', async () => {
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

            expect(result.success).toBe(true);
            expect(callCount).toBe(0);
        });
    });

    describe('Error handling', () => {
        it('marks all items in batch as failed when AI returns wrong count', async () => {
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
            expect(result.success).toBe(false);
            expect(result.output).toBeTruthy();
            expect(result.output!.results.length).toBe(3);
            expect(result.output!.results.every(r => !r.success)).toBe(true);
            expect(result.output!.results[0].error).toContain('returned 2 results but batch has 3 items');
        });

        it('handles AI failure for entire batch', async () => {
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

            expect(result.success).toBe(false);
            expect(result.output).toBeTruthy();
            expect(result.output!.results.length).toBe(2);
            expect(result.output!.results.every(r => !r.success)).toBe(true);
            expect(result.output!.results[0].error).toContain('AI service unavailable');
        });

        it('handles invalid JSON response', async () => {
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

            expect(result.success).toBe(false);
            expect(result.output).toBeTruthy();
            expect(result.output!.results.length).toBe(2);
            expect(result.output!.results.every(r => !r.success)).toBe(true);
            expect(result.output!.results[0].error).toContain('parse');
        });

        it('retries batch on timeout with doubled timeout', async () => {
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

            expect(result.success).toBe(true);
            expect(attemptCount).toBe(2);
        });
    });

    describe('Validation', () => {
        it('throws for invalid batchSize (not a number)', async () => {
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

            await expect(
                executePipeline(config, {
                    aiInvoker: createMockAIInvoker(() => ({ success: true, response: '[]' })),
                    pipelineDirectory: tempDir
                })
            ).rejects.toThrow(/batchSize.*must be.*positive integer/i);
        });

        it('throws for invalid batchSize (less than 1)', async () => {
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

            await expect(
                executePipeline(config, {
                    aiInvoker: createMockAIInvoker(() => ({ success: true, response: '[]' })),
                    pipelineDirectory: tempDir
                })
            ).rejects.toThrow(/batchSize.*must be at least 1/i);
        });

        it('throws for negative batchSize', async () => {
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

            await expect(
                executePipeline(config, {
                    aiInvoker: createMockAIInvoker(() => ({ success: true, response: '[]' })),
                    pipelineDirectory: tempDir
                })
            ).rejects.toThrow(/batchSize.*must be at least 1/i);
        });

        it('throws for non-integer batchSize', async () => {
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

            await expect(
                executePipeline(config, {
                    aiInvoker: createMockAIInvoker(() => ({ success: true, response: '[]' })),
                    pipelineDirectory: tempDir
                })
            ).rejects.toThrow(/batchSize.*must be.*positive integer/i);
        });
    });

    describe('YAML parsing', () => {
        it('parses YAML with batchSize', async () => {
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

            expect(config.map.batchSize).toBe(10);
        });

        it('parses YAML without batchSize (defaults to undefined)', async () => {
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

            expect(config.map.batchSize).toBeUndefined();
        });
    });

    describe('Integration with other features', () => {
        it('batch mode works with parameters', async () => {
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

            expect(result.success).toBe(true);
            // Parameters should be merged into items before batching
            expect(receivedPrompt).toContain('Project: MyProject');
        });

        it('batch mode works with limit', async () => {
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

            expect(result.success).toBe(true);
            expect(result.output?.results.length).toBe(5);
            expect(callCount).toBe(3);
        });

        it('batch mode works with AI reduce', async () => {
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

            expect(result.success).toBe(true);
            expect(reducePromptReceived).toBe(true);
        });

        it('batch mode works with executePipelineWithItems', async () => {
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

            expect(result.success).toBe(true);
            expect(result.output?.results.length).toBe(3);
            expect(callCount).toBe(2);
        });
    });

    describe('Progress reporting', () => {
        it('reports progress in batch mode', async () => {
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
            expect(mappingUpdates.length).toBeGreaterThan(0);
            
            // Should mention batches in progress messages
            expect(mappingUpdates.some(p => p.message?.includes('batch'))).toBe(true);

            // Should have complete phase
            const completeUpdate = progressUpdates.find(p => p.phase === 'complete');
            expect(completeUpdate).toBeTruthy();
        });
    });

    describe('Concurrency', () => {
        it('respects parallel limit in batch mode', async () => {
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

            expect(maxConcurrent).toBeLessThanOrEqual(2);
        });
    });

    describe('Output formats', () => {
        it('batch mode works with table reduce', async () => {
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

            expect(result.success).toBe(true);
            expect(result.output?.formattedOutput).toContain('|');  // Table format
            expect(result.output?.formattedOutput).toContain('severity');
            expect(result.output?.formattedOutput).toContain('category');
        });

        it('batch mode works with json reduce', async () => {
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

            expect(result.success).toBe(true);
            // Should be valid JSON
            const parsed = JSON.parse(result.output!.formattedOutput);
            expect(Array.isArray(parsed)).toBe(true);
        });

        it('batch mode works with csv reduce', async () => {
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

            expect(result.success).toBe(true);
            expect(result.output?.formattedOutput).toContain(',');  // CSV format
            expect(result.output?.formattedOutput.includes('severity') || result.output?.formattedOutput.includes('out_severity')).toBe(true);
        });
    });
});
