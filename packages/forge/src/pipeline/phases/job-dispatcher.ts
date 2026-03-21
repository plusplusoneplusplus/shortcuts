/**
 * Pipeline Job Dispatcher
 *
 * Handles single-job (non-map-reduce) pipeline execution.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    PipelineConfig,
} from '../types';
import {
    PromptItem,
} from '../../map-reduce';
import { DEFAULT_AI_TIMEOUT_MS } from '../../config/defaults';
import { extractVariables } from '../template';
import { substituteVariables } from '../../utils/template-engine';
import { resolvePromptFile } from '../prompt-resolver';
import { resolveSkill } from '../skill-resolver';
import {
    PipelineExecutionError,
    ExecutePipelineOptions,
    PipelineExecutionResult,
    convertParametersToObject,
    emitPhase,
} from './shared';
import { deriveWorkspaceRoot, buildPromptWithSkill } from './prompt-resolution';
import { withRetry } from '../retry-utils';

/**
 * Execute a single AI job (no map-reduce cycle)
 */
export async function executeSingleJob(
    config: PipelineConfig,
    options: ExecutePipelineOptions
): Promise<PipelineExecutionResult> {
    const startTime = Date.now();
    const job = config.job!;

    try {
        // 1. Resolve prompt from inline or file
        let prompt: string;
        if (job.prompt) {
            prompt = job.prompt;
        } else if (job.promptFile) {
            prompt = await resolvePromptFile(job.promptFile, options.pipelineDirectory);
        } else {
            throw new PipelineExecutionError('Job config must have either "job.prompt" or "job.promptFile"', 'job');
        }

        // 2. Attach skill context if set
        if (job.skill) {
            const effectiveWorkspaceRoot = deriveWorkspaceRoot(options.pipelineDirectory, options.workspaceRoot);
            try {
                const skillContent = await resolveSkill(job.skill, effectiveWorkspaceRoot);
                prompt = buildPromptWithSkill(prompt, skillContent, job.skill);
            } catch (error) {
                throw new PipelineExecutionError(
                    `Failed to resolve job skill "${job.skill}": ${error instanceof Error ? error.message : String(error)}`,
                    'job'
                );
            }
        }

        // 3. Collect parameters and substitute template variables
        if (config.parameters && config.parameters.length > 0) {
            const paramValues = convertParametersToObject(config.parameters);

            // Validate that all template variables are provided
            const templateVars = extractVariables(prompt);
            const missingVars = templateVars.filter(v => !(v in paramValues));
            if (missingVars.length > 0) {
                throw new PipelineExecutionError(
                    `Job prompt has missing required variables: ${missingVars.join(', ')}`,
                    'job'
                );
            }

            prompt = substituteVariables(prompt, paramValues, {
                strict: false,
                missingValueBehavior: 'empty',
                preserveSpecialVariables: false
            });
        } else {
            // Even without parameters, validate no unresolved variables remain
            const templateVars = extractVariables(prompt);
            if (templateVars.length > 0) {
                throw new PipelineExecutionError(
                    `Job prompt has missing required variables: ${templateVars.join(', ')}`,
                    'job'
                );
            }
        }

        // 4. Set up timeout
        const timeoutMs = job.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;

        // 5. Call AI with timeout; retry once with doubled timeout on timeout error
        emitPhase(options, 'job', 'started');
        const jobStart = Date.now();
        let aiResult = await withRetry(
            async (attempt) => {
                const t = attempt === 0 ? timeoutMs : timeoutMs * 2;
                return await Promise.race([
                    options.aiInvoker(prompt, { model: job.model }),
                    new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error(`Job timed out after ${t}ms`)), t)
                    )
                ]);
            },
            {
                maxAttempts: 2,
                shouldRetry: (err) => err instanceof Error && err.message.includes('timed out'),
            }
        );

        // 6. Process result
        const jobProcessId = `${config.name}-job-${startTime}`;
        if (!aiResult.success || !aiResult.response) {
            const executionTimeMs = Date.now() - startTime;
            const errorMsg = aiResult.error || 'AI invocation failed';
            emitPhase(options, 'job', 'failed', { durationMs: Date.now() - jobStart, error: errorMsg });
            if (options.onItemProcessCreated) {
                try {
                    options.onItemProcessCreated({
                        itemIndex: 0,
                        processId: jobProcessId,
                        item: { prompt: prompt } as PromptItem,
                        phase: 'job',
                        success: false,
                        error: errorMsg,
                        sessionId: aiResult.sessionId,
                    });
                } catch { /* callback errors don't break execution */ }
            }
            return {
                success: false,
                output: {
                    results: [],
                    formattedOutput: '',
                    summary: { totalItems: 1, successfulItems: 0, failedItems: 1, outputFields: job.output || [] }
                },
                mapResults: [{
                    workItemId: 'job-0',
                    success: false,
                    output: {} as any,
                    error: errorMsg,
                    executionTimeMs
                }],
                reduceStats: { inputCount: 1, outputCount: 0, mergedCount: 0, reduceTimeMs: 0, usedAIReduce: false },
                totalTimeMs: executionTimeMs,
                executionStats: { totalItems: 1, successfulMaps: 0, failedMaps: 1, mapPhaseTimeMs: executionTimeMs, reducePhaseTimeMs: 0, maxConcurrency: 1 },
                error: errorMsg,
                itemProcessIds: [jobProcessId]
            };
        }

        // 7. Parse output
        const executionTimeMs = Date.now() - startTime;
        let parsedOutput: Record<string, unknown> = {};
        let formattedOutput: string = aiResult.response;

        if (job.output && job.output.length > 0) {
            // Structured output mode - parse JSON
            try {
                const jsonMatch = aiResult.response.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    throw new Error('Response does not contain a JSON object');
                }
                const parsed = JSON.parse(jsonMatch[0]);
                for (const field of job.output) {
                    parsedOutput[field] = field in parsed ? parsed[field] : null;
                }
                formattedOutput = JSON.stringify(parsedOutput, null, 2);
            } catch (error) {
                const parseError = `Failed to parse AI response: ${error instanceof Error ? error.message : String(error)}`;
                emitPhase(options, 'job', 'failed', { durationMs: Date.now() - jobStart, error: parseError });
                if (options.onItemProcessCreated) {
                    try {
                        options.onItemProcessCreated({
                            itemIndex: 0,
                            processId: jobProcessId,
                            item: { prompt: prompt } as PromptItem,
                            phase: 'job',
                            success: false,
                            error: parseError,
                            sessionId: aiResult.sessionId,
                        });
                    } catch { /* callback errors don't break execution */ }
                }
                return {
                    success: false,
                    output: {
                        results: [],
                        formattedOutput: '',
                        summary: { totalItems: 1, successfulItems: 0, failedItems: 1, outputFields: job.output }
                    },
                    mapResults: [{
                        workItemId: 'job-0',
                        success: false,
                        output: {} as any,
                        error: parseError,
                        executionTimeMs
                    }],
                    reduceStats: { inputCount: 1, outputCount: 0, mergedCount: 0, reduceTimeMs: 0, usedAIReduce: false },
                    totalTimeMs: executionTimeMs,
                    executionStats: { totalItems: 1, successfulMaps: 0, failedMaps: 1, mapPhaseTimeMs: executionTimeMs, reducePhaseTimeMs: 0, maxConcurrency: 1 },
                    error: parseError,
                    itemProcessIds: [jobProcessId]
                };
            }
        }

        // 8. Return success result
        emitPhase(options, 'job', 'completed', { durationMs: Date.now() - jobStart });
        if (options.onItemProcessCreated) {
            try {
                options.onItemProcessCreated({
                    itemIndex: 0,
                    processId: jobProcessId,
                    item: { prompt: prompt } as PromptItem,
                    phase: 'job',
                    success: true,
                    sessionId: aiResult.sessionId,
                });
            } catch { /* callback errors don't break execution */ }
        }
        return {
            success: true,
            output: {
                results: [],
                formattedOutput,
                summary: { totalItems: 1, successfulItems: 1, failedItems: 0, outputFields: job.output || [] }
            },
            mapResults: [{
                workItemId: 'job-0',
                success: true,
                output: parsedOutput as any,
                executionTimeMs
            }],
            reduceStats: { inputCount: 1, outputCount: 1, mergedCount: 1, reduceTimeMs: 0, usedAIReduce: false },
            totalTimeMs: executionTimeMs,
            executionStats: { totalItems: 1, successfulMaps: 1, failedMaps: 0, mapPhaseTimeMs: executionTimeMs, reducePhaseTimeMs: 0, maxConcurrency: 1 },
            itemProcessIds: [jobProcessId]
        };
    } catch (error) {
        if (error instanceof PipelineExecutionError) {
            throw error;
        }

        const executionTimeMs = Date.now() - startTime;
        const errorMsg = error instanceof Error ? error.message : String(error);
        emitPhase(options, 'job', 'failed', { durationMs: executionTimeMs, error: errorMsg });
        return {
            success: false,
            output: {
                results: [],
                formattedOutput: '',
                summary: { totalItems: 1, successfulItems: 0, failedItems: 1, outputFields: config.job?.output || [] }
            },
            mapResults: [{
                workItemId: 'job-0',
                success: false,
                output: {} as any,
                error: errorMsg,
                executionTimeMs
            }],
            reduceStats: { inputCount: 1, outputCount: 0, mergedCount: 0, reduceTimeMs: 0, usedAIReduce: false },
            totalTimeMs: executionTimeMs,
            executionStats: { totalItems: 1, successfulMaps: 0, failedMaps: 1, mapPhaseTimeMs: executionTimeMs, reducePhaseTimeMs: 0, maxConcurrency: 1 },
            error: errorMsg
        };
    }
}
