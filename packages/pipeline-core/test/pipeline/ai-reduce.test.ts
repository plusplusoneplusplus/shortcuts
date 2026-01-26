/**
 * Tests for AI Reduce Phase in YAML Pipelines
 *
 * Comprehensive tests for AI-powered reduce functionality.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    executePipeline,
    PipelineExecutionError
} from '../../src/pipeline';
import {
    AIInvokerResult,
    PipelineConfig
} from '../../src/pipeline/types';

describe('AI Reduce Phase', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-reduce-test-'));
    });

    afterEach(async () => {
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

    describe('AI Reduce Configuration Validation', () => {
        it('rejects AI reduce without prompt', async () => {
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

            await expect(
                executePipeline(config, { aiInvoker, pipelineDirectory: tempDir })
            ).rejects.toThrow(/reduce\.prompt/);
        });

        it('accepts AI reduce without output (text mode)', async () => {
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
            expect(result.success).toBe(true);
            expect(result.output!.formattedOutput).toBe('Raw text summary');
        });

        it('accepts AI reduce with empty output array (text mode)', async () => {
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
            expect(result.success).toBe(true);
            expect(result.output!.formattedOutput).toBe('Raw text from AI');
        });

        it('accepts valid AI reduce configuration', async () => {
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
            expect(result).toBeTruthy();
        });
    });

    describe('AI Reduce Execution', () => {
        it('executes AI reduce with template variable substitution', async () => {
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
            expect(reducePromptReceived).toContain('You analyzed 3 bugs');
            expect(reducePromptReceived).toContain('Successful: 3');
            expect(reducePromptReceived).toContain('Failed: 0');

            // Verify result structure
            expect(result.output).toBeTruthy();
            expect(result.reduceStats?.usedAIReduce).toBe(true);
        });

        it('passes map results as JSON to reduce prompt', async () => {
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
            expect(resultsJSON.length).toBeGreaterThan(0);
            // Extract JSON array from the captured text (before "Return JSON..." instruction)
            const jsonMatch = resultsJSON.match(/\[([\s\S]*?)\]/);
            expect(jsonMatch).toBeTruthy();
            const parsed = JSON.parse(jsonMatch![0]);
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed.length).toBe(2);
        });

        it('parses AI reduce response correctly', async () => {
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
            expect(output.summary).toBe('Test summary');
            expect(output.count).toBe(1);
            expect(output.details).toEqual(['detail1', 'detail2']);
        });

        it('handles AI reduce with code blocks in response', async () => {
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
            expect(output.summary).toBe('Wrapped in code block');
        });

        it('uses custom model for AI reduce when specified', async () => {
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
            expect(reduceModelUsed).toBe('gpt-3.5-turbo');
        });

        it('sets usedAIReduce flag correctly', async () => {
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
            expect(result.reduceStats?.usedAIReduce).toBe(true);
        });
    });

    describe('AI Reduce Error Handling', () => {
        it('returns error when AI reduce fails', async () => {
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
            
            expect(result.success).toBe(false);
            expect(result.error).toBeTruthy();
            expect(result.error!).toContain('AI reduce failed');
            expect(result.error!).toContain('AI service unavailable');
        });

        it('returns error when AI reduce response is not valid JSON', async () => {
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
            
            expect(result.success).toBe(false);
            expect(result.error).toBeTruthy();
            expect(result.error!).toContain('Failed to parse AI reduce response');
        });
    });

    describe('AI Reduce with Input Parameters', () => {
        it('substitutes input parameters in AI reduce prompt', async () => {
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
            expect(reducePromptReceived).toContain('Project: MyProject');
            expect(reducePromptReceived).toContain('Reviewer: Team Lead');
            // Also verify built-in variables still work
            expect(reducePromptReceived).toContain('ReduceProcessed 2 bugs');
        });

        it('handles multiple occurrences of same parameter', async () => {
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
            expect(matches?.length).toBe(3);
        });

        it('works without parameters (backward compatibility)', async () => {
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
            expect(result).toBeTruthy();
            expect(result.reduceStats?.usedAIReduce).toBe(true);
        });

        it('parameters do not conflict with built-in variables', async () => {
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
            expect(reducePromptReceived).toContain('Built-in count: 2');
            // Custom parameter should be 999
            expect(reducePromptReceived).toContain('Custom count: 999');
        });

        it('preserves unmatched template variables', async () => {
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
            expect(reducePromptReceived).toContain('Known: known');
            // Unknown parameter should remain as-is
            expect(reducePromptReceived).toContain('Unknown: {{unknownParam}}');
        });
    });

    describe('AI Reduce Use Cases', () => {
        it('synthesizes bug analysis into executive summary', async () => {
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

            expect(output.assessment).toBeTruthy();
            expect(Array.isArray(output.priorities)).toBe(true);
            expect(Array.isArray(output.actions)).toBe(true);
        });

        it('deduplicates code review findings', async () => {
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

            expect(Array.isArray(output.uniqueFindings)).toBe(true);
            expect(output.uniqueFindings.length).toBe(2);
        });
    });
});
