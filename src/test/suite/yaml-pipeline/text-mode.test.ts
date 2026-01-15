/**
 * Tests for Text Mode in YAML Pipelines
 *
 * Comprehensive tests for pure text output support in map and reduce phases.
 * Text mode allows non-structured AI responses for interactive conversations.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    executePipeline,
    parsePipelineYAMLSync
} from '../../../shortcuts/yaml-pipeline/executor';
import {
    AIInvokerResult,
    PipelineConfig
} from '../../../shortcuts/yaml-pipeline/types';

suite('Text Mode Pipeline', () => {
    let tempDir: string;

    setup(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'text-mode-test-'));
    });

    teardown(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    // Helper to create a mock AI invoker
    function createMockAIInvoker(
        responses: Map<string, string> | ((prompt: string) => string)
    ): (prompt: string, options?: { model?: string }) => Promise<AIInvokerResult> {
        return async (prompt: string): Promise<AIInvokerResult> => {
            if (typeof responses === 'function') {
                return { success: true, response: responses(prompt) };
            }

            for (const [key, response] of responses) {
                if (prompt.includes(key)) {
                    return { success: true, response };
                }
            }

            return { success: true, response: 'Default response' };
        };
    }

    suite('Map Phase Text Mode', () => {
        test('accepts pipeline config without map.output (text mode)', async () => {
            const config: PipelineConfig = {
                name: 'Text Mode Pipeline',
                input: {
                    items: [{ question: 'What is 2+2?' }]
                },
                map: {
                    prompt: 'Answer: {{question}}'
                    // No output field - text mode
                },
                reduce: {
                    type: 'text'
                }
            };

            const aiInvoker = createMockAIInvoker(() => 'The answer is 4');

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });
            assert.ok(result.success);
            assert.ok(result.output);
        });

        test('accepts pipeline config with empty map.output array (text mode)', async () => {
            const config: PipelineConfig = {
                name: 'Empty Output Array',
                input: {
                    items: [{ topic: 'weather' }]
                },
                map: {
                    prompt: 'Discuss {{topic}}',
                    output: []  // Empty array - text mode
                },
                reduce: {
                    type: 'text'
                }
            };

            const aiInvoker = createMockAIInvoker(() => 'Today is sunny and warm.');

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });
            assert.ok(result.success);
        });

        test('text mode does not append JSON format instruction to prompt', async () => {
            const config: PipelineConfig = {
                name: 'No JSON Instruction',
                input: {
                    items: [{ text: 'hello' }]
                },
                map: {
                    prompt: 'Echo: {{text}}'
                    // No output - text mode
                },
                reduce: {
                    type: 'text'
                }
            };

            let promptReceived = '';
            const aiInvoker = async (prompt: string): Promise<AIInvokerResult> => {
                promptReceived = prompt;
                return { success: true, response: 'echoed' };
            };

            await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // Should NOT contain JSON format instruction
            assert.ok(!promptReceived.includes('Return JSON with these fields'));
            assert.ok(promptReceived.includes('Echo: hello'));
        });

        test('text mode returns raw AI response in rawText field', async () => {
            const config: PipelineConfig = {
                name: 'RawText Test',
                input: {
                    items: [{ q: 'What is AI?' }]
                },
                map: {
                    prompt: '{{q}}'
                },
                reduce: {
                    type: 'text'
                }
            };

            const aiResponse = 'Artificial Intelligence is a branch of computer science...';
            const aiInvoker = createMockAIInvoker(() => aiResponse);

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // Check that rawText contains the AI response
            assert.ok(result.output!.results[0].rawText);
            assert.strictEqual(result.output!.results[0].rawText, aiResponse);
            // output should be empty object in text mode
            assert.deepStrictEqual(result.output!.results[0].output, {});
        });

        test('text mode handles multiple items correctly', async () => {
            const config: PipelineConfig = {
                name: 'Multiple Items',
                input: {
                    items: [
                        { question: 'What is 1+1?' },
                        { question: 'What is 2+2?' },
                        { question: 'What is 3+3?' }
                    ]
                },
                map: {
                    prompt: 'Answer: {{question}}'
                },
                reduce: {
                    type: 'text'
                }
            };

            const responses = ['Two', 'Four', 'Six'];
            let callIndex = 0;
            const aiInvoker = async (): Promise<AIInvokerResult> => {
                return { success: true, response: responses[callIndex++] || 'Unknown' };
            };

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            assert.strictEqual(result.output!.results.length, 3);
            assert.strictEqual(result.output!.results[0].rawText, 'Two');
            assert.strictEqual(result.output!.results[1].rawText, 'Four');
            assert.strictEqual(result.output!.results[2].rawText, 'Six');
        });

        test('text mode handles AI failure gracefully', async () => {
            const config: PipelineConfig = {
                name: 'Failure Handling',
                input: {
                    items: [{ x: '1' }]
                },
                map: {
                    prompt: 'Process {{x}}'
                },
                reduce: {
                    type: 'text'
                }
            };

            const aiInvoker = async (): Promise<AIInvokerResult> => {
                return { success: false, error: 'AI service unavailable' };
            };

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // Should still return result but with failure marked
            assert.ok(result.output);
            assert.strictEqual(result.output!.results[0].success, false);
            assert.ok(result.output!.results[0].error);
        });
    });

    suite('Reduce Phase Text Type', () => {
        test('text reduce type concatenates raw text results', async () => {
            const config: PipelineConfig = {
                name: 'Text Reduce',
                input: {
                    items: [
                        { topic: 'cats' },
                        { topic: 'dogs' }
                    ]
                },
                map: {
                    prompt: 'Write about {{topic}}'
                },
                reduce: {
                    type: 'text'
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('cats')) return 'Cats are independent pets.';
                if (prompt.includes('dogs')) return 'Dogs are loyal companions.';
                return 'Unknown topic';
            });

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // formattedOutput should contain both responses
            assert.ok(result.output!.formattedOutput.includes('Cats are independent pets'));
            assert.ok(result.output!.formattedOutput.includes('Dogs are loyal companions'));
        });

        test('text reduce type handles single item without separators', async () => {
            const config: PipelineConfig = {
                name: 'Single Item Text',
                input: {
                    items: [{ q: 'hello' }]
                },
                map: {
                    prompt: 'Say {{q}}'
                },
                reduce: {
                    type: 'text'
                }
            };

            const aiInvoker = createMockAIInvoker(() => 'Hello there!');

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // Single item should not have separators
            assert.strictEqual(result.output!.formattedOutput, 'Hello there!');
            assert.ok(!result.output!.formattedOutput.includes('---'));
        });

        test('text reduce type includes item separators for multiple items', async () => {
            const config: PipelineConfig = {
                name: 'Multiple Items with Separators',
                input: {
                    items: [
                        { n: '1' },
                        { n: '2' },
                        { n: '3' }
                    ]
                },
                map: {
                    prompt: 'Count {{n}}'
                },
                reduce: {
                    type: 'text'
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('1')) return 'One';
                if (prompt.includes('2')) return 'Two';
                if (prompt.includes('3')) return 'Three';
                return 'Unknown';
            });

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // Should include separators
            assert.ok(result.output!.formattedOutput.includes('--- Item 1 ---'));
            assert.ok(result.output!.formattedOutput.includes('--- Item 2 ---'));
            assert.ok(result.output!.formattedOutput.includes('--- Item 3 ---'));
        });

        test('text reduce type skips failed items', async () => {
            const config: PipelineConfig = {
                name: 'Skip Failed',
                input: {
                    items: [
                        { id: 'success' },
                        { id: 'fail' }
                    ]
                },
                map: {
                    prompt: 'Process {{id}}'
                },
                reduce: {
                    type: 'text'
                }
            };

            const aiInvoker = async (prompt: string): Promise<AIInvokerResult> => {
                if (prompt.includes('success')) {
                    return { success: true, response: 'Success response' };
                }
                return { success: false, error: 'Failed' };
            };

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // Only successful item should be in output
            assert.ok(result.output!.formattedOutput.includes('Success response'));
            assert.ok(!result.output!.formattedOutput.includes('Failed'));
        });

        test('text reduce type handles all failed items', async () => {
            const config: PipelineConfig = {
                name: 'All Failed',
                input: {
                    items: [{ x: '1' }]
                },
                map: {
                    prompt: 'Process {{x}}'
                },
                reduce: {
                    type: 'text'
                }
            };

            const aiInvoker = async (): Promise<AIInvokerResult> => {
                return { success: false, error: 'All failed' };
            };

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            assert.strictEqual(result.output!.formattedOutput, 'No successful results.');
        });

        test('text reduce works with structured map output', async () => {
            // Text reduce can also work with structured map output
            // It will stringify the output object
            const config: PipelineConfig = {
                name: 'Structured to Text',
                input: {
                    items: [{ x: '1' }]
                },
                map: {
                    prompt: 'Process {{x}}',
                    output: ['result', 'score']  // Structured output
                },
                reduce: {
                    type: 'text'  // But text reduce
                }
            };

            const aiInvoker = createMockAIInvoker(() => '{"result": "ok", "score": 95}');

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // Should contain JSON-stringified output
            assert.ok(result.output!.formattedOutput.includes('result'));
            assert.ok(result.output!.formattedOutput.includes('ok'));
        });
    });

    suite('AI Reduce Text Mode', () => {
        test('AI reduce without output field returns raw text', async () => {
            const config: PipelineConfig = {
                name: 'AI Reduce Text Mode',
                input: {
                    items: [
                        { feedback: 'Great product!' },
                        { feedback: 'Needs improvement' }
                    ]
                },
                map: {
                    prompt: 'Summarize: {{feedback}}'
                },
                reduce: {
                    type: 'ai',
                    prompt: `Here are {{count}} feedback summaries:
{{results}}

Write an executive summary.`
                    // No output field - text mode for AI reduce
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Summarize')) {
                    return 'Positive feedback summary';
                }
                if (prompt.includes('executive summary')) {
                    return 'Overall, customers are satisfied with some room for improvement.';
                }
                return 'Unknown';
            });

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // formattedOutput should be raw text (not JSON)
            assert.strictEqual(
                result.output!.formattedOutput,
                'Overall, customers are satisfied with some room for improvement.'
            );
            // Should not be parseable as JSON (it's raw text)
            let isJson = false;
            try {
                JSON.parse(result.output!.formattedOutput);
                isJson = true;
            } catch {
                isJson = false;
            }
            assert.strictEqual(isJson, false, 'Output should be raw text, not JSON');
        });

        test('AI reduce with empty output array returns raw text', async () => {
            const config: PipelineConfig = {
                name: 'AI Reduce Empty Output',
                input: {
                    items: [{ x: '1' }]
                },
                map: {
                    prompt: 'MapProcess {{x}}'
                },
                reduce: {
                    type: 'ai',
                    prompt: 'ReduceSummarize {{results}}',
                    output: []  // Empty array - text mode
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('MapProcess')) return 'Processed';
                if (prompt.includes('ReduceSummarize')) return 'Raw summary text';
                return 'Unknown';
            });

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            assert.strictEqual(result.output!.formattedOutput, 'Raw summary text');
        });

        test('AI reduce text mode does not append JSON instruction', async () => {
            const config: PipelineConfig = {
                name: 'No JSON Instruction in Reduce',
                input: {
                    items: [{ x: '1' }]
                },
                map: {
                    prompt: 'Process {{x}}'
                },
                reduce: {
                    type: 'ai',
                    prompt: 'Summarize the results: {{results}}'
                    // No output - text mode
                }
            };

            let reducePromptReceived = '';
            const aiInvoker = async (prompt: string): Promise<AIInvokerResult> => {
                if (prompt.includes('Summarize')) {
                    reducePromptReceived = prompt;
                    return { success: true, response: 'Summary' };
                }
                return { success: true, response: 'Processed' };
            };

            await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // Should NOT contain JSON format instruction
            assert.ok(!reducePromptReceived.includes('Return JSON with these fields'));
        });

        test('AI reduce text mode with text mode map phase', async () => {
            // Both map and reduce in text mode
            const config: PipelineConfig = {
                name: 'Full Text Mode',
                input: {
                    items: [
                        { question: 'What is AI?' },
                        { question: 'What is ML?' }
                    ]
                },
                map: {
                    prompt: 'Answer briefly: {{question}}'
                    // No output - text mode
                },
                reduce: {
                    type: 'ai',
                    prompt: `You answered {{count}} questions:
{{results}}

Write a conclusion.`
                    // No output - text mode
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('What is AI')) return 'AI is artificial intelligence.';
                if (prompt.includes('What is ML')) return 'ML is machine learning.';
                if (prompt.includes('Write a conclusion')) return 'Both AI and ML are exciting fields.';
                return 'Unknown';
            });

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            assert.ok(result.success);
            assert.strictEqual(result.output!.formattedOutput, 'Both AI and ML are exciting fields.');
        });

        test('AI reduce text mode includes rawText in results template', async () => {
            const config: PipelineConfig = {
                name: 'RawText in Results',
                input: {
                    items: [{ topic: 'test' }]
                },
                map: {
                    prompt: 'MapDiscuss {{topic}}'
                    // Text mode - will have rawText
                },
                reduce: {
                    type: 'ai',
                    prompt: 'ReduceResults: {{results}}'
                }
            };

            let reducePromptReceived = '';
            const aiInvoker = async (prompt: string): Promise<AIInvokerResult> => {
                if (prompt.includes('MapDiscuss')) {
                    return { success: true, response: 'Discussion about test topic.' };
                }
                if (prompt.includes('ReduceResults:')) {
                    reducePromptReceived = prompt;
                    return { success: true, response: 'Final summary' };
                }
                return { success: true, response: 'Unknown' };
            };

            await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // Results should include the rawText content
            assert.ok(reducePromptReceived.includes('Discussion about test topic'));
        });

        test('AI reduce text mode still substitutes template variables', async () => {
            const config: PipelineConfig = {
                name: 'Template Variables',
                input: {
                    parameters: [
                        { name: 'projectName', value: 'MyProject' }
                    ],
                    items: [{ x: '1' }]
                },
                map: {
                    prompt: 'Process {{x}}'
                },
                reduce: {
                    type: 'ai',
                    prompt: `Project: {{projectName}}
Count: {{count}}
Success: {{successCount}}
Failed: {{failureCount}}
Results: {{results}}`
                    // No output - text mode
                }
            };

            let reducePromptReceived = '';
            const aiInvoker = async (prompt: string): Promise<AIInvokerResult> => {
                if (prompt.includes('Project:')) {
                    reducePromptReceived = prompt;
                    return { success: true, response: 'Summary' };
                }
                return { success: true, response: 'Processed' };
            };

            await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            assert.ok(reducePromptReceived.includes('Project: MyProject'));
            assert.ok(reducePromptReceived.includes('Count: 1'));
            assert.ok(reducePromptReceived.includes('Success: 1'));
            assert.ok(reducePromptReceived.includes('Failed: 0'));
        });
    });

    suite('Validation Changes', () => {
        test('parsePipelineYAMLSync accepts config without map.output', () => {
            const yaml = `
name: Text Pipeline
input:
  items:
    - q: "hello"
map:
  prompt: "Echo {{q}}"
reduce:
  type: text
`;
            const config = parsePipelineYAMLSync(yaml);
            assert.strictEqual(config.name, 'Text Pipeline');
            assert.strictEqual(config.map.output, undefined);
        });

        test('parsePipelineYAMLSync accepts text reduce type', () => {
            const yaml = `
name: Text Reduce Pipeline
input:
  items:
    - x: "1"
map:
  prompt: "Process {{x}}"
  output:
    - result
reduce:
  type: text
`;
            const config = parsePipelineYAMLSync(yaml);
            assert.strictEqual(config.reduce.type, 'text');
        });

        test('parsePipelineYAMLSync accepts AI reduce without output', () => {
            const yaml = `
name: AI Text Reduce
input:
  items:
    - x: "1"
map:
  prompt: "Process {{x}}"
reduce:
  type: ai
  prompt: "Summarize {{results}}"
`;
            const config = parsePipelineYAMLSync(yaml);
            assert.strictEqual(config.reduce.type, 'ai');
            assert.strictEqual(config.reduce.output, undefined);
        });

        test('parsePipelineYAMLSync still requires map.prompt', () => {
            const yaml = `
name: Invalid Pipeline
input:
  items:
    - x: "1"
map:
  output:
    - result
reduce:
  type: text
`;
            assert.throws(() => parsePipelineYAMLSync(yaml), /map\.prompt/);
        });

        test('parsePipelineYAMLSync still requires reduce.prompt for AI type', () => {
            const yaml = `
name: Invalid AI Reduce
input:
  items:
    - x: "1"
map:
  prompt: "Process {{x}}"
reduce:
  type: ai
`;
            assert.throws(() => parsePipelineYAMLSync(yaml), /reduce\.prompt/);
        });
    });

    suite('Integration Tests', () => {
        test('full text mode pipeline with CSV input', async () => {
            // Create CSV file
            const csvContent = 'question\nWhat is 1+1?\nWhat is 2+2?';
            const csvPath = path.join(tempDir, 'questions.csv');
            await fs.promises.writeFile(csvPath, csvContent);

            const config: PipelineConfig = {
                name: 'CSV Text Mode',
                input: {
                    from: {
                        type: 'csv',
                        path: 'questions.csv'
                    }
                },
                map: {
                    prompt: 'Answer: {{question}}'
                    // Text mode
                },
                reduce: {
                    type: 'text'
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('1+1')) return 'Two';
                if (prompt.includes('2+2')) return 'Four';
                return 'Unknown';
            });

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            assert.ok(result.success);
            assert.ok(result.output!.formattedOutput.includes('Two'));
            assert.ok(result.output!.formattedOutput.includes('Four'));
        });

        test('mixed mode: structured map with text AI reduce', async () => {
            const config: PipelineConfig = {
                name: 'Mixed Mode',
                input: {
                    items: [
                        { bug: 'Bug A' },
                        { bug: 'Bug B' }
                    ]
                },
                map: {
                    prompt: 'MapAnalyze: {{bug}}',
                    output: ['severity', 'category']  // Structured output
                },
                reduce: {
                    type: 'ai',
                    prompt: `ReduceAnalyzedBugs:
{{results}}

Write a natural language summary.`
                    // No output - text mode AI reduce
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('MapAnalyze')) {
                    return '{"severity": "high", "category": "crash"}';
                }
                if (prompt.includes('ReduceAnalyzedBugs')) {
                    return 'Both bugs are high-severity crashes that need immediate attention.';
                }
                return 'Unknown';
            });

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            assert.ok(result.success);
            // Map results should be structured
            assert.strictEqual(result.output!.results[0].output.severity, 'high');
            // Reduce output should be raw text
            assert.strictEqual(
                result.output!.formattedOutput,
                'Both bugs are high-severity crashes that need immediate attention.'
            );
        });

        test('text mode preserves special characters and formatting', async () => {
            const config: PipelineConfig = {
                name: 'Special Characters',
                input: {
                    items: [{ code: 'function test()' }]
                },
                map: {
                    prompt: 'Comment: {{code}}'
                },
                reduce: {
                    type: 'text'
                }
            };

            const responseWithSpecialChars = `/**
 * This is a multi-line comment
 * with "quotes" and 'apostrophes'
 * and special chars: <>&{}[]
 */`;

            const aiInvoker = createMockAIInvoker(() => responseWithSpecialChars);

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            assert.strictEqual(result.output!.formattedOutput, responseWithSpecialChars);
            assert.ok(result.output!.formattedOutput.includes('multi-line'));
            assert.ok(result.output!.formattedOutput.includes('<>&{}[]'));
        });

        test('text mode with parallel execution', async () => {
            const config: PipelineConfig = {
                name: 'Parallel Text Mode',
                input: {
                    items: [
                        { n: '1' },
                        { n: '2' },
                        { n: '3' },
                        { n: '4' },
                        { n: '5' }
                    ]
                },
                map: {
                    prompt: 'Count {{n}}',
                    parallel: 3  // Run 3 in parallel
                },
                reduce: {
                    type: 'text'
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                const match = prompt.match(/Count (\d)/);
                if (match) {
                    const num = parseInt(match[1]);
                    return ['One', 'Two', 'Three', 'Four', 'Five'][num - 1] || 'Unknown';
                }
                return 'Unknown';
            });

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            assert.ok(result.success);
            assert.strictEqual(result.output!.results.length, 5);
            // All should be successful
            assert.ok(result.output!.results.every(r => r.success));
        });
    });

    suite('Summary Statistics', () => {
        test('text mode sets empty outputFields in summary', async () => {
            const config: PipelineConfig = {
                name: 'Summary Test',
                input: {
                    items: [{ x: '1' }]
                },
                map: {
                    prompt: 'Process {{x}}'
                },
                reduce: {
                    type: 'text'
                }
            };

            const aiInvoker = createMockAIInvoker(() => 'Done');

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // outputFields should be empty for text mode
            assert.deepStrictEqual(result.output!.summary.outputFields, []);
        });

        test('AI reduce text mode sets empty outputFields in summary', async () => {
            const config: PipelineConfig = {
                name: 'AI Reduce Summary',
                input: {
                    items: [{ x: '1' }]
                },
                map: {
                    prompt: 'Process {{x}}'
                },
                reduce: {
                    type: 'ai',
                    prompt: 'Summarize {{results}}'
                    // No output - text mode
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Process')) return 'Processed';
                return 'Summary';
            });

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            assert.deepStrictEqual(result.output!.summary.outputFields, []);
            assert.strictEqual(result.reduceStats?.usedAIReduce, true);
        });
    });
});
