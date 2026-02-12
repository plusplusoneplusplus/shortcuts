/**
 * AIQueueService - VS Code adapter for the task queue system
 *
 * Wraps TaskQueueManager and QueueExecutor from pipeline-core
 * and integrates with AIProcessManager for process tracking.
 *
 * This service provides:
 * - Task queuing with priority support
 * - Integration with VS Code settings
 * - Event bridging to VS Code EventEmitter
 * - AI execution via CopilotSDKService
 */

import * as vscode from 'vscode';
import {
    TaskQueueManager,
    QueueExecutor,
    createTaskQueueManager,
    createQueueExecutor,
    QueuedTask,
    CreateTaskInput,
    TaskPayload,
    TaskPriority,
    QueueStats,
    TaskExecutor,
    TaskExecutionResult,
    QueueChangeEvent,
    getCopilotSDKService,
    approveAllPermissions,
    isFollowPromptPayload,
    isAIClarificationPayload,
    FollowPromptPayload,
    AIClarificationPayload,
} from '@plusplusoneplusplus/pipeline-core';
import { DEFAULT_AI_TIMEOUT_MS } from '../shared/ai-timeouts';
import { AIProcessManager } from './ai-process-manager';
import { getExtensionLogger, LogCategory } from './ai-service-logger';

// ============================================================================
// Configuration Keys
// ============================================================================

const CONFIG_SECTION = 'workspaceShortcuts.queue';
const CONFIG_ENABLED = 'enabled';
const CONFIG_MAX_CONCURRENCY = 'maxConcurrency';
const CONFIG_DEFAULT_PRIORITY = 'defaultPriority';
const CONFIG_NOTIFY_ON_COMPLETE = 'notifyOnComplete';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for creating a queued task
 */
export interface QueueTaskOptions {
    /** Task type */
    type: CreateTaskInput['type'];
    /** Task payload */
    payload: TaskPayload;
    /** Priority (defaults to setting) */
    priority?: TaskPriority;
    /** Display name for the task */
    displayName?: string;
    /** Execution configuration */
    config?: CreateTaskInput['config'];
}

/**
 * Result of queueing a task
 */
export interface QueueTaskResult {
    /** The task ID */
    taskId: string;
    /** Position in queue (1-based) */
    position: number;
    /** Total queued tasks */
    totalQueued: number;
}

/**
 * Result of batch queueing multiple tasks
 */
export interface BatchQueueResult {
    /** IDs of all queued tasks */
    taskIds: string[];
    /** Individual results for each task */
    results: QueueTaskResult[];
    /** Total number of queued tasks after batch */
    totalQueued: number;
    /** Number of tasks in this batch */
    batchSize: number;
}

// ============================================================================
// AI Task Executor
// ============================================================================

export function buildFollowPromptText(payload: FollowPromptPayload): string {
    // Keep this aligned with the interactive/background Follow Prompt behavior.
    let fullPrompt = `Follow the instruction ${payload.promptFilePath}. ${payload.planFilePath || ''}`.trim();
    if (payload.additionalContext && payload.additionalContext.trim()) {
        fullPrompt += `\n\nAdditional context: ${payload.additionalContext.trim()}`;
    }
    return fullPrompt;
}

/**
 * Task executor that uses CopilotSDKService for AI execution
 */
class AITaskExecutor implements TaskExecutor {
    private readonly processManager: AIProcessManager;
    private readonly cancelledTasks: Set<string> = new Set();

    constructor(processManager: AIProcessManager) {
        this.processManager = processManager;
    }

    async execute(task: QueuedTask): Promise<TaskExecutionResult> {
        const logger = getExtensionLogger();
        const startTime = Date.now();

        // Check if cancelled
        if (this.cancelledTasks.has(task.id)) {
            return {
                success: false,
                error: new Error('Task cancelled'),
                durationMs: 0,
            };
        }

        try {
            // Register process in AIProcessManager
            // NOTE: queued follow-prompt tasks should match the interactive/background prompt format
            // so the AI sees both the instruction and the target plan file.
            const promptForTracking =
                isFollowPromptPayload(task.payload)
                    ? buildFollowPromptText(task.payload as FollowPromptPayload)
                    : task.displayName || `Queue task: ${task.type}`;

            const processId = this.processManager.registerTypedProcess(promptForTracking, {
                type: `queue-${task.type}`,
                idPrefix: 'queue',
                metadata: {
                    type: `queue-${task.type}`,
                    queueTaskId: task.id,
                    priority: task.priority,
                },
            });

            // Link process ID to task
            task.processId = processId;

            // Execute based on task type
            let result: unknown;

            if (isFollowPromptPayload(task.payload)) {
                result = await this.executeFollowPrompt(task, task.payload as FollowPromptPayload);
            } else if (isAIClarificationPayload(task.payload)) {
                result = await this.executeAIClarification(task, task.payload as AIClarificationPayload);
            } else {
                // Generic execution - just mark as completed
                result = { status: 'completed', taskId: task.id };
            }

            // Attach SDK session ID and metadata for resume functionality
            const resultObj = result as Record<string, unknown> | undefined;
            if (resultObj?.sessionId && typeof resultObj.sessionId === 'string') {
                this.processManager.attachSdkSessionId(processId, resultObj.sessionId);
                // Determine working directory from payload
                const workingDir = isFollowPromptPayload(task.payload)
                    ? (task.payload as FollowPromptPayload).workingDirectory
                    : isAIClarificationPayload(task.payload)
                        ? (task.payload as AIClarificationPayload).workingDirectory
                        : undefined;
                this.processManager.attachSessionMetadata(processId, 'copilot-sdk', workingDir);
            }

            // Mark process as completed
            this.processManager.completeProcess(processId, JSON.stringify(result));

            return {
                success: true,
                result,
                durationMs: Date.now() - startTime,
            };
        } catch (error) {
            logger.error(LogCategory.AI, `Queue task execution failed: ${task.id}`, error as Error);

            // Mark process as failed if we have a processId
            if (task.processId) {
                this.processManager.failProcess(
                    task.processId,
                    error instanceof Error ? error.message : String(error)
                );
            }

            return {
                success: false,
                error: error instanceof Error ? error : new Error(String(error)),
                durationMs: Date.now() - startTime,
            };
        }
    }

    cancel(taskId: string): void {
        this.cancelledTasks.add(taskId);
    }

    private async executeFollowPrompt(
        task: QueuedTask,
        payload: FollowPromptPayload
    ): Promise<unknown> {
        const logger = getExtensionLogger();
        logger.info(LogCategory.AI, `Executing follow-prompt task: ${task.id}`);

        const sdkService = getCopilotSDKService();

        // Check if SDK is available
        const availability = await sdkService.isAvailable();
        if (!availability.available) {
            throw new Error(`Copilot SDK not available: ${availability.error}`);
        }

        const prompt = buildFollowPromptText(payload);

        // Execute via SDK
        const result = await sdkService.sendMessage({
            prompt,
            model: task.config.model,
            workingDirectory: payload.workingDirectory,
            timeoutMs: task.config.timeoutMs,
            usePool: false,
            onPermissionRequest: approveAllPermissions,
        });

        if (!result.success) {
            throw new Error(result.error || 'SDK execution failed');
        }

        // For tool-heavy sessions (e.g., impl skill), the AI may complete all
        // work via tool execution without producing a text summary. Provide a
        // fallback result so the AI Processes detail panel shows something useful.
        const responseText = result.response || '(Task completed via tool execution — no text response produced)';

        return {
            response: responseText,
            sessionId: result.sessionId,
        };
    }

    private async executeAIClarification(
        task: QueuedTask,
        payload: AIClarificationPayload
    ): Promise<unknown> {
        const logger = getExtensionLogger();
        logger.info(LogCategory.AI, `Executing AI clarification task: ${task.id}`);

        const sdkService = getCopilotSDKService();

        // Check if SDK is available
        const availability = await sdkService.isAvailable();
        if (!availability.available) {
            throw new Error(`Copilot SDK not available: ${availability.error}`);
        }

        // Build prompt from context if not pre-built
        let prompt = payload.prompt;
        if (!prompt && payload.selectedText) {
            prompt = this.buildClarificationPrompt(payload);
        }

        if (!prompt) {
            throw new Error('No prompt or context provided for AI clarification');
        }

        // Execute via SDK
        const result = await sdkService.sendMessage({
            prompt,
            model: payload.model || task.config.model,
            workingDirectory: payload.workingDirectory,
            timeoutMs: task.config.timeoutMs,
            usePool: false,
            onPermissionRequest: approveAllPermissions,
        });

        if (!result.success) {
            throw new Error(result.error || 'SDK execution failed');
        }

        return {
            response: result.response,
            sessionId: result.sessionId,
        };
    }

    /**
     * Build a clarification prompt from the payload context
     */
    private buildClarificationPrompt(payload: AIClarificationPayload): string {
        const parts: string[] = [];

        // Add prompt file content if available
        if (payload.promptFileContent) {
            const header = payload.skillName
                ? `--- Instructions from skill: ${payload.skillName} ---`
                : '--- Instructions from prompt file ---';
            parts.push(header);
            parts.push(payload.promptFileContent);
            parts.push('');
            parts.push('--- Document context ---');
        }

        // Add file context
        if (payload.filePath) {
            parts.push(`File: ${payload.filePath}`);
        }
        if (payload.nearestHeading) {
            parts.push(`Section: ${payload.nearestHeading}`);
        }
        if (payload.startLine !== undefined && payload.endLine !== undefined) {
            parts.push(`Lines: ${payload.startLine}-${payload.endLine}`);
        }
        parts.push('');

        // Add selected text
        parts.push('Selected text:');
        parts.push('```');
        parts.push(payload.selectedText || '');
        parts.push('```');
        parts.push('');

        // Add instruction
        if (payload.customInstruction) {
            parts.push(`Instruction: ${payload.customInstruction}`);
        } else if (!payload.promptFileContent) {
            const instructionMap: Record<string, string> = {
                'clarify': 'Please clarify and explain the selected text.',
                'go-deeper': 'Please provide a deep analysis of the selected text, including implications, edge cases, and related concepts.',
                'custom': 'Please help me understand the selected text.',
            };
            parts.push(instructionMap[payload.instructionType || 'clarify'] || instructionMap['clarify']);
        }

        // Add surrounding context
        if (payload.surroundingLines) {
            parts.push('');
            parts.push('Surrounding context:');
            parts.push('```');
            parts.push(payload.surroundingLines);
            parts.push('```');
        }

        return parts.join('\n');
    }
}

// ============================================================================
// AIQueueService
// ============================================================================

/**
 * VS Code service for managing the AI task queue
 */
export class AIQueueService implements vscode.Disposable {
    private readonly queueManager: TaskQueueManager;
    private readonly executor: QueueExecutor;
    private readonly processManager: AIProcessManager;
    private readonly disposables: vscode.Disposable[] = [];

    // VS Code events
    private readonly _onDidChangeQueue = new vscode.EventEmitter<QueueChangeEvent>();
    readonly onDidChangeQueue: vscode.Event<QueueChangeEvent> = this._onDidChangeQueue.event;

    private readonly _onDidChangeStats = new vscode.EventEmitter<QueueStats>();
    readonly onDidChangeStats: vscode.Event<QueueStats> = this._onDidChangeStats.event;

    constructor(processManager: AIProcessManager) {
        this.processManager = processManager;

        // Create queue manager
        this.queueManager = createTaskQueueManager({
            maxQueueSize: 0, // Unlimited
            keepHistory: true,
            maxHistorySize: 100,
        });

        // Create task executor
        const taskExecutor = new AITaskExecutor(processManager);

        // Create queue executor
        this.executor = createQueueExecutor(this.queueManager, taskExecutor, {
            maxConcurrency: this.getMaxConcurrency(),
            autoStart: this.isEnabled(),
        });

        // Set up event bridging
        this.setupEventBridging();

        // Listen for configuration changes
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration(CONFIG_SECTION)) {
                    this.onConfigurationChanged();
                }
            })
        );
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Check if queue feature is enabled
     */
    isEnabled(): boolean {
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        return config.get<boolean>(CONFIG_ENABLED, true);
    }

    /**
     * Get the default priority from settings
     */
    getDefaultPriority(): TaskPriority {
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        return config.get<TaskPriority>(CONFIG_DEFAULT_PRIORITY, 'normal');
    }

    /**
     * Get the max concurrency from settings
     */
    getMaxConcurrency(): number {
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        return config.get<number>(CONFIG_MAX_CONCURRENCY, 1);
    }

    /**
     * Check if notifications are enabled
     */
    shouldNotifyOnComplete(): boolean {
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        return config.get<boolean>(CONFIG_NOTIFY_ON_COMPLETE, true);
    }

    /**
     * Queue a task for execution
     */
    queueTask(options: QueueTaskOptions): QueueTaskResult {
        const priority = options.priority || this.getDefaultPriority();

        const taskId = this.queueManager.enqueue({
            type: options.type,
            priority,
            payload: options.payload,
            displayName: options.displayName,
            config: options.config || {
                timeoutMs: DEFAULT_AI_TIMEOUT_MS,
            },
        });

        const position = this.queueManager.getPosition(taskId);
        const stats = this.queueManager.getStats();

        return {
            taskId,
            position,
            totalQueued: stats.queued,
        };
    }

    /**
     * Queue multiple tasks at once (batch queueing)
     * Tasks are added in order and maintain their relative positions
     */
    queueBatch(tasks: QueueTaskOptions[]): BatchQueueResult {
        const results: QueueTaskResult[] = [];
        const taskIds: string[] = [];

        for (const options of tasks) {
            const result = this.queueTask(options);
            results.push(result);
            taskIds.push(result.taskId);
        }

        const stats = this.queueManager.getStats();

        return {
            taskIds,
            results,
            totalQueued: stats.queued,
            batchSize: tasks.length,
        };
    }

    /**
     * Cancel a queued or running task
     */
    cancelTask(taskId: string): boolean {
        this.executor.cancelTask(taskId);
        return true;
    }

    /**
     * Move a task to the top of the queue
     */
    moveToTop(taskId: string): boolean {
        return this.queueManager.moveToTop(taskId);
    }

    /**
     * Move a task up one position
     */
    moveUp(taskId: string): boolean {
        return this.queueManager.moveUp(taskId);
    }

    /**
     * Move a task down one position
     */
    moveDown(taskId: string): boolean {
        return this.queueManager.moveDown(taskId);
    }

    /**
     * Clear all queued tasks
     */
    clearQueue(): void {
        this.queueManager.clear();
    }

    /**
     * Pause queue processing
     */
    pause(): void {
        this.queueManager.pause();
    }

    /**
     * Resume queue processing
     */
    resume(): void {
        this.queueManager.resume();
    }

    /**
     * Check if queue is paused
     */
    isPaused(): boolean {
        return this.queueManager.isPaused();
    }

    /**
     * Get queue statistics
     */
    getStats(): QueueStats {
        return this.queueManager.getStats();
    }

    /**
     * Get all queued tasks
     */
    getQueuedTasks(): QueuedTask[] {
        return this.queueManager.getQueued();
    }

    /**
     * Get all running tasks
     */
    getRunningTasks(): QueuedTask[] {
        return this.queueManager.getRunning();
    }

    /**
     * Get task history
     */
    getHistory(): QueuedTask[] {
        return this.queueManager.getHistory();
    }

    /**
     * Get a specific task by ID
     */
    getTask(taskId: string): QueuedTask | undefined {
        return this.queueManager.getTask(taskId);
    }

    /**
     * Get the position of a task in the queue (1-based)
     */
    getPosition(taskId: string): number {
        return this.queueManager.getPosition(taskId);
    }

    // ========================================================================
    // Private Methods
    // ========================================================================

    private setupEventBridging(): void {
        // Bridge queue manager events to VS Code events
        this.queueManager.on('change', (event: QueueChangeEvent) => {
            this._onDidChangeQueue.fire(event);
            this._onDidChangeStats.fire(this.queueManager.getStats());
        });

        // Handle task completion notifications
        this.executor.on('taskCompleted', (task: QueuedTask) => {
            if (this.shouldNotifyOnComplete()) {
                vscode.window.showInformationMessage(
                    `Task completed: ${task.displayName || task.type}`
                );
            }
        });

        this.executor.on('taskFailed', (task: QueuedTask, error: Error) => {
            vscode.window.showErrorMessage(
                `Task failed: ${task.displayName || task.type} - ${error.message}`
            );
        });
    }

    private onConfigurationChanged(): void {
        const logger = getExtensionLogger();

        // Update concurrency
        const newConcurrency = this.getMaxConcurrency();
        this.executor.setMaxConcurrency(newConcurrency);
        logger.info(LogCategory.AI, `Queue concurrency updated to ${newConcurrency}`);

        // Handle enabled/disabled
        if (this.isEnabled() && !this.executor.isRunning()) {
            this.executor.start();
            logger.info(LogCategory.AI, 'Queue executor started');
        } else if (!this.isEnabled() && this.executor.isRunning()) {
            this.executor.stop();
            logger.info(LogCategory.AI, 'Queue executor stopped');
        }
    }

    // ========================================================================
    // Disposal
    // ========================================================================

    dispose(): void {
        this.executor.dispose();
        this._onDidChangeQueue.dispose();
        this._onDidChangeStats.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let queueServiceInstance: AIQueueService | undefined;

/**
 * Get the singleton AIQueueService instance
 */
export function getAIQueueService(): AIQueueService | undefined {
    return queueServiceInstance;
}

/**
 * Initialize the AIQueueService singleton
 */
export function initializeAIQueueService(processManager: AIProcessManager): AIQueueService {
    if (!queueServiceInstance) {
        queueServiceInstance = new AIQueueService(processManager);
    }
    return queueServiceInstance;
}

/**
 * Reset the AIQueueService singleton (for testing)
 */
export function resetAIQueueService(): void {
    if (queueServiceInstance) {
        queueServiceInstance.dispose();
        queueServiceInstance = undefined;
    }
}
