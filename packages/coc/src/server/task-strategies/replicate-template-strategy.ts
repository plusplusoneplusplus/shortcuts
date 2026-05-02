/**
 * ReplicateTemplateStrategy
 *
 * Executes a commit-replication task using `replicateCommit` from forge.
 * Extracted from CLITaskExecutor.executeReplicateTemplate.
 */

import type { QueuedTask } from '@plusplusoneplusplus/forge';
import type { ChatPayload } from '../tasks/task-types';
import { createCLIAIInvoker } from '../../ai-invoker';
import { replicateCommit } from '@plusplusoneplusplus/forge/templates';
import type { ReplicateProgressCallback } from '@plusplusoneplusplus/forge/templates';
import type { ExecutionContext, TaskResult, TaskStrategy } from './index';

export class ReplicateTemplateStrategy implements TaskStrategy {
    async execute(task: QueuedTask, context: ExecutionContext): Promise<TaskResult> {
        const { processId, store, approvePermissions, workingDirectory } = context;
        const payload = task.payload as unknown as ChatPayload;
        const replication = payload.context!.replication!;

        if (!workingDirectory) {
            throw new Error('Cannot resolve repository root for replicate-template task');
        }

        // Update process with enriched prompt preview
        const preview = `Replicate commit ${replication.commitHash.slice(0, 8)} → "${payload.prompt}"`;
        store.updateProcess(processId, {
            fullPrompt: payload.prompt,
            promptPreview: preview,
        });

        // Create AI invoker (same pattern as executeRunPipeline)
        const aiInvoker = createCLIAIInvoker({
            model: replication.model ?? payload.model ?? (task.config as any)?.model,
            approvePermissions,
            workingDirectory,
        });

        // Build progress callback → SSE events
        const onProgress: ReplicateProgressCallback = (stage, detail) => {
            try {
                store.emitProcessEvent(processId, {
                    type: 'pipeline-progress',
                    pipelineProgress: {
                        phase: 'job',
                        totalItems: 1,
                        completedItems: 0,
                        failedItems: 0,
                        percentage: 0,
                        message: detail ? `[${stage}] ${detail}` : stage,
                    },
                });
            } catch {
                // Non-fatal: store may be a stub
            }
        };

        // Emit phase-start event
        try {
            store.emitProcessEvent(processId, {
                type: 'pipeline-phase',
                pipelinePhase: { phase: 'job', status: 'started', timestamp: new Date().toISOString() },
            });
        } catch {
            // Non-fatal
        }

        // Execute replication
        let result;
        try {
            result = await replicateCommit(
                {
                    template: {
                        name: replication.templateName,
                        kind: 'commit',
                        commitHash: replication.commitHash,
                        hints: replication.hints,
                    },
                    repoRoot: workingDirectory,
                    instruction: payload.prompt,
                },
                aiInvoker,
                onProgress,
            );
        } catch (err) {
            // Emit failure phase event before re-throwing
            try {
                store.emitProcessEvent(processId, {
                    type: 'pipeline-phase',
                    pipelinePhase: { phase: 'job', status: 'failed', timestamp: new Date().toISOString() },
                });
            } catch {
                // Non-fatal
            }
            throw err;
        }

        // Emit phase-complete event
        try {
            store.emitProcessEvent(processId, {
                type: 'pipeline-phase',
                pipelinePhase: { phase: 'job', status: 'completed', timestamp: new Date().toISOString() },
            });
        } catch {
            // Non-fatal
        }

        // Return structured result for the apply endpoint
        return {
            response: result.summary,
            replicateResult: {
                summary: result.summary,
                files: result.files,
                commitHash: replication.commitHash,
                templateName: replication.templateName,
            },
        };
    }
}
