/**
 * Queue Executor Bridge
 *
 * Wires up a QueueExecutor with a CLITaskExecutor to actually execute
 * queued tasks in the pipeline serve server. Bridges executor events
 * to the ProcessStore and WebSocket for real-time UI updates.
 *
 * Task types supported:
 * - ai-clarification: Sends prompt to CopilotSDKService
 * - custom: Sends payload.data.prompt to CopilotSDKService
 * - follow-prompt: Reads prompt file and sends to CopilotSDKService
 * - code-review / resolve-comments: Marked as completed (no-op placeholder)
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import {
    QueueExecutor,
    createQueueExecutor,
    TaskQueueManager,
    QueuedTask,
    TaskExecutor,
    TaskExecutionResult,
    isFollowPromptPayload,
    isAIClarificationPayload,
    isCustomTaskPayload,
    getCopilotSDKService,
    approveAllPermissions,
    DEFAULT_AI_TIMEOUT_MS,
    getLogger,
    LogCategory,
} from '@plusplusoneplusplus/pipeline-core';
import type { ProcessStore, AIProcess } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Types
// ============================================================================

export interface QueueExecutorBridgeOptions {
    /** Maximum concurrent task executions (default: 1) */
    maxConcurrency?: number;
    /** Whether to auto-start processing (default: true) */
    autoStart?: boolean;
    /** Whether to auto-approve AI permission requests (default: true) */
    approvePermissions?: boolean;
    /** Working directory for AI sessions */
    workingDirectory?: string;
}

// ============================================================================
// CLI Task Executor
// ============================================================================

/**
 * Task executor that uses CopilotSDKService to execute queued tasks.
 * Creates AIProcess entries in the ProcessStore for tracking.
 */
export class CLITaskExecutor implements TaskExecutor {
    private readonly store: ProcessStore;
    private readonly cancelledTasks: Set<string> = new Set();
    private readonly approvePermissions: boolean;
    private readonly defaultWorkingDirectory?: string;

    constructor(store: ProcessStore, options: { approvePermissions?: boolean; workingDirectory?: string } = {}) {
        this.store = store;
        this.approvePermissions = options.approvePermissions !== false;
        this.defaultWorkingDirectory = options.workingDirectory;
    }

    async execute(task: QueuedTask): Promise<TaskExecutionResult> {
        const logger = getLogger();
        const startTime = Date.now();

        logger.debug(LogCategory.AI, `[QueueExecutor] Starting task ${task.id} (type: ${task.type}, name: ${task.displayName || 'unnamed'})`);

        // Check if cancelled before starting
        if (this.cancelledTasks.has(task.id)) {
            logger.debug(LogCategory.AI, `[QueueExecutor] Task ${task.id} was cancelled before starting`);
            return { success: false, error: new Error('Task cancelled'), durationMs: 0 };
        }

        // Create a process in the store for tracking
        const processId = `queue-${task.id}`;
        const prompt = this.extractPrompt(task);
        const workingDirectory = this.getWorkingDirectory(task);
        const process: AIProcess = {
            id: processId,
            type: `queue-${task.type}`,
            promptPreview: prompt.length > 80 ? prompt.substring(0, 77) + '...' : prompt,
            fullPrompt: prompt,
            status: 'running',
            startTime: new Date(),
            workingDirectory,
            metadata: {
                type: `queue-${task.type}`,
                queueTaskId: task.id,
                priority: task.priority,
                model: task.config.model,
            },
        };

        try {
            await this.store.addProcess(process);
        } catch {
            // Non-fatal: store may be a stub
        }

        // Link process ID to task
        task.processId = processId;

        try {
            const result = await this.executeByType(task, prompt);

            const duration = Date.now() - startTime;
            logger.debug(LogCategory.AI, `[QueueExecutor] Task ${task.id} completed in ${duration}ms`);

            // Update process as completed
            try {
                await this.store.updateProcess(processId, {
                    status: 'completed',
                    endTime: new Date(),
                    result: typeof result === 'string' ? result : JSON.stringify(result),
                });
                this.store.emitProcessComplete(processId, 'completed', `${duration}ms`);
            } catch {
                // Non-fatal
            }

            return {
                success: true,
                result,
                durationMs: Date.now() - startTime,
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const duration = Date.now() - startTime;
            logger.debug(LogCategory.AI, `[QueueExecutor] Task ${task.id} failed in ${duration}ms: ${errorMsg}`);

            // Update process as failed
            try {
                await this.store.updateProcess(processId, {
                    status: 'failed',
                    endTime: new Date(),
                    error: errorMsg,
                });
                this.store.emitProcessComplete(processId, 'failed', `${duration}ms`);
            } catch {
                // Non-fatal
            }

            return {
                success: false,
                error: error instanceof Error ? error : new Error(errorMsg),
                durationMs: Date.now() - startTime,
            };
        }
    }

    cancel(taskId: string): void {
        this.cancelledTasks.add(taskId);
    }

    // ========================================================================
    // Private — Prompt Extraction
    // ========================================================================

    private extractPrompt(task: QueuedTask): string {
        if (isAIClarificationPayload(task.payload)) {
            return task.payload.prompt || task.displayName || 'AI clarification task';
        }

        if (isFollowPromptPayload(task.payload)) {
            // Try to read the prompt file content
            try {
                if (task.payload.promptFilePath && fs.existsSync(task.payload.promptFilePath)) {
                    const content = fs.readFileSync(task.payload.promptFilePath, 'utf-8');
                    let prompt = `Follow the instruction ${task.payload.promptFilePath}.`;
                    if (task.payload.planFilePath) {
                        prompt += ` ${task.payload.planFilePath}`;
                    }
                    if (task.payload.additionalContext) {
                        prompt += `\n\nAdditional context: ${task.payload.additionalContext}`;
                    }
                    return prompt;
                }
            } catch {
                // Fall through to default
            }
            return `Follow prompt: ${task.payload.promptFilePath || 'unknown'}`;
        }

        if (isCustomTaskPayload(task.payload)) {
            const data = task.payload.data;
            if (typeof data.prompt === 'string' && data.prompt.trim()) {
                return data.prompt;
            }
        }

        return task.displayName || `Queue task: ${task.type}`;
    }

    // ========================================================================
    // Private — Execution by Type
    // ========================================================================

    private async executeByType(task: QueuedTask, prompt: string): Promise<unknown> {
        // For types that need AI execution
        if (
            isAIClarificationPayload(task.payload) ||
            isCustomTaskPayload(task.payload) ||
            isFollowPromptPayload(task.payload)
        ) {
            return this.executeWithAI(task, prompt);
        }

        // For code-review and resolve-comments: placeholder (no-op)
        return { status: 'completed', message: `Task type '${task.type}' executed (no-op in CLI mode)` };
    }

    private async executeWithAI(task: QueuedTask, prompt: string): Promise<unknown> {
        const sdkService = getCopilotSDKService();
        const processId = `queue-${task.id}`;

        const availability = await sdkService.isAvailable();
        if (!availability.available) {
            throw new Error(`Copilot SDK not available: ${availability.error || 'unknown reason'}`);
        }

        const workingDirectory = this.getWorkingDirectory(task);
        const timeoutMs = task.config.timeoutMs || DEFAULT_AI_TIMEOUT_MS;

        const result = await sdkService.sendMessage({
            prompt,
            model: task.config.model,
            workingDirectory,
            timeoutMs,
            usePool: false,
            onPermissionRequest: this.approvePermissions ? approveAllPermissions : undefined,
            // Stream response chunks to the process store for real-time UI updates
            onStreamingChunk: (chunk: string) => {
                try {
                    this.store.emitProcessOutput(processId, chunk);
                } catch {
                    // Non-fatal: store may be a stub
                }
            },
        });

        if (!result.success) {
            throw new Error(result.error || 'AI execution failed');
        }

        return {
            response: result.response || '(Task completed via tool execution — no text response produced)',
            sessionId: result.sessionId,
        };
    }

    private getWorkingDirectory(task: QueuedTask): string | undefined {
        if (isFollowPromptPayload(task.payload)) {
            return task.payload.workingDirectory || this.defaultWorkingDirectory;
        }
        if (isAIClarificationPayload(task.payload)) {
            return task.payload.workingDirectory || this.defaultWorkingDirectory;
        }
        return this.defaultWorkingDirectory;
    }
}

// ============================================================================
// Bridge Factory
// ============================================================================

/**
 * Create a QueueExecutor wired to a CLITaskExecutor and ProcessStore.
 *
 * Returns the executor so the caller can listen to events and control lifecycle.
 */
export function createQueueExecutorBridge(
    queueManager: TaskQueueManager,
    store: ProcessStore,
    options: QueueExecutorBridgeOptions = {}
): QueueExecutor {
    const taskExecutor = new CLITaskExecutor(store, {
        approvePermissions: options.approvePermissions !== false,
        workingDirectory: options.workingDirectory,
    });

    const executor = createQueueExecutor(queueManager, taskExecutor, {
        maxConcurrency: options.maxConcurrency ?? 1,
        autoStart: options.autoStart !== false,
    });

    return executor;
}
