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

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    executePipeline,
    parsePipelineYAMLSync,
    PipelineExecutionError
} from '../../../shortcuts/yaml-pipeline/executor';
import { isCSVSource } from '../../../shortcuts/yaml-pipeline/types';
import type {
    AIInvokerResult,
    PipelineConfig
} from '../../../shortcuts/yaml-pipeline/types';

suite('Multi-Model Fanout', () => {
    let tempDir: string;

    setup(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fanout-test-'));
    });

    teardown(async () => {
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

    suite('isCSVSource type guard', () => {
        test('returns true for valid CSV source', () => {
            assert.strictEqual(isCSVSource({ type: 'csv', path: 'test.csv' }), true);
            assert.strictEqual(isCSVSource({ type: 'csv', path: 'test.csv', delimiter: ';' }), true);
        });

        test('returns false for arrays', () => {
            assert.strictEqual(isCSVSource([]), false);
            assert.strictEqual(isCSVSource([{ model: 'gpt-4' }]), false);
        });

        test('returns false for invalid objects', () => {
            assert.strictEqual(isCSVSource(null), false);
            assert.strictEqual(isCSVSource(undefined), false);
            assert.strictEqual(isCSVSource({}), false);
            assert.strictEqual(isCSVSource({ type: 'json', path: 'test.json' }), false);
            assert.strictEqual(isCSVSource({ type: 'csv' }), false); // missing path
            assert.strictEqual(isCSVSource({ path: 'test.csv' }), false); // missing type
        });
    });

    suite('Inline array in from', () => {
        test('executes pipeline with inline array from', async () => {
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

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.output?.results.length, 2);
        });

        test('merges parameters with inline array items', async () => {
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

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.output?.results.length, 2);

            // Verify both prompts contain the merged parameters
            const calls = getModelCalls();
            assert.strictEqual(calls.length, 2);
            assert.ok(calls[0].prompt.includes('Is this valid?'));
            assert.ok(calls[0].prompt.includes('const x = 1;'));
            assert.ok(calls[1].prompt.includes('Is this valid?'));
            assert.ok(calls[1].prompt.includes('const x = 1;'));
        });

        test('handles empty inline array', async () => {
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

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.executionStats.totalItems, 0);
        });

        test('applies limit to inline array', async () => {
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

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.output?.results.length, 2);
            assert.strictEqual(result.output?.results[0].item.id, '1');
            assert.strictEqual(result.output?.results[1].item.id, '2');
        });
    });

    suite('Template model substitution', () => {
        test('substitutes model from item field', async () => {
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

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.output?.results.length, 2);

            // Verify correct models were used
            const calls = getModelCalls();
            assert.strictEqual(calls.length, 2);
            assert.strictEqual(calls[0].model, 'gpt-4');
            assert.strictEqual(calls[1].model, 'claude-sonnet');
        });

        test('static model still works', async () => {
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

            assert.strictEqual(result.success, true);

            // Verify same model used for both
            const calls = getModelCalls();
            assert.strictEqual(calls[0].model, 'gpt-4-turbo');
            assert.strictEqual(calls[1].model, 'gpt-4-turbo');
        });

        test('undefined model when template variable missing', async () => {
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

            assert.strictEqual(result.success, true);

            // Model should be undefined (empty string becomes undefined)
            const calls = getModelCalls();
            assert.strictEqual(calls[0].model, undefined);
        });

        test('no model when not specified', async () => {
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

            assert.strictEqual(result.success, true);

            const calls = getModelCalls();
            assert.strictEqual(calls[0].model, undefined);
        });
    });

    suite('Multi-model fanout pattern', () => {
        test('full multi-model fanout with parameters and dynamic model', async () => {
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

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.output?.results.length, 3);

            // Verify each model was called
            const calls = getModelCalls();
            const models = calls.map(c => c.model);
            assert.ok(models.includes('gpt-4'));
            assert.ok(models.includes('claude-sonnet'));
            assert.ok(models.includes('gemini-pro'));

            // Verify all prompts contain the code
            for (const call of calls) {
                assert.ok(call.prompt.includes('function add(a, b)'));
            }

            // Verify results contain model-specific responses
            for (const r of result.output!.results) {
                assert.ok(r.success);
                assert.ok((r.output.verdict as string).startsWith('ok-from-'));
            }
        });

        test('multi-model fanout with AI reduce for consensus', async () => {
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
                    prompt: 'Models responded:\n{{results}}\n\nIdentify consensus.',
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

            assert.strictEqual(result.success, true);
            assert.ok(reducePromptReceived.includes('Models responded:'));
            assert.ok(result.output?.formattedOutput.includes('consensus'));
        });
    });

    suite('YAML parsing with new features', () => {
        test('parses inline array from in YAML', () => {
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

            assert.strictEqual(config.name, 'Multi-Model Test');
            assert.ok(Array.isArray(config.input.from));
            assert.strictEqual((config.input.from as Array<{model: string}>).length, 2);
            assert.strictEqual((config.input.from as Array<{model: string}>)[0].model, 'gpt-4');
            assert.strictEqual(config.map.model, '{{model}}');
        });

        test('parses CSV from in YAML (backward compatibility)', () => {
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

            assert.strictEqual(config.name, 'CSV Test');
            assert.ok(isCSVSource(config.input.from));
            if (isCSVSource(config.input.from)) {
                assert.strictEqual(config.input.from.path, 'data.csv');
            }
        });
    });

    suite('Validation', () => {
        test('rejects invalid from configuration', async () => {
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

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: invoker,
                    pipelineDirectory: tempDir
                }),
                /Unsupported source type|Invalid "from" configuration/
            );
        });

        test('validates template variables with inline array and parameters', async () => {
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

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: invoker,
                    pipelineDirectory: tempDir
                }),
                /missing required fields.*missing_field/i
            );
        });

        test('item fields override parameters', async () => {
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

            assert.strictEqual(result.success, true);

            // Item field should override parameter
            const calls = getModelCalls();
            assert.ok(calls[0].prompt.includes('from-item'));
            assert.ok(calls[0].prompt.includes('shared-value'));
            assert.ok(!calls[0].prompt.includes('from-param'));
        });
    });

    suite('Edge cases', () => {
        test('handles model with spaces after substitution', async () => {
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

            assert.strictEqual(result.success, true);
            const calls = getModelCalls();
            assert.strictEqual(calls[0].model, 'gpt-4 turbo');
        });

        test('handles mixed static text and template in model', async () => {
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

            assert.strictEqual(result.success, true);
            const calls = getModelCalls();
            assert.strictEqual(calls[0].model, 'gpt-4-turbo');
        });

        test('parallel execution with different models', async () => {
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

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.output?.results.length, 5);

            // Verify all models were called
            const calls = getModelCalls();
            const models = new Set(calls.map(c => c.model));
            assert.strictEqual(models.size, 5);
        });
    });
});
