/**
 * Workflow Executor
 *
 * Concrete executor that owns DAG workflow execution: reading pipeline YAML,
 * compiling it to a WorkflowConfig, invoking executeWorkflow from coc-workflow,
 * mapping node-progress events to SSE, and tracking child pipeline-item processes.
 *
 * Extends BaseExecutor for shared streaming/cancellation plumbing.
 * Must NOT import chat/AI SDK logic directly.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
    AIProcess,
    PipelinePhase,
    PipelinePhaseStatus,
    ProcessStore,
    QueuedTask,
} from '@plusplusoneplusplus/forge';
import {
    compileToWorkflow,
    executeWorkflow,
    flattenWorkflowResult,
} from '@plusplusoneplusplus/coc-workflow';
import {
    toQueueProcessId,
} from '@plusplusoneplusplus/forge';
import type { RunWorkflowPayload } from '../tasks/task-types';
import { BaseExecutor } from './base-executor';
import { createCLIAIInvoker } from '../../ai-invoker';

// ============================================================================
// Types
// ============================================================================

export interface WorkflowExecutorOptions {
    /** Whether to auto-approve AI permission requests (default: true) */
    approvePermissions?: boolean;
    /** Default working directory for AI sessions */
    workingDirectory?: string;
}

// ============================================================================
// WorkflowExecutor
// ============================================================================

export class WorkflowExecutor extends BaseExecutor {
    private readonly approvePermissions: boolean;
    private readonly defaultWorkingDirectory?: string;

    constructor(store: ProcessStore, options: WorkflowExecutorOptions = {}, dataDir?: string) {
        super(store, dataDir);
        this.approvePermissions = options.approvePermissions !== false;
        this.defaultWorkingDirectory = options.workingDirectory;
    }

    /**
     * Execute a run-workflow task: compile the pipeline YAML, run the DAG,
     * emit progress SSE events, and return a flattened result.
     */
    async execute(task: QueuedTask): Promise<unknown> {
        const payload = task.payload as unknown as RunWorkflowPayload;
        const yamlPath = path.join(payload.workflowPath, 'pipeline.yaml');

        const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
        const config = compileToWorkflow(yamlContent);

        const aiInvoker = createCLIAIInvoker({
            model: payload.model,
            approvePermissions: this.approvePermissions,
            workingDirectory: payload.workingDirectory || this.defaultWorkingDirectory,
            mcpServers: payload.mcpServers,
        });

        const processId = toQueueProcessId(task.id);
        const childProcessIds: string[] = [];

        const result = await executeWorkflow(config, {
            aiInvoker,
            workflowDirectory: payload.workflowPath,
            workspaceRoot: payload.workingDirectory,
            model: payload.model,
            parameters: payload.params,
            onProgress: (event) => {
                const statusMap: Record<string, PipelinePhaseStatus> = {
                    pending: 'started', running: 'started', completed: 'completed', failed: 'failed', warned: 'completed',
                };
                try {
                    this.store.emitProcessEvent(processId, {
                        type: 'pipeline-phase',
                        pipelinePhase: {
                            phase: event.nodeId as PipelinePhase,
                            status: statusMap[event.phase] ?? 'started',
                            timestamp: event.timestamp,
                            durationMs: event.durationMs,
                            error: event.error,
                            itemCount: event.inputItemCount,
                        },
                    });
                } catch {
                    // Non-fatal: store may be a stub
                }
                if (event.itemProgress) {
                    try {
                        const total = event.itemProgress.total;
                        const completed = event.itemProgress.completed;
                        this.store.emitProcessEvent(processId, {
                            type: 'pipeline-progress',
                            pipelineProgress: {
                                phase: event.nodeId as PipelinePhase,
                                totalItems: total,
                                completedItems: completed,
                                failedItems: event.itemProgress.failed,
                                percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
                                message: `Node ${event.nodeId}: ${completed}/${total}`,
                            },
                        });
                    } catch {
                        // Non-fatal
                    }
                }
            },
            onItemProcess: (event) => {
                childProcessIds.push(event.processId);
                const label = event.itemLabel ?? `Item ${event.itemIndex}`;
                const childProcess: AIProcess = {
                    id: event.processId,
                    type: 'pipeline-item',
                    parentProcessId: processId,
                    promptPreview: label.length > 80 ? label.substring(0, 77) + '...' : label,
                    fullPrompt: label,
                    status: event.status === 'completed' ? 'completed' : (event.status === 'failed' ? 'failed' : 'running'),
                    startTime: new Date(),
                    metadata: {
                        type: 'pipeline-item',
                        itemIndex: event.itemIndex,
                        nodeId: event.nodeId,
                        parentPipelineId: processId,
                    },
                };
                if (event.error) {
                    childProcess.error = event.error;
                }
                this.store.addProcess(childProcess).catch(() => {
                    // Non-fatal: don't fail the pipeline if store write fails
                });
                try {
                    this.store.emitProcessEvent(processId, {
                        type: 'pipeline-progress',
                        pipelineProgress: {
                            phase: 'map',
                            totalItems: 0,
                            completedItems: 0,
                            failedItems: 0,
                            percentage: 0,
                            message: `Item process created: ${event.processId}`,
                        },
                    });
                } catch {
                    // Non-fatal
                }
            },
        });

        const flatResult = flattenWorkflowResult(result, config);

        if (childProcessIds.length) {
            this.store.updateProcess(processId, {
                groupMetadata: {
                    type: 'pipeline-execution',
                    childProcessIds,
                },
            }).catch(() => {
                // Non-fatal
            });
        }

        this.store.getProcess(processId, (task.payload as any)?.workspaceId as string | undefined).then(current => {
            return this.store.updateProcess(processId, {
                metadata: {
                    type: current?.metadata?.type ?? task.type,
                    ...(current?.metadata ?? {}),
                    executionStats: flatResult.stats,
                    pipelineConfig: config,
                },
            });
        }).catch(() => {
            // Non-fatal
        });

        return {
            response: flatResult.formattedOutput ?? JSON.stringify(flatResult.stats),
            pipelineName: config.name,
            stats: flatResult.stats,
        };
    }
}
