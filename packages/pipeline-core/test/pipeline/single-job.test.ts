/**
 * Tests for Single AI Job Pipeline Support
 *
 * Tests the `job:` discriminator in the YAML pipeline framework.
 * When `job:` is present (and `map:` absent), a single AI call is executed
 * instead of a full map-reduce cycle.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    executePipeline,
    parsePipelineYAML,
    parsePipelineYAMLSync,
    PipelineExecutionError,
} from '../../src/pipeline';
import type { PipelineConfig, AIInvokerResult, JobConfig } from '../../src/pipeline';

describe('Single AI Job', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'single-job-test-'));
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    describe('parsePipelineYAML - job mode', () => {
        it('parses YAML with job inline prompt', async () => {
            const yaml = `
name: "Single Job"
job:
  prompt: "Summarize the project"
  output: [summary, key_points]
`;

            const config = await parsePipelineYAML(yaml);

            expect(config.name).toBe('Single Job');
            expect(config.job).toBeTruthy();
            expect(config.job!.prompt).toBe('Summarize the project');
            expect(config.job!.output).toEqual(['summary', 'key_points']);
            expect(config.map).toBeUndefined();
            expect(config.reduce).toBeUndefined();
        });

        it('parses YAML with job promptFile', async () => {
            const promptPath = path.join(tempDir, 'my-prompt.md');
            await fs.promises.writeFile(promptPath, 'Analyze the codebase');

            const yaml = `
name: "File Prompt Job"
job:
  promptFile: "my-prompt.md"
`;

            const config = await parsePipelineYAML(yaml);

            expect(config.job).toBeTruthy();
            expect(config.job!.promptFile).toBe('my-prompt.md');
            expect(config.job!.prompt).toBeUndefined();
        });

        it('parses YAML with job model and timeout', async () => {
            const yaml = `
name: "Configured Job"
job:
  prompt: "Do something"
  model: "gpt-4"
  timeoutMs: 60000
`;

            const config = await parsePipelineYAML(yaml);

            expect(config.job!.model).toBe('gpt-4');
            expect(config.job!.timeoutMs).toBe(60000);
        });

        it('parses YAML with top-level parameters', async () => {
            const yaml = `
name: "Parameterized Job"
parameters:
  - name: projectName
    value: "MyProject"
  - name: language
    value: "TypeScript"
job:
  prompt: "Analyze {{projectName}} written in {{language}}"
  output: [analysis]
`;

            const config = await parsePipelineYAML(yaml);

            expect(config.parameters).toBeTruthy();
            expect(config.parameters!.length).toBe(2);
            expect(config.parameters![0].name).toBe('projectName');
            expect(config.parameters![0].value).toBe('MyProject');
            expect(config.parameters![1].name).toBe('language');
            expect(config.parameters![1].value).toBe('TypeScript');
        });

        it('throws when job and map are both present', async () => {
            const yaml = `
name: "Invalid"
job:
  prompt: "Do something"
map:
  prompt: "{{x}}"
  output: [y]
input:
  items:
    - x: "1"
reduce:
  type: list
`;

            await expect(parsePipelineYAML(yaml)).rejects.toThrow(
                /Cannot use `job` and `map` in the same pipeline/
            );
        });

        it('throws when job has no prompt or promptFile', async () => {
            const yaml = `
name: "No Prompt Job"
job:
  output: [result]
`;

            await expect(parsePipelineYAML(yaml)).rejects.toThrow(
                /Job config must have either "job.prompt" or "job.promptFile"/
            );
        });

        it('throws when job has both prompt and promptFile', async () => {
            const yaml = `
name: "Both Prompts Job"
job:
  prompt: "inline prompt"
  promptFile: "file.md"
`;

            await expect(parsePipelineYAML(yaml)).rejects.toThrow(
                /Job config cannot have both "job.prompt" and "job.promptFile"/
            );
        });
    });

    describe('parsePipelineYAMLSync - job mode', () => {
        it('parses valid job YAML synchronously', () => {
            const yaml = `
name: "Sync Job Test"
job:
  prompt: "Do analysis"
  output: [result]
  model: "claude-sonnet"
`;

            const config = parsePipelineYAMLSync(yaml);

            expect(config.name).toBe('Sync Job Test');
            expect(config.job).toBeTruthy();
            expect(config.job!.prompt).toBe('Do analysis');
            expect(config.job!.output).toEqual(['result']);
            expect(config.job!.model).toBe('claude-sonnet');
        });

        it('throws synchronously for job + map conflict', () => {
            const yaml = `
name: "Invalid"
job:
  prompt: "Do something"
map:
  prompt: "{{x}}"
  output: [y]
input:
  items:
    - x: "1"
reduce:
  type: list
`;

            expect(() => parsePipelineYAMLSync(yaml)).toThrow(
                /Cannot use `job` and `map` in the same pipeline/
            );
        });
    });

    describe('executePipeline - single job text mode', () => {
        it('executes single job and returns raw AI response (no output fields)', async () => {
            const config: PipelineConfig = {
                name: 'Text Job',
                job: {
                    prompt: 'Summarize the project'
                }
            };

            const aiInvoker = async (prompt: string): Promise<AIInvokerResult> => {
                expect(prompt).toBe('Summarize the project');
                return { success: true, response: 'This project is a VSCode extension for shortcuts.' };
            };

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            expect(result.success).toBe(true);
            expect(result.output).toBeTruthy();
            expect(result.output!.formattedOutput).toBe('This project is a VSCode extension for shortcuts.');
            expect(result.output!.summary.totalItems).toBe(1);
            expect(result.output!.summary.successfulItems).toBe(1);
            expect(result.output!.summary.failedItems).toBe(0);
            expect(result.executionStats.totalItems).toBe(1);
            expect(result.executionStats.successfulMaps).toBe(1);
            expect(result.executionStats.failedMaps).toBe(0);
            expect(result.executionStats.maxConcurrency).toBe(1);
            expect(result.reduceStats.usedAIReduce).toBe(false);
            expect(result.totalTimeMs).toBeGreaterThanOrEqual(0);
        });
    });

    describe('executePipeline - single job structured output', () => {
        it('parses JSON from AI response with output fields', async () => {
            const config: PipelineConfig = {
                name: 'Structured Job',
                job: {
                    prompt: 'Analyze the codebase',
                    output: ['summary', 'complexity', 'suggestions']
                }
            };

            const aiInvoker = async (): Promise<AIInvokerResult> => ({
                success: true,
                response: '{"summary": "Well-structured", "complexity": "medium", "suggestions": ["Add tests", "Improve docs"]}'
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            expect(result.success).toBe(true);
            expect(result.output).toBeTruthy();
            expect(result.mapResults).toBeTruthy();
            expect(result.mapResults!.length).toBe(1);
            expect(result.mapResults![0].success).toBe(true);
            expect(result.mapResults![0].output.summary).toBe('Well-structured');
            expect(result.mapResults![0].output.complexity).toBe('medium');
            expect(result.mapResults![0].output.suggestions).toEqual(['Add tests', 'Improve docs']);
            expect(result.output!.summary.outputFields).toEqual(['summary', 'complexity', 'suggestions']);
        });

        it('handles missing output fields in AI response (sets to null)', async () => {
            const config: PipelineConfig = {
                name: 'Missing Fields Job',
                job: {
                    prompt: 'Analyze',
                    output: ['found_field', 'missing_field']
                }
            };

            const aiInvoker = async (): Promise<AIInvokerResult> => ({
                success: true,
                response: '{"found_field": "value"}'
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            expect(result.success).toBe(true);
            expect(result.mapResults![0].output.found_field).toBe('value');
            expect(result.mapResults![0].output.missing_field).toBeNull();
        });
    });

    describe('executePipeline - template variable substitution', () => {
        it('substitutes variables from top-level parameters', async () => {
            const config: PipelineConfig = {
                name: 'Template Job',
                parameters: [
                    { name: 'projectName', value: 'MyApp' },
                    { name: 'version', value: '2.0' }
                ],
                job: {
                    prompt: 'Analyze {{projectName}} version {{version}}'
                }
            };

            let capturedPrompt = '';
            const aiInvoker = async (prompt: string): Promise<AIInvokerResult> => {
                capturedPrompt = prompt;
                return { success: true, response: 'Analysis complete' };
            };

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            expect(result.success).toBe(true);
            expect(capturedPrompt).toBe('Analyze MyApp version 2.0');
        });

        it('throws on missing required variables', async () => {
            const config: PipelineConfig = {
                name: 'Missing Vars Job',
                job: {
                    prompt: 'Analyze {{projectName}} and {{otherVar}}'
                }
            };

            await expect(
                executePipeline(config, {
                    aiInvoker: async () => ({ success: true, response: 'ok' }),
                    pipelineDirectory: tempDir
                })
            ).rejects.toThrow(/missing required variables.*projectName.*otherVar/i);
        });

        it('throws on missing required variables even when some params provided', async () => {
            const config: PipelineConfig = {
                name: 'Partial Vars Job',
                parameters: [
                    { name: 'projectName', value: 'MyApp' }
                ],
                job: {
                    prompt: 'Analyze {{projectName}} and {{missingVar}}'
                }
            };

            await expect(
                executePipeline(config, {
                    aiInvoker: async () => ({ success: true, response: 'ok' }),
                    pipelineDirectory: tempDir
                })
            ).rejects.toThrow(/missing required variables.*missingVar/i);
        });
    });

    describe('executePipeline - single job AI failure', () => {
        it('returns failure result when AI invocation fails', async () => {
            const config: PipelineConfig = {
                name: 'Failing Job',
                job: {
                    prompt: 'Do something'
                }
            };

            const aiInvoker = async (): Promise<AIInvokerResult> => ({
                success: false,
                error: 'AI service unavailable'
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            expect(result.success).toBe(false);
            expect(result.error).toBe('AI service unavailable');
            expect(result.executionStats.totalItems).toBe(1);
            expect(result.executionStats.successfulMaps).toBe(0);
            expect(result.executionStats.failedMaps).toBe(1);
            expect(result.mapResults![0].success).toBe(false);
            expect(result.mapResults![0].error).toBe('AI service unavailable');
        });

        it('returns failure when structured output cannot be parsed', async () => {
            const config: PipelineConfig = {
                name: 'Parse Failure Job',
                job: {
                    prompt: 'Analyze',
                    output: ['result']
                }
            };

            const aiInvoker = async (): Promise<AIInvokerResult> => ({
                success: true,
                response: 'This is not JSON at all!'
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            expect(result.success).toBe(false);
            expect(result.error).toMatch(/Failed to parse AI response/);
            expect(result.mapResults![0].success).toBe(false);
        });
    });

    describe('executePipeline - single job with model', () => {
        it('passes model to AI invoker', async () => {
            const config: PipelineConfig = {
                name: 'Model Job',
                job: {
                    prompt: 'Analyze',
                    model: 'gpt-4-turbo'
                }
            };

            let receivedModel: string | undefined;
            const aiInvoker = async (_prompt: string, options?: { model?: string }): Promise<AIInvokerResult> => {
                receivedModel = options?.model;
                return { success: true, response: 'done' };
            };

            await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            expect(receivedModel).toBe('gpt-4-turbo');
        });
    });

    describe('executePipeline - single job with promptFile', () => {
        it('resolves prompt from file', async () => {
            const promptContent = 'Analyze the entire codebase for issues';
            await fs.promises.writeFile(path.join(tempDir, 'analyze.md'), promptContent);

            const config: PipelineConfig = {
                name: 'File Prompt Job',
                job: {
                    promptFile: 'analyze.md'
                }
            };

            let capturedPrompt = '';
            const aiInvoker = async (prompt: string): Promise<AIInvokerResult> => {
                capturedPrompt = prompt;
                return { success: true, response: 'Analysis complete' };
            };

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            expect(result.success).toBe(true);
            expect(capturedPrompt).toBe(promptContent);
        });
    });

    describe('executePipeline - single job result structure', () => {
        it('returns correct mapResults structure', async () => {
            const config: PipelineConfig = {
                name: 'Structure Test',
                job: {
                    prompt: 'Test prompt',
                    output: ['result']
                }
            };

            const aiInvoker = async (): Promise<AIInvokerResult> => ({
                success: true,
                response: '{"result": "value"}'
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            expect(result.mapResults).toBeTruthy();
            expect(result.mapResults!.length).toBe(1);
            expect(result.mapResults![0].workItemId).toBe('job-0');
            expect(result.mapResults![0].success).toBe(true);
            expect(result.mapResults![0].executionTimeMs).toBeGreaterThanOrEqual(0);
        });

        it('returns correct reduceStats for job mode', async () => {
            const config: PipelineConfig = {
                name: 'Reduce Stats Test',
                job: {
                    prompt: 'Test'
                }
            };

            const result = await executePipeline(config, {
                aiInvoker: async () => ({ success: true, response: 'ok' }),
                pipelineDirectory: tempDir
            });

            expect(result.reduceStats.inputCount).toBe(1);
            expect(result.reduceStats.outputCount).toBe(1);
            expect(result.reduceStats.mergedCount).toBe(1);
            expect(result.reduceStats.reduceTimeMs).toBe(0);
            expect(result.reduceStats.usedAIReduce).toBe(false);
        });
    });

    describe('executePipeline - single job with skill', () => {
        it('attaches skill context to prompt', async () => {
            // Create a workspace root with skill directory structure inside tempDir
            const workspaceRoot = path.join(tempDir, 'workspace');
            const skillsDir = path.join(workspaceRoot, '.github', 'skills', 'test-skill');
            await fs.promises.mkdir(skillsDir, { recursive: true });
            await fs.promises.writeFile(
                path.join(skillsDir, 'SKILL.md'),
                'You are a helpful code reviewer.'
            );

            const config: PipelineConfig = {
                name: 'Skill Job',
                job: {
                    prompt: 'Review this code',
                    skill: 'test-skill'
                }
            };

            let capturedPrompt = '';
            const aiInvoker = async (prompt: string): Promise<AIInvokerResult> => {
                capturedPrompt = prompt;
                return { success: true, response: 'Review complete' };
            };

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir,
                workspaceRoot
            });

            expect(result.success).toBe(true);
            expect(capturedPrompt).toContain('[Skill Guidance: test-skill]');
            expect(capturedPrompt).toContain('You are a helpful code reviewer.');
            expect(capturedPrompt).toContain('[Task]');
            expect(capturedPrompt).toContain('Review this code');
        });
    });
});
