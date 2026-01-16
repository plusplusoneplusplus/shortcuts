/**
 * Tests for AI Reduce Phase in YAML Pipelines
 *
 * Comprehensive tests for AI-powered reduce functionality.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    executePipeline,
    PipelineExecutionError
} from '../../../shortcuts/yaml-pipeline/executor';
import {
    AIInvokerResult,
    PipelineConfig
} from '../../../shortcuts/yaml-pipeline/types';

suite('AI Reduce Phase', () => {
    let tempDir: string;

    setup(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-reduce-test-'));
    });

    teardown(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    // Helper to create a mock AI invoker
    function createMockAIInvoker(
        responses: Map<string, string> | ((prompt: string) => string)
    ): (prompt: string, options?: { model?: string }) => Promise<AIInvokerResult> {
        return async (prompt: string, options?: { model?: string }): Promise<AIInvokerResult> => {
            if (typeof responses === 'function') {
                return { success: true, response: responses(prompt) };
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

    suite('AI Reduce Configuration Validation', () => {
        test('rejects AI reduce without prompt', async () => {
            const config: PipelineConfig = {
                name: 'Invalid Pipeline',
                input: {
                    items: [{ id: '1' }]
                },
                map: {
                    prompt: 'Process {{id}}',
                    output: ['result']
                },
                reduce: {
                    type: 'ai',
                    // Missing prompt
                    output: ['summary']
                }
            };

            const aiInvoker = createMockAIInvoker(new Map());

            await assert.rejects(
                async () => await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir }),
                (err: Error) => {
                    assert.ok(err instanceof PipelineExecutionError);
                    assert.ok(err.message.includes('reduce.prompt'));
                    return true;
                }
            );
        });

        test('accepts AI reduce without output (text mode)', async () => {
            // AI reduce without output field is now valid - returns raw text
            const config: PipelineConfig = {
                name: 'Text Mode AI Reduce',
                input: {
                    items: [{ id: '1' }]
                },
                map: {
                    prompt: 'Process {{id}}',
                    output: ['result']
                },
                reduce: {
                    type: 'ai',
                    prompt: 'Summarize: {{RESULTS}}'
                    // No output - text mode
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Process')) return '{"result": "ok"}';
                return 'Raw text summary';
            });

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });
            assert.ok(result.success);
            assert.strictEqual(result.output!.formattedOutput, 'Raw text summary');
        });

        test('accepts AI reduce with empty output array (text mode)', async () => {
            // AI reduce with empty output array is now valid - returns raw text
            const config: PipelineConfig = {
                name: 'Empty Output AI Reduce',
                input: {
                    items: [{ id: '1' }]
                },
                map: {
                    prompt: 'Process {{id}}',
                    output: ['result']
                },
                reduce: {
                    type: 'ai',
                    prompt: 'Summarize: {{RESULTS}}',
                    output: []  // Empty array - text mode
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Process')) return '{"result": "ok"}';
                return 'Raw text from AI';
            });

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });
            assert.ok(result.success);
            assert.strictEqual(result.output!.formattedOutput, 'Raw text from AI');
        });

        test('accepts valid AI reduce configuration', async () => {
            const config: PipelineConfig = {
                name: 'Valid Pipeline',
                input: {
                    items: [{ id: '1', text: 'test' }]
                },
                map: {
                    prompt: 'Analyze: {{text}}',
                    output: ['sentiment']
                },
                reduce: {
                    type: 'ai',
                    prompt: 'Summarize {{COUNT}} results: {{RESULTS}}',
                    output: ['summary']
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Analyze')) {
                    return '{"sentiment": "positive"}';
                }
                if (prompt.includes('Summarize')) {
                    return '{"summary": "Overall positive"}';
                }
                return '{"result": "ok"}';
            });

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });
            assert.ok(result);
        });
    });

    suite('AI Reduce Execution', () => {
        test('executes AI reduce with template variable substitution', async () => {
            const config: PipelineConfig = {
                name: 'Synthesize Results',
                input: {
                    items: [
                        { bug: 'Bug A', severity: 'high' },
                        { bug: 'Bug B', severity: 'medium' },
                        { bug: 'Bug C', severity: 'high' }
                    ]
                },
                map: {
                    prompt: 'Analyze bug {{bug}} with severity {{severity}}. Return category.',
                    output: ['category']
                },
                reduce: {
                    type: 'ai',
                    prompt: `You analyzed {{COUNT}} bugs. 
                    
Successful: {{SUCCESS_COUNT}}
Failed: {{FAILURE_COUNT}}

Results:
{{RESULTS}}

Provide a summary with key findings.`,
                    output: ['summary', 'keyFindings']
                }
            };

            let reducePromptReceived = '';

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Analyze bug')) {
                    return '{"category": "crash"}';
                }
                if (prompt.includes('You analyzed')) {
                    reducePromptReceived = prompt;
                    return '{"summary": "3 high-priority crashes", "keyFindings": ["crash1", "crash2"]}';
                }
                return '{"result": "ok"}';
            });

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // Verify template variables were substituted
            assert.ok(reducePromptReceived.includes('You analyzed 3 bugs'));
            assert.ok(reducePromptReceived.includes('Successful: 3'));
            assert.ok(reducePromptReceived.includes('Failed: 0'));

            // Verify result structure
            assert.ok(result.output);
            assert.strictEqual(result.reduceStats?.usedAIReduce, true);
        });

        test('passes map results as JSON to reduce prompt', async () => {
            const config: PipelineConfig = {
                name: 'Synthesize',
                input: {
                    items: [
                        { item: 'Task 1' },
                        { item: 'Task 2' }
                    ]
                },
                map: {
                    prompt: 'Assess {{item}}',
                    output: ['priority']
                },
                reduce: {
                    type: 'ai',
                    prompt: 'Results: {{RESULTS}}',
                    output: ['summary']
                }
            };

            let resultsJSON = '';

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Assess')) {
                    return '{"priority": "high"}';
                }
                if (prompt.includes('Results:')) {
                    const match = prompt.match(/Results: (.*)/s);
                    if (match) {
                        resultsJSON = match[1];
                    }
                    return '{"summary": "All high priority"}';
                }
                return '{}';
            });

            await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // Verify results are passed as JSON
            assert.ok(resultsJSON.length > 0);
            // Extract JSON array from the captured text (before "Return JSON..." instruction)
            const jsonMatch = resultsJSON.match(/\[([\s\S]*?)\]/);
            assert.ok(jsonMatch, 'Should contain JSON array in prompt');
            const parsed = JSON.parse(jsonMatch[0]);
            assert.ok(Array.isArray(parsed));
            assert.strictEqual(parsed.length, 2);
        });

        test('parses AI reduce response correctly', async () => {
            const config: PipelineConfig = {
                name: 'Parse Test',
                input: {
                    items: [{ x: '1' }]
                },
                map: {
                    prompt: 'Process {{x}}',
                    output: ['result']
                },
                reduce: {
                    type: 'ai',
                    prompt: 'Summarize {{RESULTS}}',
                    output: ['summary', 'count', 'details']
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Process')) {
                    return '{"result": "ok"}';
                }
                if (prompt.includes('Summarize')) {
                    return '{"summary": "Test summary", "count": 1, "details": ["detail1", "detail2"]}';
                }
                return '{}';
            });

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // Parse the formatted output
            const output = JSON.parse(result.output!.formattedOutput);
            assert.strictEqual(output.summary, 'Test summary');
            assert.strictEqual(output.count, 1);
            assert.deepStrictEqual(output.details, ['detail1', 'detail2']);
        });

        test('handles AI reduce with code blocks in response', async () => {
            const config: PipelineConfig = {
                name: 'Code Block Test',
                input: {
                    items: [{ x: '1' }]
                },
                map: {
                    prompt: 'Process {{x}}',
                    output: ['result']
                },
                reduce: {
                    type: 'ai',
                    prompt: 'Summarize {{RESULTS}}',
                    output: ['summary']
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Process')) {
                    return '{"result": "ok"}';
                }
                if (prompt.includes('Summarize')) {
                    return '```json\n{"summary": "Wrapped in code block"}\n```';
                }
                return '{}';
            });

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });
            const output = JSON.parse(result.output!.formattedOutput);
            assert.strictEqual(output.summary, 'Wrapped in code block');
        });

        test('uses custom model for AI reduce when specified', async () => {
            const config: PipelineConfig = {
                name: 'Custom Model Test',
                input: {
                    items: [{ x: '1' }]
                },
                map: {
                    prompt: 'Process {{x}}',
                    output: ['result'],
                    model: 'gpt-4'
                },
                reduce: {
                    type: 'ai',
                    prompt: 'Summarize {{RESULTS}}',
                    output: ['summary'],
                    model: 'gpt-3.5-turbo'
                }
            };

            let reduceModelUsed = '';

            const aiInvoker = async (prompt: string, options?: { model?: string }): Promise<AIInvokerResult> => {
                if (prompt.includes('Summarize')) {
                    reduceModelUsed = options?.model || '';
                    return { success: true, response: '{"summary": "test"}' };
                }
                return { success: true, response: '{"result": "ok"}' };
            };

            await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });
            assert.strictEqual(reduceModelUsed, 'gpt-3.5-turbo');
        });

        test('sets usedAIReduce flag correctly', async () => {
            const config: PipelineConfig = {
                name: 'Flag Test',
                input: {
                    items: [{ x: '1' }]
                },
                map: {
                    prompt: 'Process {{x}}',
                    output: ['result']
                },
                reduce: {
                    type: 'ai',
                    prompt: 'Summarize {{RESULTS}}',
                    output: ['summary']
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Process')) {
                    return '{"result": "ok"}';
                }
                return '{"summary": "test"}';
            });

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });
            assert.strictEqual(result.reduceStats?.usedAIReduce, true);
        });
    });

    suite('AI Reduce Error Handling', () => {
        test('throws error when AI reduce fails', async () => {
            const config: PipelineConfig = {
                name: 'Fail Test',
                input: {
                    items: [{ x: '1' }]
                },
                map: {
                    prompt: 'Process {{x}}',
                    output: ['result']
                },
                reduce: {
                    type: 'ai',
                    prompt: 'Summarize {{RESULTS}}',
                    output: ['summary']
                }
            };

            const aiInvoker = async (prompt: string): Promise<AIInvokerResult> => {
                if (prompt.includes('Process')) {
                    return { success: true, response: '{"result": "ok"}' };
                }
                if (prompt.includes('Summarize')) {
                    return { success: false, error: 'AI service unavailable' };
                }
                return { success: true, response: '{}' };
            };

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });
            
            assert.strictEqual(result.success, false);
            assert.ok(result.error);
            assert.ok(result.error!.includes('AI reduce failed'));
            assert.ok(result.error!.includes('AI service unavailable'));
        });

        test('throws error when AI reduce response is not valid JSON', async () => {
            const config: PipelineConfig = {
                name: 'Invalid JSON Test',
                input: {
                    items: [{ x: '1' }]
                },
                map: {
                    prompt: 'Process {{x}}',
                    output: ['result']
                },
                reduce: {
                    type: 'ai',
                    prompt: 'Summarize {{RESULTS}}',
                    output: ['summary']
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Process')) {
                    return '{"result": "ok"}';
                }
                if (prompt.includes('Summarize')) {
                    return 'This is not JSON at all';
                }
                return '{}';
            });

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });
            
            assert.strictEqual(result.success, false);
            assert.ok(result.error);
            assert.ok(result.error!.includes('Failed to parse AI reduce response'));
        });
    });

    suite('AI Reduce with Input Parameters', () => {
        test('substitutes input parameters in AI reduce prompt', async () => {
            const config: PipelineConfig = {
                name: 'Parameter Test',
                input: {
                    parameters: [
                        { name: 'projectName', value: 'MyProject' },
                        { name: 'reviewer', value: 'Team Lead' }
                    ],
                    items: [
                        { bug: 'Bug A' },
                        { bug: 'Bug B' }
                    ]
                },
                map: {
                    prompt: 'MapAnalyzeBug {{bug}}',
                    output: ['severity']
                },
                reduce: {
                    type: 'ai',
                    prompt: `Project: {{projectName}}
Reviewer: {{reviewer}}

ReduceProcessed {{COUNT}} bugs:
{{RESULTS}}

Provide summary.`,
                    output: ['summary']
                }
            };

            let reducePromptReceived = '';

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('MapAnalyzeBug')) {
                    return '{"severity": "high"}';
                }
                if (prompt.includes('Project:')) {
                    reducePromptReceived = prompt;
                    return '{"summary": "All high severity"}';
                }
                return '{}';
            });

            await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // Verify parameters were substituted
            assert.ok(reducePromptReceived.includes('Project: MyProject'));
            assert.ok(reducePromptReceived.includes('Reviewer: Team Lead'));
            // Also verify built-in variables still work
            assert.ok(reducePromptReceived.includes('ReduceProcessed 2 bugs'));
        });

        test('handles multiple occurrences of same parameter', async () => {
            const config: PipelineConfig = {
                name: 'Multiple Occurrences Test',
                input: {
                    parameters: [
                        { name: 'team', value: 'Alpha Team' }
                    ],
                    items: [{ x: '1' }]
                },
                map: {
                    prompt: 'Process {{x}}',
                    output: ['result']
                },
                reduce: {
                    type: 'ai',
                    prompt: `Team: {{team}}
Report for: {{team}}
Generated by: {{team}}`,
                    output: ['summary']
                }
            };

            let reducePromptReceived = '';

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Process')) {
                    return '{"result": "ok"}';
                }
                if (prompt.includes('Team:')) {
                    reducePromptReceived = prompt;
                    return '{"summary": "done"}';
                }
                return '{}';
            });

            await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // Count occurrences of 'Alpha Team' (should be 3)
            const matches = reducePromptReceived.match(/Alpha Team/g);
            assert.strictEqual(matches?.length, 3);
        });

        test('works without parameters (backward compatibility)', async () => {
            const config: PipelineConfig = {
                name: 'No Parameters Test',
                input: {
                    items: [{ x: '1' }]
                },
                map: {
                    prompt: 'Process {{x}}',
                    output: ['result']
                },
                reduce: {
                    type: 'ai',
                    prompt: 'Summarize {{COUNT}} results: {{RESULTS}}',
                    output: ['summary']
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Process')) {
                    return '{"result": "ok"}';
                }
                return '{"summary": "done"}';
            });

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });
            assert.ok(result);
            assert.strictEqual(result.reduceStats?.usedAIReduce, true);
        });

        test('parameters do not conflict with built-in variables', async () => {
            const config: PipelineConfig = {
                name: 'No Conflict Test',
                input: {
                    parameters: [
                        { name: 'customCount', value: '999' }
                    ],
                    items: [{ x: '1' }, { x: '2' }]
                },
                map: {
                    prompt: 'Process {{x}}',
                    output: ['result']
                },
                reduce: {
                    type: 'ai',
                    prompt: `Built-in count: {{COUNT}}
Custom count: {{customCount}}`,
                    output: ['summary']
                }
            };

            let reducePromptReceived = '';

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Process')) {
                    return '{"result": "ok"}';
                }
                if (prompt.includes('Built-in')) {
                    reducePromptReceived = prompt;
                    return '{"summary": "done"}';
                }
                return '{}';
            });

            await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // Built-in {{COUNT}} should be 2 (actual item count)
            assert.ok(reducePromptReceived.includes('Built-in count: 2'));
            // Custom parameter should be 999
            assert.ok(reducePromptReceived.includes('Custom count: 999'));
        });

        test('preserves unmatched template variables', async () => {
            const config: PipelineConfig = {
                name: 'Unmatched Variables Test',
                input: {
                    parameters: [
                        { name: 'knownParam', value: 'known' }
                    ],
                    items: [{ x: '1' }]
                },
                map: {
                    prompt: 'Process {{x}}',
                    output: ['result']
                },
                reduce: {
                    type: 'ai',
                    prompt: `Known: {{knownParam}}
Unknown: {{unknownParam}}`,
                    output: ['summary']
                }
            };

            let reducePromptReceived = '';

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Process')) {
                    return '{"result": "ok"}';
                }
                if (prompt.includes('Known:')) {
                    reducePromptReceived = prompt;
                    return '{"summary": "done"}';
                }
                return '{}';
            });

            await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // Known parameter should be substituted
            assert.ok(reducePromptReceived.includes('Known: known'));
            // Unknown parameter should remain as-is
            assert.ok(reducePromptReceived.includes('Unknown: {{unknownParam}}'));
        });
    });

    suite('AI Reduce Use Cases', () => {
        test('synthesizes bug analysis into executive summary', async () => {
            const config: PipelineConfig = {
                name: 'Bug Summary',
                input: {
                    items: [
                        { bug: 'Crash on startup', severity: 'high' },
                        { bug: 'Slow load time', severity: 'medium' },
                        { bug: 'UI glitch', severity: 'low' },
                        { bug: 'Memory leak', severity: 'high' }
                    ]
                },
                map: {
                    prompt: 'Analyze bug: {{bug}} (severity: {{severity}})',
                    output: ['category', 'impact']
                },
                reduce: {
                    type: 'ai',
                    prompt: `Analyzed {{COUNT}} bugs:
{{RESULTS}}

Create executive summary with:
1. Overall assessment
2. Top 3 priorities
3. Recommended actions`,
                    output: ['assessment', 'priorities', 'actions']
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Analyze bug')) {
                    return '{"category": "performance", "impact": "users affected"}';
                }
                if (prompt.includes('Create executive summary')) {
                    return JSON.stringify({
                        assessment: '2 critical bugs found',
                        priorities: ['Fix crash', 'Fix memory leak', 'Optimize load time'],
                        actions: ['Hotfix release', 'Performance audit', 'UI review']
                    });
                }
                return '{}';
            });

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });
            const output = JSON.parse(result.output!.formattedOutput);

            assert.ok(output.assessment);
            assert.ok(Array.isArray(output.priorities));
            assert.ok(Array.isArray(output.actions));
        });

        test('deduplicates code review findings', async () => {
            const config: PipelineConfig = {
                name: 'Deduplicate Findings',
                input: {
                    items: [
                        { file: 'a.ts', issue: 'Missing error handling' },
                        { file: 'b.ts', issue: 'Missing error handling' },
                        { file: 'c.ts', issue: 'Unused variable' }
                    ]
                },
                map: {
                    prompt: 'Review {{file}}: {{issue}}',
                    output: ['finding']
                },
                reduce: {
                    type: 'ai',
                    prompt: `{{COUNT}} findings from code review:
{{RESULTS}}

Deduplicate and group similar issues. List affected files for each unique issue.`,
                    output: ['uniqueFindings']
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Review')) {
                    return '{"finding": "Add try-catch blocks"}';
                }
                if (prompt.includes('Deduplicate')) {
                    return JSON.stringify({
                        uniqueFindings: [
                            { issue: 'Missing error handling', files: ['a.ts', 'b.ts'] },
                            { issue: 'Unused variable', files: ['c.ts'] }
                        ]
                    });
                }
                return '{}';
            });

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });
            const output = JSON.parse(result.output!.formattedOutput);

            assert.ok(Array.isArray(output.uniqueFindings));
            assert.strictEqual(output.uniqueFindings.length, 2);
        });
    });
});
