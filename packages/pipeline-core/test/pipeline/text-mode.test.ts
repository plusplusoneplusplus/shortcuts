/**
 * Tests for Text Mode in YAML Pipelines
 *
 * Comprehensive tests for pure text output support in map and reduce phases.
 * Text mode allows non-structured AI responses for interactive conversations.
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
import {
    AIInvokerResult,
    PipelineConfig
} from '../../src/pipeline/types';

describe('Text Mode Pipeline', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'text-mode-test-'));
    });

    afterEach(async () => {
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

    describe('Map Phase Text Mode', () => {
        it('accepts pipeline config without map.output (text mode)', async () => {
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
            expect(result.success).toBe(true);
            expect(result.output).toBeTruthy();
        });

        it('accepts pipeline config with empty map.output array (text mode)', async () => {
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
            expect(result.success).toBe(true);
        });

        it('text mode does not append JSON format instruction to prompt', async () => {
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
            expect(promptReceived).not.toContain('Return JSON with these fields');
            expect(promptReceived).toContain('Echo: hello');
        });

        it('text mode returns raw AI response in rawText field', async () => {
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
            expect(result.output!.results[0].rawText).toBeTruthy();
            expect(result.output!.results[0].rawText).toBe(aiResponse);
            // output should be empty object in text mode
            expect(result.output!.results[0].output).toEqual({});
        });

        it('text mode handles multiple items correctly', async () => {
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

            expect(result.output!.results.length).toBe(3);
            expect(result.output!.results[0].rawText).toBe('Two');
            expect(result.output!.results[1].rawText).toBe('Four');
            expect(result.output!.results[2].rawText).toBe('Six');
        });

        it('text mode handles AI failure gracefully', async () => {
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
            expect(result.output).toBeTruthy();
            expect(result.output!.results[0].success).toBe(false);
            expect(result.output!.results[0].error).toBeTruthy();
        });
    });

    describe('Reduce Phase Text Type', () => {
        it('text reduce type concatenates raw text results', async () => {
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
            expect(result.output!.formattedOutput).toContain('Cats are independent pets');
            expect(result.output!.formattedOutput).toContain('Dogs are loyal companions');
        });

        it('text reduce type handles single item without separators', async () => {
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
            expect(result.output!.formattedOutput).toBe('Hello there!');
            expect(result.output!.formattedOutput).not.toContain('---');
        });

        it('text reduce type includes item separators for multiple items', async () => {
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
            expect(result.output!.formattedOutput).toContain('--- Item 1 ---');
            expect(result.output!.formattedOutput).toContain('--- Item 2 ---');
            expect(result.output!.formattedOutput).toContain('--- Item 3 ---');
        });

        it('text reduce type skips failed items', async () => {
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
            expect(result.output!.formattedOutput).toContain('Success response');
            expect(result.output!.formattedOutput).not.toContain('Failed');
        });

        it('text reduce type handles all failed items', async () => {
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

            expect(result.output!.formattedOutput).toBe('No successful results.');
        });

        it('text reduce works with structured map output', async () => {
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
            expect(result.output!.formattedOutput).toContain('result');
            expect(result.output!.formattedOutput).toContain('ok');
        });
    });

    describe('AI Reduce Text Mode', () => {
        it('AI reduce without output field returns raw text', async () => {
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
                    prompt: `Here are {{COUNT}} feedback summaries:
{{RESULTS}}

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
            expect(result.output!.formattedOutput).toBe(
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
            expect(isJson).toBe(false);
        });

        it('AI reduce with empty output array returns raw text', async () => {
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
                    prompt: 'ReduceSummarize {{RESULTS}}',
                    output: []  // Empty array - text mode
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('MapProcess')) return 'Processed';
                if (prompt.includes('ReduceSummarize')) return 'Raw summary text';
                return 'Unknown';
            });

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            expect(result.output!.formattedOutput).toBe('Raw summary text');
        });

        it('AI reduce text mode does not append JSON instruction', async () => {
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
                    prompt: 'Summarize the results: {{RESULTS}}'
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
            expect(reducePromptReceived).not.toContain('Return JSON with these fields');
        });

        it('AI reduce text mode with text mode map phase', async () => {
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
                    prompt: `You answered {{COUNT}} questions:
{{RESULTS}}

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

            expect(result.success).toBe(true);
            expect(result.output!.formattedOutput).toBe('Both AI and ML are exciting fields.');
        });

        it('AI reduce text mode includes rawText in results template', async () => {
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
                    prompt: 'ReduceResults: {{RESULTS}}'
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
            expect(reducePromptReceived).toContain('Discussion about test topic');
        });

        it('AI reduce text mode still substitutes template variables', async () => {
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
Count: {{COUNT}}
Success: {{SUCCESS_COUNT}}
Failed: {{FAILURE_COUNT}}
Results: {{RESULTS}}`
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

            expect(reducePromptReceived).toContain('Project: MyProject');
            expect(reducePromptReceived).toContain('Count: 1');
            expect(reducePromptReceived).toContain('Success: 1');
            expect(reducePromptReceived).toContain('Failed: 0');
        });
    });

    describe('Validation Changes', () => {
        it('parsePipelineYAMLSync accepts config without map.output', () => {
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
            expect(config.name).toBe('Text Pipeline');
            expect(config.map.output).toBeUndefined();
        });

        it('parsePipelineYAMLSync accepts text reduce type', () => {
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
            expect(config.reduce.type).toBe('text');
        });

        it('parsePipelineYAMLSync accepts AI reduce without output', () => {
            const yaml = `
name: AI Text Reduce
input:
  items:
    - x: "1"
map:
  prompt: "Process {{x}}"
reduce:
  type: ai
  prompt: "Summarize {{RESULTS}}"
`;
            const config = parsePipelineYAMLSync(yaml);
            expect(config.reduce.type).toBe('ai');
            expect(config.reduce.output).toBeUndefined();
        });

        it('parsePipelineYAMLSync still requires map.prompt', () => {
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
            expect(() => parsePipelineYAMLSync(yaml)).toThrow(/map\.prompt/);
        });

        it('parsePipelineYAMLSync still requires reduce.prompt for AI type', () => {
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
            expect(() => parsePipelineYAMLSync(yaml)).toThrow(/reduce\.prompt/);
        });
    });

    describe('Integration Tests', () => {
        it('full text mode pipeline with CSV input', async () => {
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

            expect(result.success).toBe(true);
            expect(result.output!.formattedOutput).toContain('Two');
            expect(result.output!.formattedOutput).toContain('Four');
        });

        it('mixed mode: structured map with text AI reduce', async () => {
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
{{RESULTS}}

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

            expect(result.success).toBe(true);
            // Map results should be structured
            expect(result.output!.results[0].output.severity).toBe('high');
            // Reduce output should be raw text
            expect(result.output!.formattedOutput).toBe(
                'Both bugs are high-severity crashes that need immediate attention.'
            );
        });

        it('text mode preserves special characters and formatting', async () => {
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

            expect(result.output!.formattedOutput).toBe(responseWithSpecialChars);
            expect(result.output!.formattedOutput).toContain('multi-line');
            expect(result.output!.formattedOutput).toContain('<>&{}[]');
        });

        it('text mode with parallel execution', async () => {
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

            expect(result.success).toBe(true);
            expect(result.output!.results.length).toBe(5);
            // All should be successful
            expect(result.output!.results.every(r => r.success)).toBe(true);
        });
    });

    describe('Summary Statistics', () => {
        it('text mode sets empty outputFields in summary', async () => {
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
            expect(result.output!.summary.outputFields).toEqual([]);
        });

        it('AI reduce text mode sets empty outputFields in summary', async () => {
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
                    prompt: 'Summarize {{RESULTS}}'
                    // No output - text mode
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Process')) return 'Processed';
                return 'Summary';
            });

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            expect(result.output!.summary.outputFields).toEqual([]);
            expect(result.reduceStats?.usedAIReduce).toBe(true);
        });
    });
});
