/**
 * Tests for Multi-Model Fanout Feature
 *
 * Tests the ability to:
 * 1. Use inline arrays in `from` for multi-model fanout
 * 2. Use template substitution in the `model` field (e.g., {{model}})
 * 3. Combine both for consensus-style pipelines
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    executePipeline,
    parsePipelineYAMLSync
} from '../../src/pipeline';
import { isCSVSource } from '../../src/pipeline/types';
import type {
    AIInvokerResult,
    PipelineConfig
} from '../../src/pipeline/types';

describe('Multi-Model Fanout', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fanout-test-'));
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    // Helper to create a mock AI invoker that tracks model usage
    function createModelTrackingInvoker(): {
        invoker: (prompt: string, options?: { model?: string }) => Promise<AIInvokerResult>;
        getModelCalls: () => { model: string | undefined; prompt: string }[];
    } {
        const calls: { model: string | undefined; prompt: string }[] = [];

        const invoker = async (prompt: string, options?: { model?: string }): Promise<AIInvokerResult> => {
            calls.push({ model: options?.model, prompt });
            // Return different responses based on model to verify fanout
            const modelName = options?.model || 'default';
            return {
                success: true,
                response: JSON.stringify({
                    verdict: `ok-from-${modelName}`,
                    reasoning: `Analysis by ${modelName}`
                })
            };
        };

        return { invoker, getModelCalls: () => calls };
    }

    describe('isCSVSource type guard', () => {
        it('returns true for valid CSV source', () => {
            expect(isCSVSource({ type: 'csv', path: 'test.csv' })).toBe(true);
            expect(isCSVSource({ type: 'csv', path: 'test.csv', delimiter: ';' })).toBe(true);
        });

        it('returns false for arrays', () => {
            expect(isCSVSource([])).toBe(false);
            expect(isCSVSource([{ model: 'gpt-4' }])).toBe(false);
        });

        it('returns false for invalid objects', () => {
            expect(isCSVSource(null)).toBe(false);
            expect(isCSVSource(undefined)).toBe(false);
            expect(isCSVSource({})).toBe(false);
            expect(isCSVSource({ type: 'json', path: 'test.json' })).toBe(false);
            expect(isCSVSource({ type: 'csv' })).toBe(false); // missing path
            expect(isCSVSource({ path: 'test.csv' })).toBe(false); // missing type
        });
    });

    describe('Inline array in from', () => {
        it('executes pipeline with inline array from', async () => {
            const config: PipelineConfig = {
                name: 'Inline Array Test',
                input: {
                    from: [
                        { id: '1', title: 'Item A' },
                        { id: '2', title: 'Item B' }
                    ]
                },
                map: {
                    prompt: 'Process: {{title}}',
                    output: ['result']
                },
                reduce: { type: 'list' }
            };

            const { invoker } = createModelTrackingInvoker();

            const result = await executePipeline(config, {
                aiInvoker: invoker,
                pipelineDirectory: tempDir
            });

            expect(result.success).toBe(true);
            expect(result.output?.results.length).toBe(2);
        });

        it('merges parameters with inline array items', async () => {
            const config: PipelineConfig = {
                name: 'Merge Parameters Test',
                input: {
                    from: [
                        { model: 'gpt-4' },
                        { model: 'claude-sonnet' }
                    ],
                    parameters: [
                        { name: 'code', value: 'const x = 1;' },
                        { name: 'question', value: 'Is this valid?' }
                    ]
                },
                map: {
                    prompt: '{{question}}\nCode: {{code}}',
                    output: ['answer']
                },
                reduce: { type: 'list' }
            };

            const { invoker, getModelCalls } = createModelTrackingInvoker();

            const result = await executePipeline(config, {
                aiInvoker: invoker,
                pipelineDirectory: tempDir
            });

            expect(result.success).toBe(true);
            expect(result.output?.results.length).toBe(2);

            // Verify both prompts contain the merged parameters
            const calls = getModelCalls();
            expect(calls.length).toBe(2);
            expect(calls[0].prompt).toContain('Is this valid?');
            expect(calls[0].prompt).toContain('const x = 1;');
            expect(calls[1].prompt).toContain('Is this valid?');
            expect(calls[1].prompt).toContain('const x = 1;');
        });

        it('handles empty inline array', async () => {
            const config: PipelineConfig = {
                name: 'Empty Array Test',
                input: {
                    from: []
                },
                map: {
                    prompt: '{{title}}',
                    output: ['result']
                },
                reduce: { type: 'list' }
            };

            const { invoker } = createModelTrackingInvoker();

            const result = await executePipeline(config, {
                aiInvoker: invoker,
                pipelineDirectory: tempDir
            });

            expect(result.success).toBe(true);
            expect(result.executionStats.totalItems).toBe(0);
        });

        it('applies limit to inline array', async () => {
            const config: PipelineConfig = {
                name: 'Limit Array Test',
                input: {
                    from: [
                        { id: '1' },
                        { id: '2' },
                        { id: '3' },
                        { id: '4' },
                        { id: '5' }
                    ],
                    limit: 2
                },
                map: {
                    prompt: 'Process {{id}}',
                    output: ['result']
                },
                reduce: { type: 'list' }
            };

            const { invoker } = createModelTrackingInvoker();

            const result = await executePipeline(config, {
                aiInvoker: invoker,
                pipelineDirectory: tempDir
            });

            expect(result.success).toBe(true);
            expect(result.output?.results.length).toBe(2);
            expect(result.output?.results[0].item.id).toBe('1');
            expect(result.output?.results[1].item.id).toBe('2');
        });
    });

    describe('Template model substitution', () => {
        it('substitutes model from item field', async () => {
            const config: PipelineConfig = {
                name: 'Dynamic Model Test',
                input: {
                    items: [
                        { title: 'Test', model: 'gpt-4' },
                        { title: 'Test', model: 'claude-sonnet' }
                    ]
                },
                map: {
                    prompt: 'Analyze: {{title}}',
                    output: ['verdict', 'reasoning'],
                    model: '{{model}}'  // Dynamic model from item
                },
                reduce: { type: 'list' }
            };

            const { invoker, getModelCalls } = createModelTrackingInvoker();

            const result = await executePipeline(config, {
                aiInvoker: invoker,
                pipelineDirectory: tempDir
            });

            expect(result.success).toBe(true);
            expect(result.output?.results.length).toBe(2);

            // Verify correct models were used
            const calls = getModelCalls();
            expect(calls.length).toBe(2);
            expect(calls[0].model).toBe('gpt-4');
            expect(calls[1].model).toBe('claude-sonnet');
        });

        it('static model still works', async () => {
            const config: PipelineConfig = {
                name: 'Static Model Test',
                input: {
                    items: [
                        { title: 'Test A' },
                        { title: 'Test B' }
                    ]
                },
                map: {
                    prompt: 'Analyze: {{title}}',
                    output: ['result'],
                    model: 'gpt-4-turbo'  // Static model
                },
                reduce: { type: 'list' }
            };

            const { invoker, getModelCalls } = createModelTrackingInvoker();

            const result = await executePipeline(config, {
                aiInvoker: invoker,
                pipelineDirectory: tempDir
            });

            expect(result.success).toBe(true);

            // Verify same model used for both
            const calls = getModelCalls();
            expect(calls[0].model).toBe('gpt-4-turbo');
            expect(calls[1].model).toBe('gpt-4-turbo');
        });

        it('undefined model when template variable missing', async () => {
            const config: PipelineConfig = {
                name: 'Missing Model Field Test',
                input: {
                    items: [
                        { title: 'Test' }  // No model field
                    ]
                },
                map: {
                    prompt: 'Analyze: {{title}}',
                    output: ['result'],
                    model: '{{model}}'  // Template but no model in item
                },
                reduce: { type: 'list' }
            };

            const { invoker, getModelCalls } = createModelTrackingInvoker();

            const result = await executePipeline(config, {
                aiInvoker: invoker,
                pipelineDirectory: tempDir
            });

            expect(result.success).toBe(true);

            // Model should be undefined (empty string becomes undefined)
            const calls = getModelCalls();
            expect(calls[0].model).toBeUndefined();
        });

        it('no model when not specified', async () => {
            const config: PipelineConfig = {
                name: 'No Model Test',
                input: {
                    items: [{ title: 'Test' }]
                },
                map: {
                    prompt: 'Analyze: {{title}}',
                    output: ['result']
                    // No model specified
                },
                reduce: { type: 'list' }
            };

            const { invoker, getModelCalls } = createModelTrackingInvoker();

            const result = await executePipeline(config, {
                aiInvoker: invoker,
                pipelineDirectory: tempDir
            });

            expect(result.success).toBe(true);

            const calls = getModelCalls();
            expect(calls[0].model).toBeUndefined();
        });
    });

    describe('Multi-model fanout pattern', () => {
        it('full multi-model fanout with parameters and dynamic model', async () => {
            const config: PipelineConfig = {
                name: 'Multi-Model Code Review',
                input: {
                    from: [
                        { model: 'gpt-4' },
                        { model: 'claude-sonnet' },
                        { model: 'gemini-pro' }
                    ],
                    parameters: [
                        { name: 'code', value: 'function add(a, b) { return a + b; }' }
                    ]
                },
                map: {
                    prompt: 'Review this code:\n{{code}}',
                    output: ['verdict', 'reasoning'],
                    model: '{{model}}'
                },
                reduce: { type: 'json' }
            };

            const { invoker, getModelCalls } = createModelTrackingInvoker();

            const result = await executePipeline(config, {
                aiInvoker: invoker,
                pipelineDirectory: tempDir
            });

            expect(result.success).toBe(true);
            expect(result.output?.results.length).toBe(3);

            // Verify each model was called
            const calls = getModelCalls();
            const models = calls.map(c => c.model);
            expect(models).toContain('gpt-4');
            expect(models).toContain('claude-sonnet');
            expect(models).toContain('gemini-pro');

            // Verify all prompts contain the code
            for (const call of calls) {
                expect(call.prompt).toContain('function add(a, b)');
            }

            // Verify results contain model-specific responses
            for (const r of result.output!.results) {
                expect(r.success).toBe(true);
                expect((r.output.verdict as string).startsWith('ok-from-')).toBe(true);
            }
        });

        it('multi-model fanout with AI reduce for consensus', async () => {
            const config: PipelineConfig = {
                name: 'Consensus Pipeline',
                input: {
                    from: [
                        { model: 'gpt-4' },
                        { model: 'claude-sonnet' }
                    ],
                    parameters: [
                        { name: 'question', value: 'Is 2+2=4?' }
                    ]
                },
                map: {
                    prompt: '{{question}}',
                    output: ['answer', 'confidence'],
                    model: '{{model}}'
                },
                reduce: {
                    type: 'ai',
                    prompt: 'Models responded:\n{{RESULTS}}\n\nIdentify consensus.',
                    output: ['consensus', 'conflicts']
                }
            };

            let reducePromptReceived = '';
            const invoker = async (prompt: string, options?: { model?: string }): Promise<AIInvokerResult> => {
                // Track reduce prompt
                if (prompt.includes('Models responded:')) {
                    reducePromptReceived = prompt;
                    return {
                        success: true,
                        response: JSON.stringify({
                            consensus: 'Both agree 2+2=4',
                            conflicts: 'None'
                        })
                    };
                }
                // Map phase responses
                return {
                    success: true,
                    response: JSON.stringify({
                        answer: 'yes',
                        confidence: 'high'
                    })
                };
            };

            const result = await executePipeline(config, {
                aiInvoker: invoker,
                pipelineDirectory: tempDir
            });

            expect(result.success).toBe(true);
            expect(reducePromptReceived).toContain('Models responded:');
            expect(result.output?.formattedOutput).toContain('consensus');
        });
    });

    describe('YAML parsing with new features', () => {
        it('parses inline array from in YAML', () => {
            const yaml = `
name: "Multi-Model Test"
input:
  from:
    - model: gpt-4
    - model: claude-sonnet
  parameters:
    - name: code
      value: "const x = 1;"
map:
  prompt: "Review: {{code}}"
  output: [verdict]
  model: "{{model}}"
reduce:
  type: json
`;
            const config = parsePipelineYAMLSync(yaml);

            expect(config.name).toBe('Multi-Model Test');
            expect(Array.isArray(config.input.from)).toBe(true);
            expect((config.input.from as Array<{model: string}>).length).toBe(2);
            expect((config.input.from as Array<{model: string}>)[0].model).toBe('gpt-4');
            expect(config.map.model).toBe('{{model}}');
        });

        it('parses CSV from in YAML (backward compatibility)', () => {
            const yaml = `
name: "CSV Test"
input:
  from:
    type: csv
    path: "data.csv"
map:
  prompt: "{{title}}"
  output: [result]
reduce:
  type: list
`;
            const config = parsePipelineYAMLSync(yaml);

            expect(config.name).toBe('CSV Test');
            expect(isCSVSource(config.input.from)).toBe(true);
            if (isCSVSource(config.input.from)) {
                expect(config.input.from.path).toBe('data.csv');
            }
        });
    });

    describe('Validation', () => {
        it('rejects invalid from configuration', async () => {
            const config = {
                name: 'Invalid From Test',
                input: {
                    from: { type: 'json', path: 'test.json' }  // Invalid type
                },
                map: {
                    prompt: '{{title}}',
                    output: ['result']
                },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            const { invoker } = createModelTrackingInvoker();

            await expect(
                executePipeline(config, {
                    aiInvoker: invoker,
                    pipelineDirectory: tempDir
                })
            ).rejects.toThrow(/Unsupported source type|Invalid "from" configuration/);
        });

        it('validates template variables with inline array and parameters', async () => {
            const config: PipelineConfig = {
                name: 'Validation Test',
                input: {
                    from: [
                        { model: 'gpt-4' }
                    ],
                    parameters: [
                        { name: 'code', value: 'test' }
                    ]
                },
                map: {
                    prompt: '{{code}} {{missing_field}}',  // missing_field not provided
                    output: ['result']
                },
                reduce: { type: 'list' }
            };

            const { invoker } = createModelTrackingInvoker();

            await expect(
                executePipeline(config, {
                    aiInvoker: invoker,
                    pipelineDirectory: tempDir
                })
            ).rejects.toThrow(/missing required fields.*missing_field/i);
        });

        it('item fields override parameters', async () => {
            const config: PipelineConfig = {
                name: 'Override Test',
                input: {
                    from: [
                        { model: 'gpt-4', override: 'from-item' }
                    ],
                    parameters: [
                        { name: 'override', value: 'from-param' },
                        { name: 'shared', value: 'shared-value' }
                    ]
                },
                map: {
                    prompt: '{{override}} {{shared}}',
                    output: ['result']
                },
                reduce: { type: 'list' }
            };

            const { invoker, getModelCalls } = createModelTrackingInvoker();

            const result = await executePipeline(config, {
                aiInvoker: invoker,
                pipelineDirectory: tempDir
            });

            expect(result.success).toBe(true);

            // Item field should override parameter
            const calls = getModelCalls();
            expect(calls[0].prompt).toContain('from-item');
            expect(calls[0].prompt).toContain('shared-value');
            expect(calls[0].prompt).not.toContain('from-param');
        });
    });

    describe('Edge cases', () => {
        it('handles model with spaces after substitution', async () => {
            const config: PipelineConfig = {
                name: 'Model Spaces Test',
                input: {
                    items: [
                        { title: 'Test', model: 'gpt-4 turbo' }
                    ]
                },
                map: {
                    prompt: '{{title}}',
                    output: ['result'],
                    model: '{{model}}'
                },
                reduce: { type: 'list' }
            };

            const { invoker, getModelCalls } = createModelTrackingInvoker();

            const result = await executePipeline(config, {
                aiInvoker: invoker,
                pipelineDirectory: tempDir
            });

            expect(result.success).toBe(true);
            const calls = getModelCalls();
            expect(calls[0].model).toBe('gpt-4 turbo');
        });

        it('handles mixed static text and template in model', async () => {
            const config: PipelineConfig = {
                name: 'Mixed Model Test',
                input: {
                    items: [
                        { title: 'Test', version: '4' }
                    ]
                },
                map: {
                    prompt: '{{title}}',
                    output: ['result'],
                    model: 'gpt-{{version}}-turbo'  // Mixed static and template
                },
                reduce: { type: 'list' }
            };

            const { invoker, getModelCalls } = createModelTrackingInvoker();

            const result = await executePipeline(config, {
                aiInvoker: invoker,
                pipelineDirectory: tempDir
            });

            expect(result.success).toBe(true);
            const calls = getModelCalls();
            expect(calls[0].model).toBe('gpt-4-turbo');
        });

        it('parallel execution with different models', async () => {
            const config: PipelineConfig = {
                name: 'Parallel Models Test',
                input: {
                    from: [
                        { model: 'model-1' },
                        { model: 'model-2' },
                        { model: 'model-3' },
                        { model: 'model-4' },
                        { model: 'model-5' }
                    ],
                    parameters: [
                        { name: 'prompt', value: 'test' }
                    ]
                },
                map: {
                    prompt: '{{prompt}}',
                    output: ['result'],
                    model: '{{model}}',
                    parallel: 5  // All in parallel
                },
                reduce: { type: 'json' }
            };

            const { invoker, getModelCalls } = createModelTrackingInvoker();

            const result = await executePipeline(config, {
                aiInvoker: invoker,
                pipelineDirectory: tempDir
            });

            expect(result.success).toBe(true);
            expect(result.output?.results.length).toBe(5);

            // Verify all models were called
            const calls = getModelCalls();
            const models = new Set(calls.map(c => c.model));
            expect(models.size).toBe(5);
        });

        it('handles non-string model gracefully', async () => {
            // This can happen if YAML parsing produces an unexpected type
            const config = {
                name: 'Non-String Model Test',
                input: {
                    items: [{ title: 'Test' }]
                },
                map: {
                    prompt: '{{title}}',
                    output: ['result'],
                    model: { invalid: 'object' }  // Invalid model config
                },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            const { invoker, getModelCalls } = createModelTrackingInvoker();

            const result = await executePipeline(config, {
                aiInvoker: invoker,
                pipelineDirectory: tempDir
            });

            // Should still succeed, just with undefined model
            expect(result.success).toBe(true);
            const calls = getModelCalls();
            expect(calls[0].model).toBeUndefined();
        });
    });
});
