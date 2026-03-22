/**
 * Queue Executor Bridge
 *
 * Wires up a QueueExecutor with a CLITaskExecutor to actually execute
 * queued tasks in the coc serve server. Bridges executor events
 * to the ProcessStore and WebSocket for real-time UI updates.
 *
 * Task types supported:
 * - chat (mode=ask): Read-only AI conversation
 * - chat (mode=plan): AI proposes changes without applying them
 * - chat (mode=autopilot): Full read/write AI execution
 * - run-workflow: DAG pipeline execution
 * - run-script: Shell script execution
 *
 * Chat context presets enable specialized behavior:
 * - context.taskGeneration: Build task creation prompts
 * - context.replication: Git commit replication
 * - context.resolveComments: Server-side comment resolution
 * - context.files: File-path-based prompt assembly
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { RunWorkflowPayload, RunScriptPayload, ChatPayload, ChatMode } from './task-types';
import {
    isChatPayload,
    isChatFollowUp,
    isRunWorkflowPayload,
    isRunScriptPayload,
    hasTaskGenerationContext,
    hasResolveCommentsContext,
    hasReplicationContext,
} from './task-types';
import { saveImagesToTempFiles, cleanupTempDir, rehydrateImagesIfNeeded } from './executors/image-store';
import {
    extractPrompt,
    applySkillContent,
} from './executors/prompt-builder';
import { applyFollowUpToTask } from './shared/queue-utils';
import { emitMessageSteering } from './sse-handler';
import type { AIProcess, AgentMode, Attachment, AutoFolderContext, ConversationTurn, CopilotSDKService, ProcessStore, SelectedContext, SystemMessageConfig, Tool, ToolEvent } from '@plusplusoneplusplus/forge';
import {
    approveAllPermissions,
    applyDeepModePrefix,
    AUTO_FOLDER_SENTINEL,
    buildCreateFromFeaturePrompt,
    buildCreateTaskPrompt,
    buildCreateTaskPromptWithName,
    buildDeepModePrompt,
    buildPlanGenerationSystemPrompt,
    createQueueExecutor,
    DEFAULT_AI_TIMEOUT_MS,
    TASK_FILTER,
    FileToolCallCacheStore,
    gatherFeatureContext,
    getCopilotSDKService,
    getLogger,
    LogCategory,
    mergeConsecutiveContentItems,
    QueuedTask,
    QueueExecutor,
    resolveToolCallCacheOptions,
    TaskExecutionResult,
    TaskExecutor,
    TaskQueueManager,
    ToolCallCapture,
    DEFAULT_SKILLS_SETTINGS,
    modelMetadataStore,
} from '@plusplusoneplusplus/forge';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BaseExecutor } from './executors/base-executor';
import { resolveTaskRoot } from './task-root-resolver';
import { TaskStrategyRegistry } from './task-strategies';
import type { ExecutionContext } from './task-strategies';
import { ReplicateTemplateStrategy } from './task-strategies/replicate-template-strategy';
import { ShellExecutor } from './executors/shell-executor';
import { WorkflowExecutor } from './executors/workflow-executor';
import { FollowUpExecutor } from './executors/follow-up-executor';
import { ChatExecutor } from './executors/chat-executor';
import { PlanExecutor } from './executors/plan-executor';
import { AutopilotExecutor } from './executors/autopilot-executor';

// ============================================================================
// Constants
// ============================================================================

/** Statuses that represent a terminal (non-overwritable) process state. */
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

/** Map CoC ChatMode to SDK AgentMode for protocol-level enforcement. */
const CHAT_MODE_TO_AGENT_MODE: Record<ChatMode, AgentMode> = {
    ask: 'interactive',
    plan: 'plan',
    autopilot: 'autopilot',
};

function toAgentMode(chatMode: ChatMode | undefined): AgentMode | undefined {
    return chatMode ? CHAT_MODE_TO_AGENT_MODE[chatMode] : undefined;
}

// ============================================================================
// Types
// ============================================================================

export interface CLITaskExecutorOptions {
    /** Whether to auto-approve AI permission requests (default: true) */
    approvePermissions?: boolean;
    /** Working directory for AI sessions */
    workingDirectory?: string;
    /** Directory for persisted data (output files, etc.). Default: ~/.coc */
    dataDir?: string;
    /** Optional AI service injection (for testing). If not provided, uses getCopilotSDKService(). */
    aiService?: CopilotSDKService;
    /** Default timeout in ms for tasks that don't specify their own timeoutMs */
    defaultTimeoutMs?: number;
    /** Follow-up suggestions configuration */
    followUpSuggestions?: { enabled: boolean; count: number };
    /** Lazy getter for the WebSocket server — used to broadcast comment-resolved events. */
    getWsServer?: () => import('./websocket').ProcessWebSocketServer | undefined;
}

export interface QueueExecutorBridgeOptions extends CLITaskExecutorOptions {
    /** Maximum concurrent task executions (default: 1). Deprecated: use sharedConcurrency/exclusiveConcurrency. */
    maxConcurrency?: number;
    /** Concurrency limit for shared (read-only) tasks (default: 5) */
    sharedConcurrency?: number;
    /** Concurrency limit for exclusive (write) tasks (default: 1) */
    exclusiveConcurrency?: number;
    /** Policy callback to classify a task as exclusive. Default: defaultIsExclusive */
    isExclusive?: (task: QueuedTask) => boolean;
    /** Whether to auto-start processing (default: true) */
    autoStart?: boolean;
}

/**
 * Exposes follow-up execution for the API layer.
 * Implemented by CLITaskExecutor, surfaced via the bridge factory.
 */
export interface QueueExecutorBridge {
    executeFollowUp(processId: string, message: string, attachments?: Attachment[], mode?: string, deliveryMode?: string): Promise<void>;
    /** Check whether the underlying SDK session for a process is still alive. */
    isSessionAlive(processId: string): Promise<boolean>;
    /** Requeue an existing completed task for a follow-up message. */
    requeueForFollowUp?(taskId: string, prompt: string, attachments?: Attachment[], imageTempDir?: string, mode?: string, deliveryMode?: string): Promise<void>;
    /** Cancel a running process by aborting its live AI session. */
    cancelProcess?(processId: string): Promise<void>;
}

// ============================================================================
// CLI Task Executor
// ============================================================================

/**
 * Task executor that uses CopilotSDKService to execute queued tasks.
 * Creates AIProcess entries in the ProcessStore for tracking.
 *
 * Extends BaseExecutor which owns streaming/cancellation plumbing.
 */
export class CLITaskExecutor extends BaseExecutor implements TaskExecutor {
    private readonly approvePermissions: boolean;
    private readonly defaultWorkingDirectory?: string;
    /** AI service instance (injected or default from getCopilotSDKService()) */
    private readonly aiService: CopilotSDKService;
    /** Default timeout in ms for tasks without explicit timeoutMs */
    private readonly defaultTimeoutMs: number;

    /** Follow-up suggestions configuration */
    private readonly followUpSuggestions: { enabled: boolean; count: number };
    /** Lazy getter for the WebSocket server to broadcast file events */
    private readonly getWsServer?: () => import('./websocket').ProcessWebSocketServer | undefined;
    /** Optional queue manager for requeueing existing chat tasks during follow-ups */
    private queueManager?: TaskQueueManager;
    /** Shared store for tool-call Q&A capture (explore cache). */
    private readonly toolCallCacheStore: FileToolCallCacheStore;
    /** Registry of task strategies for dispatch by type key. */
    private readonly registry: TaskStrategyRegistry;
    /** Executor for DAG workflow tasks. */
    private readonly workflowExecutor: WorkflowExecutor;
    /** Executor for follow-up message dispatching. */
    private readonly followUpExecutor: FollowUpExecutor;
    /** Executor for ask-mode chat tasks. */
    private readonly chatExecutor: ChatExecutor;
    /** Executor for plan-mode chat tasks. */
    private readonly planExecutor: PlanExecutor;
    /** Executor for autopilot-mode chat tasks. */
    private readonly autopilotExecutor: AutopilotExecutor;

    constructor(store: ProcessStore, options: CLITaskExecutorOptions = {}) {
        super(store, options.dataDir);
        this.approvePermissions = options.approvePermissions !== false;
        this.defaultWorkingDirectory = options.workingDirectory;
        this.aiService = options.aiService ?? getCopilotSDKService();
        this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
        this.followUpSuggestions = options.followUpSuggestions ?? { enabled: true, count: 3 };
        this.getWsServer = options.getWsServer;
        this.toolCallCacheStore = new FileToolCallCacheStore(
            resolveToolCallCacheOptions(
                options.workingDirectory,
                this.dataDir ? path.join(this.dataDir, 'memory') : undefined,
            ),
        );
        this.registry = new TaskStrategyRegistry();
        this.registry.register('replicate-template', new ReplicateTemplateStrategy());
        this.workflowExecutor = new WorkflowExecutor(store, {
            approvePermissions: this.approvePermissions,
            workingDirectory: this.defaultWorkingDirectory,
        }, this.dataDir);
        this.followUpExecutor = new FollowUpExecutor(store, {
            workingDirectory: this.defaultWorkingDirectory,
            approvePermissions: this.approvePermissions,
            aiService: this.aiService,
            followUpSuggestions: this.followUpSuggestions,
            resolveWorkspaceIdForPath: (rootPath) => this.resolveWorkspaceIdForPath(rootPath),
            resolveSkillConfig: (wsId, workDir) => this.resolveSkillConfig(wsId, workDir),
            onTitleNeeded: (processId, turns) => this.generateTitleIfNeeded(processId, turns),
        }, this.dataDir);
        const chatModeOptions = {
            workingDirectory: this.defaultWorkingDirectory,
            approvePermissions: this.approvePermissions,
            aiService: this.aiService,
            defaultTimeoutMs: this.defaultTimeoutMs,
            followUpSuggestions: this.followUpSuggestions,
            toolCallCacheStore: this.toolCallCacheStore,
            resolveSkillConfig: (wsId: string | undefined, workDir?: string) => this.resolveSkillConfig(wsId, workDir),
            resolveWorkspaceIdForPath: (rootPath: string) => this.resolveWorkspaceIdForPath(rootPath),
        };
        this.chatExecutor = new ChatExecutor(store, chatModeOptions, this.dataDir);
        this.planExecutor = new PlanExecutor(store, chatModeOptions, this.dataDir);
        this.autopilotExecutor = new AutopilotExecutor(store, chatModeOptions, this.dataDir);
    }

    /** Inject the queue manager (called by createQueueExecutorBridge after construction). */
    setQueueManager(qm: TaskQueueManager): void {
        this.queueManager = qm;
    }

    /** Resolve a workspace ID for a given root path by matching against registered workspaces. */
    private async resolveWorkspaceIdForPath(rootPath: string): Promise<string> {
        const workspaces = await this.store.getWorkspaces();
        const normalized = path.resolve(rootPath);
        const ws = workspaces.find(w => path.resolve(w.rootPath) === normalized);
        return ws?.id ?? rootPath;
    }

    async requeueForFollowUp(taskId: string, prompt: string, attachments?: Attachment[], imageTempDir?: string, mode?: string, deliveryMode?: string): Promise<void> {
        if (!this.queueManager) {
            throw new Error('Queue manager is not available');
        }
        const task = this.queueManager.getTask(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }
        applyFollowUpToTask(this.queueManager, taskId, prompt, attachments, imageTempDir, mode, deliveryMode);
    }

    async execute(task: QueuedTask): Promise<TaskExecutionResult> {
        const logger = getLogger();
        const startTime = Date.now();

        logger.debug(LogCategory.AI, `[QueueExecutor] Starting task ${task.id} (type: ${task.type}, name: ${task.displayName || 'unnamed'})`);

        // Check if cancelled before starting
        if (this.cancelledTasks.has(task.id)) {
            logger.debug(LogCategory.AI, `[QueueExecutor] Task ${task.id} was cancelled before starting`);
            // For follow-ups, revert the original process from 'running' back to 'completed'
            // since api-handler.ts set it to 'running' before enqueueing
            if (isChatFollowUp(task.payload)) {
                const payload = task.payload as unknown as ChatPayload;
                task.processId = payload.processId;
                const imageTempDir = payload.imageTempDir;
                try {
                    await this.store.updateProcess(payload.processId!, { status: 'completed' });
                } catch {
                    // Non-fatal: process may already be cleaned up
                }
                if (imageTempDir) {
                    cleanupTempDir(imageTempDir);
                }
            }
            return { success: false, error: new Error('Task cancelled'), durationMs: 0 };
        }

        // Reuse the existing chat task and process for follow-ups.
        if (isChatFollowUp(task.payload)) {
            const followUpPayload = task.payload as unknown as ChatPayload;
            task.processId = followUpPayload.processId;
            const imageTempDir = followUpPayload.imageTempDir;

            // Rehydrate externalized images if needed
            const rawPayload = task.payload as any;
            await rehydrateImagesIfNeeded(rawPayload);

            try {
                await this.executeFollowUp(followUpPayload.processId!, followUpPayload.prompt, followUpPayload.attachments, followUpPayload.mode, (followUpPayload as any).deliveryMode);
                const duration = Date.now() - startTime;
                logger.debug(LogCategory.AI, `[QueueExecutor] Follow-up task ${task.id} completed in ${duration}ms`);

                return { success: true, durationMs: duration };
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                const duration = Date.now() - startTime;
                logger.debug(LogCategory.AI, `[QueueExecutor] Follow-up task ${task.id} failed in ${duration}ms: ${errorMsg}`);

                return { success: false, error: error instanceof Error ? error : new Error(errorMsg), durationMs: duration };
            } finally {
                if (imageTempDir) {
                    cleanupTempDir(imageTempDir);
                }
            }
        }

        // Create a process in the store for tracking
        // Format: <type>_<uuid> e.g. queue_1771242852770-g94u3ig
        const processId = `queue_${task.id}`;
        const prompt = applySkillContent(extractPrompt(task), task);
        const workingDirectory = this.getWorkingDirectory(task);
        const seededTokenLimit = task.config.model !== undefined
            ? modelMetadataStore.getContextWindow(task.config.model)
            : undefined;
        const process: AIProcess = {
            id: processId,
            type: task.type,
            promptPreview: prompt.length > 80 ? prompt.substring(0, 77) + '...' : prompt,
            fullPrompt: prompt,
            status: 'running',
            startTime: new Date(),
            workingDirectory,
            tokenLimit: seededTokenLimit,
            metadata: {
                type: task.type,
                queueTaskId: task.id,
                priority: task.priority,
                model: task.config.model,
                mode: (task.payload as any)?.mode,
                workspaceId: (task.payload as any)?.workspaceId,
                workflowName: isRunWorkflowPayload(task.payload)
                    ? path.basename(task.payload.workflowPath)
                    : undefined,
            },
        };

        // Rehydrate externalized images from blob store before building conversation turn
        const payload = task.payload as any;
        await rehydrateImagesIfNeeded(payload);

        // Store initial user turn immediately so it survives page refresh
        const payloadImages = Array.isArray(payload?.images)
            ? payload.images.filter((img: unknown) => typeof img === 'string')
            : undefined;
        const initialTurns: ConversationTurn[] = [
            {
                role: 'user',
                content: prompt,
                timestamp: process.startTime,
                turnIndex: 0,
                timeline: [],
                images: payloadImages?.length > 0 ? payloadImages : undefined,
            },
        ];
        process.conversationTurns = initialTurns;

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

            // Extract session and response data for conversation tracking
            const sessionId = (result as any)?.sessionId;
            const responseText = (result as any)?.response ?? '';

            // Clean up throttle state
            // (cleanupSession in finally handles the actual deletion)

            // Drain accumulated timeline items for the final assistant turn.
            // New mode executors (chat/plan/autopilot) return timeline in the result;
            // executeWithAI (task generation, resolve comments) keeps it in bridge sessions.
            const finalTimeline = (result as any)?.timeline
                ?? mergeConsecutiveContentItems(this.sessions.get(processId)?.timelineBuffer || []);

            // Build final conversation turns (re-read from store to include any flushed streaming data)
            const currentProcess = await this.store.getProcess(processId, (task.payload as any)?.workspaceId as string | undefined);
            const existingTurns = currentProcess?.conversationTurns || initialTurns;

            // Replace or append the assistant turn with the final complete response
            const finalTurns: ConversationTurn[] = [
                existingTurns[0], // user turn
                {
                    role: 'assistant',
                    content: responseText,
                    timestamp: new Date(),
                    turnIndex: 1,
                    toolCalls: (result as any)?.toolCalls || undefined,
                    timeline: finalTimeline,
                    suggestions: (result as any)?.pendingSuggestions ?? this.sessions.get(processId)?.pendingSuggestions,
                },
            ];

            // Cold resume: prepend historical turns from the original session
            const resumedFrom = (task.payload as any)?.resumedFrom;
            let combinedTurns = finalTurns;
            if (resumedFrom && typeof resumedFrom === 'string') {
                try {
                    const oldProcess = await this.store.getProcess(resumedFrom, (task.payload as any)?.workspaceId as string | undefined);
                    if (oldProcess?.conversationTurns?.length) {
                        const historicalTurns: ConversationTurn[] = oldProcess.conversationTurns.map((t, i) => ({
                            ...t,
                            historical: true,
                            turnIndex: i,
                        }));
                        // Re-index the new turns after historical ones
                        const offset = historicalTurns.length;
                        combinedTurns = [
                            ...historicalTurns,
                            ...finalTurns.map((t, i) => ({ ...t, turnIndex: offset + i })),
                        ];
                    }
                } catch {
                    // Non-fatal: old process may be gone
                }
            }

            // Update process as completed — now includes session + conversation data
            try {
                const currentProc = await this.store.getProcess(processId, (task.payload as any)?.workspaceId as string | undefined);
                if (!TERMINAL_STATUSES.has(currentProc?.status ?? '')) {
                    await this.store.updateProcess(processId, {
                        status: 'completed',
                        endTime: new Date(),
                        result: typeof result === 'string' ? result : JSON.stringify(result),
                        ...(sessionId ? { sdkSessionId: sessionId } : {}),
                        conversationTurns: combinedTurns,
                    });
                    this.store.emitProcessComplete(processId, 'completed', `${duration}ms`);
                }
            } catch {
                // Non-fatal
            }

            // Generate a human-readable title (fire-and-forget, non-blocking)
            this.generateTitleIfNeeded(processId, combinedTurns);

            return {
                success: true,
                result,
                durationMs: Date.now() - startTime,
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const duration = Date.now() - startTime;
            logger.debug(LogCategory.AI, `[QueueExecutor] Task ${task.id} failed in ${duration}ms: ${errorMsg}`);

            try {
                const currentProcess = await this.store.getProcess(processId, (task.payload as any)?.workspaceId as string | undefined);
                const existingTurns = currentProcess?.conversationTurns || initialTurns;
                if (!TERMINAL_STATUSES.has(currentProcess?.status ?? '')) {
                    await this.store.updateProcess(processId, {
                        status: 'failed',
                        endTime: new Date(),
                        error: errorMsg,
                        conversationTurns: existingTurns,
                    });
                    this.store.emitProcessComplete(processId, 'failed', `${duration}ms`);
                }
            } catch {
                // Non-fatal
            }

            return {
                success: false,
                error: error instanceof Error ? error : new Error(errorMsg),
                durationMs: Date.now() - startTime,
            };
        } finally {
            // Persist accumulated conversation output to disk (both success and failure)
            const buffer = this.sessions.get(processId)?.outputBuffer ?? '';
            this.cleanupSession(processId);
            this.store.unregisterFlushHandler?.(processId);
            await this.persistOutput(processId, buffer);
        }
    }

    cancel(taskId: string): void {
        this.cancelledTasks.add(taskId);
    }

    /**
     * Cancel a running process by aborting its live AI session.
     * Also marks the task as cancelled to prevent future execution.
     */
    async cancelProcess(processId: string): Promise<void> {
        const taskId = processId.replace('queue_', '');
        this.cancelledTasks.add(taskId);
        try {
            const proc = await this.store.getProcess(processId);
            if (proc?.sdkSessionId) {
                await this.aiService.abortSession(proc.sdkSessionId);
            }
        } catch {
            // Non-fatal: session may already be gone
        }
    }

    /**
     * Check whether the SDK session for a process is still alive.
     */
    async isSessionAlive(_processId: string): Promise<boolean> {
        // With keepalive removed, follow-ups always create fresh sessions.
        // Session liveness is no longer a constraint — return true so the
        // API layer never blocks follow-up messages.
        return true;
    }

    /**
     * Generate a human-readable title for a process from its first user message.
     * Fire-and-forget: failures are logged as warnings but never block execution.
     * Idempotent: skips if the process already has a title.
     */
    private generateTitleIfNeeded(processId: string, turns: ConversationTurn[]): void {
        const logger = getLogger();
        const firstUserContent = turns.find(t => t.role === 'user')?.content ?? '';
        if (!firstUserContent) return;

        // Use void to explicitly fire-and-forget
        void (async () => {
            try {
                const existing = await this.store.getProcess(processId);
                if (existing?.title) {
                    // Re-sync the persisted AI title back to the task's displayName.
                    // requeueForFollowUp (and the api-handler fallback path) both overwrite
                    // displayName with the follow-up message text, so we restore it here
                    // on every turn to keep the two in sync.
                    if (processId.startsWith('queue_') && this.queueManager) {
                        const taskId = processId.replace('queue_', '');
                        this.queueManager.updateTask(taskId, { displayName: existing.title });
                    }
                    return;
                }

                const truncated = firstUserContent.substring(0, 400);
                const title: string = await (this.aiService as any).transform(
                    `Summarise the following user message as a short title (max 8 words, no punctuation):\n\n"${truncated}"`,
                    (raw: string) => raw.trim().replace(/[".]/g, ''),
                    { model: 'gpt-4.1', cwd: this.defaultWorkingDirectory },
                );
                if (title) {
                    await this.store.updateProcess(processId, { title });
                    if (processId.startsWith('queue_') && this.queueManager) {
                        const taskId = processId.replace('queue_', '');
                        this.queueManager.updateTask(taskId, { displayName: title });
                    }
                }
            } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                logger.warn(LogCategory.AI, `Title generation failed for ${processId}: ${errMsg}`);
            }
        })();
    }

    /**
     * Execute a follow-up message on an existing process's SDK session.
     * Delegates to FollowUpExecutor which owns the full follow-up lifecycle.
     */
    async executeFollowUp(processId: string, message: string, attachments?: Attachment[], mode?: ChatMode, deliveryMode?: string): Promise<void> {
        return this.followUpExecutor.executeFollowUp(processId, message, attachments, mode, deliveryMode);
    }

    // ========================================================================
    // Private — Execution by Type
    // ========================================================================

    /** Build an ExecutionContext for the given task. */
    private buildExecutionContext(task: QueuedTask): ExecutionContext {
        return {
            processId: `queue_${task.id}`,
            store: this.store,
            approvePermissions: this.approvePermissions,
            workingDirectory: this.getWorkingDirectory(task),
        };
    }

    private async executeByType(task: QueuedTask, prompt: string): Promise<unknown> {
        // Run workflow: parse YAML and execute via WorkflowExecutor
        if (isRunWorkflowPayload(task.payload)) {
            return this.workflowExecutor.execute(task);
        }

        // Run script: spawn child process via ShellExecutor
        if (isRunScriptPayload(task.payload)) {
            return new ShellExecutor(this.store, this.dataDir, this.defaultWorkingDirectory).execute(task);
        }

        // All chat tasks (ask/plan/autopilot with optional context presets)
        if (isChatPayload(task.payload) && !isChatFollowUp(task.payload)) {
            const payload = task.payload as unknown as ChatPayload;

            // Task generation: build enriched prompt and delegate to AI
            if (hasTaskGenerationContext(task.payload)) {
                return this.executeTaskGeneration(task);
            }

            // Replicate template: run commit replication via registry
            if (hasReplicationContext(task.payload)) {
                return this.registry.get('replicate-template')!.execute(task, this.buildExecutionContext(task));
            }

            // Resolve comments: build prompt with resolve-comment tool
            if (hasResolveCommentsContext(task.payload) || payload.tools?.includes('resolve-comments')) {
                return this.executeResolveComments(task);
            }

            // Standard chat: dispatch to mode-specific executor
            const mode = payload.mode;
            if (mode === 'plan') return this.planExecutor.execute(task, prompt);
            if (mode === 'autopilot') return this.autopilotExecutor.execute(task, prompt);
            // Default: ask mode (also covers undefined/unknown modes)
            return this.chatExecutor.execute(task, prompt);
        }

        // Fallback: no-op
        return { status: 'completed', message: `Task type '${task.type}' executed (no-op in CLI mode)` };
    }

    private async executeWithAI(task: QueuedTask, prompt: string, options?: { tools?: Tool<any>[]; systemMessage?: SystemMessageConfig }): Promise<unknown> {
        const processId = `queue_${task.id}`;

        // Initialize output accumulator for this process
        this.getOrCreateSession(processId).outputBuffer = '';
        this.store.registerFlushHandler?.(processId, () => this.flushConversationTurn(processId, true));

        // Rehydrate externalized images from blob store if needed
        const payload = task.payload as any;
        await rehydrateImagesIfNeeded(payload);

        // Decode optional base64 images from payload
        let attachments: Attachment[] | undefined;
        let imageTempDir: string | undefined;
        const payloadImages = (task.payload as any)?.images;
        if (Array.isArray(payloadImages) && payloadImages.length > 0) {
            const validImages = payloadImages.filter((img: unknown) => typeof img === 'string').slice(0, 10);
            if (validImages.length > 0) {
                const result = saveImagesToTempFiles(validImages);
                imageTempDir = result.tempDir;
                attachments = result.attachments.length > 0 ? result.attachments : undefined;
            }
        }

        try {
            const availability = await this.aiService.isAvailable();
            if (!availability.available) {
                throw new Error(`Copilot SDK not available: ${availability.error || 'unknown reason'}`);
            }

            const workingDirectory = this.getWorkingDirectory(task);
            const timeoutMs = task.config.timeoutMs || this.defaultTimeoutMs;

            // Resolve per-workspace skill configuration
            const taskWorkspaceId = (task.payload as any)?.workspaceId as string | undefined;
            const { skillDirectories, disabledSkills } = await this.resolveSkillConfig(taskWorkspaceId, workingDirectory);

            // Capture read-only tool calls for the memory cache.
            // Create capture handler defensively — errors must not break task execution.
            let captureHandler: ((event: ToolEvent) => void) | undefined;
            try {
                const capture = new ToolCallCapture(this.toolCallCacheStore, TASK_FILTER);
                captureHandler = capture.createToolEventHandler();
            } catch (err) {
                getLogger().warn(LogCategory.AI, `[QueueExecutor] ToolCallCapture setup failed: ${err}`);
            }

            const existingToolEventHandler = this.buildToolEventHandler(processId, () => 1);

            const chatMode = isChatPayload(task.payload) ? (task.payload as unknown as ChatPayload).mode : undefined;
            const agentMode = toAgentMode(chatMode as ChatMode | undefined);

            const result = await this.aiService.sendMessage({
                prompt,
                mode: agentMode,
                model: task.config.model,
                reasoningEffort: task.config.reasoningEffort ?? 'high',
                workingDirectory,
                timeoutMs,
                attachments,
                tools: options?.tools,
                systemMessage: options?.systemMessage,
                skillDirectories,
                disabledSkills,
                onPermissionRequest: this.approvePermissions ? approveAllPermissions : undefined,
                onSessionCreated: (sessionId: string) => {
                    this.store.updateProcess(processId, { sdkSessionId: sessionId }).catch(() => {
                        // Non-fatal: store may be a stub
                    });
                },
                // Stream response chunks to the process store for real-time UI updates
                onStreamingChunk: (chunk: string) => {
                    // Accumulate output for disk persistence
                    this.getOrCreateSession(processId).outputBuffer += chunk;
                    // Append content timeline item
                    this.appendTimelineItem(processId, { type: 'content', timestamp: new Date(), content: chunk });
                    try {
                        this.store.emitProcessOutput(processId, chunk);
                    } catch {
                        // Non-fatal: store may be a stub
                    }
                    // Check throttle conditions and flush if necessary
                    this.checkThrottleAndFlush(processId);
                },
                // Emit tool lifecycle events for real-time tool card rendering in the SPA
                onToolEvent: captureHandler
                    ? (event: ToolEvent) => {
                        try { existingToolEventHandler(event); } catch { /* non-fatal */ }
                        try { captureHandler!(event); } catch { /* non-fatal */ }
                    }
                    : existingToolEventHandler,
            });
            // TODO(004): trigger ToolCallCacheAggregator.aggregateIfNeeded() after sendMessage

            if (!result.success) {
                throw new Error(result.error || 'AI execution failed');
            }

            return {
                response: result.response || '(Task completed via tool execution — no text response produced)',
                sessionId: result.sessionId,
                toolCalls: result.toolCalls,
            };
        } finally {
            if (imageTempDir) { cleanupTempDir(imageTempDir); }
        }
    }

    private async executeTaskGeneration(task: QueuedTask): Promise<unknown> {
        const payload = task.payload as unknown as ChatPayload;
        const tg = payload.context!.taskGeneration!;
        const workingDirectory = payload.workingDirectory || this.defaultWorkingDirectory || '';

        const effectiveDataDir = this.dataDir ?? path.join(os.homedir(), '.coc');
        const wsId = payload.workspaceId || await this.resolveWorkspaceIdForPath(workingDirectory);
        const tasksBase = resolveTaskRoot({ dataDir: effectiveDataDir, rootPath: workingDirectory, workspaceId: wsId }).absolutePath;
        const isAutoFolder = tg.targetFolder === AUTO_FOLDER_SENTINEL;
        const resolvedTarget = (isAutoFolder || !tg.targetFolder)
            ? tasksBase
            : path.resolve(tasksBase, tg.targetFolder);
        fs.mkdirSync(resolvedTarget, { recursive: true });

        // Build autoFolderContext when auto-folder mode is requested
        let autoFolderContext: AutoFolderContext | undefined;
        if (isAutoFolder) {
            const entries = await fs.promises.readdir(tasksBase, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
            const subfolders = entries.filter(e => e.isDirectory()).map(e => e.name);
            const deepFolders: string[] = [];
            for (const sub of subfolders) {
                const nested = await fs.promises.readdir(path.join(tasksBase, sub), { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
                for (const n of nested) {
                    if (n.isDirectory()) deepFolders.push(`${sub}/${n.name}`);
                }
            }
            autoFolderContext = { tasksRoot: tasksBase, existingFolders: [...subfolders, ...deepFolders] };
        }

        let aiPrompt: string;
        if (tg.mode === 'from-feature') {
            const context = await gatherFeatureContext(resolvedTarget, workingDirectory);
            const selectedContext: SelectedContext = {
                description: context.description,
                planContent: context.planContent,
                specContent: context.specContent,
                relatedFiles: context.relatedFiles,
            };
            aiPrompt = tg.depth === 'deep'
                ? buildDeepModePrompt(selectedContext, payload.prompt, tg.name, resolvedTarget, workingDirectory)
                : buildCreateFromFeaturePrompt(selectedContext, payload.prompt, tg.name, resolvedTarget);
        } else if (tg.name?.trim()) {
            aiPrompt = buildCreateTaskPromptWithName(tg.name, payload.prompt, resolvedTarget, autoFolderContext);
        } else if (isAutoFolder) {
            aiPrompt = buildCreateTaskPromptWithName(undefined, payload.prompt, resolvedTarget, autoFolderContext);
        } else {
            aiPrompt = buildCreateTaskPrompt(payload.prompt, resolvedTarget);
        }

        // Apply go-deep prefix when depth is 'deep', regardless of mode
        if (tg.depth === 'deep') {
            aiPrompt = applyDeepModePrefix(aiPrompt);
        }

        // Build system prompt for plan generation
        const systemPrompt = buildPlanGenerationSystemPrompt({
            targetPath: resolvedTarget,
            autoFolder: isAutoFolder,
            tasksRoot: isAutoFolder ? tasksBase : undefined,
            existingFolders: autoFolderContext?.existingFolders,
        });

        // Update process store with the actual enriched prompt (replaces raw user text)
        const processId = `queue_${task.id}`;
        const enrichedPreview = aiPrompt.length > 80 ? aiPrompt.substring(0, 77) + '...' : aiPrompt;
        try {
            await this.store.updateProcess(processId, {
                fullPrompt: aiPrompt,
                promptPreview: enrichedPreview,
            });
            const existing = await this.store.getProcess(processId, (task.payload as any)?.workspaceId as string | undefined);
            if (existing?.conversationTurns?.[0]) {
                existing.conversationTurns[0].content = aiPrompt;
                await this.store.updateProcess(processId, {
                    conversationTurns: existing.conversationTurns,
                });
            }
        } catch {
            // Non-fatal: store may be a stub
        }

        return this.executeWithAI(task, aiPrompt, {
            systemMessage: { mode: 'append', content: systemPrompt },
        });
    }

    private async executeResolveComments(task: QueuedTask): Promise<unknown> {
        const payload = task.payload as unknown as ChatPayload;
        const rc = payload.context?.resolveComments;
        const aiPrompt = payload.prompt;

        // Update process store with the enriched prompt
        const processId = `queue_${task.id}`;
        const commentCount = rc ? rc.commentIds.length : 0;
        const targetFile = rc?.filePath || rc?.documentUri || 'document';
        const preview = `Resolve ${commentCount} comment(s) in ${targetFile}`;
        try {
            await this.store.updateProcess(processId, {
                fullPrompt: aiPrompt,
                promptPreview: preview,
            });
        } catch {
            // Non-fatal: store may be a stub
        }

        const { createResolveCommentTool } = await import('./resolve-comment-tool');
        const { tool, getResolvedIds } = createResolveCommentTool();

        const aiResult = await this.executeWithAI(task, aiPrompt, { tools: [tool] }) as { response: string } | undefined;
        const revisedContent = (aiResult as any)?.response as string | undefined;

        // Only return comment IDs that AI explicitly resolved via the tool.
        // Fall back to all IDs if the tool wasn't called (backward compat).
        const resolvedIds = getResolvedIds();
        const commentIds = resolvedIds.length > 0 ? resolvedIds : (rc?.commentIds ?? []);

        // Server-side resolution: persist comment status and broadcast WS events
        if (this.dataDir && rc?.wsId && commentIds.length > 0) {
            try {
                const { TaskCommentsManager } = await import('./task-comments-handler');
                const mgr = new TaskCommentsManager(this.dataDir);
                const wsServer = this.getWsServer?.();
                await Promise.all(
                    commentIds.map(async (id) => {
                        try {
                            await mgr.updateComment(rc.wsId!, rc.filePath, id, { status: 'resolved' });
                            if (wsServer) {
                                wsServer.broadcastFileEvent(rc.filePath, {
                                    type: 'comment-resolved',
                                    filePath: rc.filePath,
                                    commentId: id,
                                });
                            }
                        } catch {
                            // Non-fatal: best-effort resolution
                        }
                    })
                );
            } catch {
                // Non-fatal: server-side resolution is best-effort
            }
        }

        return {
            revisedContent,
            commentIds,
        };
    }

    private getWorkingDirectory(task: QueuedTask): string | undefined {
        if (isRunWorkflowPayload(task.payload)) {
            return task.payload.workingDirectory || this.defaultWorkingDirectory;
        }
        if (isRunScriptPayload(task.payload)) {
            return task.payload.workingDirectory || this.defaultWorkingDirectory;
        }
        if (isChatPayload(task.payload)) {
            return task.payload.workingDirectory || task.payload.folderPath || this.defaultWorkingDirectory;
        }
        return this.defaultWorkingDirectory;
    }

    /**
     * Resolve per-workspace skill configuration for the SDK session.
     * Returns `skillDirectories` (repo-local + global + extra paths)
     * and `disabledSkills` from the workspace config + global preferences.
     */
    private async resolveSkillConfig(
        workspaceId: string | undefined,
        workingDirectory?: string,
    ): Promise<{ skillDirectories?: string[]; disabledSkills?: string[] }> {
        let disabledSkills: string[] | undefined;
        let extraSkillFolders: string[] | undefined;

        // Resolve workspace config (disabled skills + extra folders)
        if (workspaceId) {
            try {
                const workspaces = await this.store.getWorkspaces();
                const ws = workspaces.find(w => w.id === workspaceId);
                if (ws?.disabledSkills && ws.disabledSkills.length > 0) {
                    disabledSkills = [...ws.disabledSkills];
                }
                if (ws?.extraSkillFolders && ws.extraSkillFolders.length > 0) {
                    extraSkillFolders = [...ws.extraSkillFolders];
                }
            } catch {
                // Non-fatal: continue without workspace config
            }
        }

        // Merge global disabled skills from preferences
        if (this.dataDir) {
            try {
                const prefsPath = path.join(this.dataDir, 'preferences.json');
                const prefsExists = await fs.promises.access(prefsPath).then(() => true).catch(() => false);
                if (prefsExists) {
                    const prefs = JSON.parse(await fs.promises.readFile(prefsPath, 'utf-8'));
                    const globalDisabled: string[] = prefs?.globalDisabledSkills;
                    if (Array.isArray(globalDisabled) && globalDisabled.length > 0) {
                        disabledSkills = [...new Set([...(disabledSkills ?? []), ...globalDisabled])];
                    }
                }
            } catch {
                // Non-fatal
            }
        }

        // Resolve skill directories: repo-local first, then global, then extra
        const dirs: string[] = [];

        // 1. Repo-local skills (workspace-specific, highest priority)
        const root = workingDirectory;
        if (root) {
            const skillsDir = path.join(root, DEFAULT_SKILLS_SETTINGS.installPath);
            try {
                if (await fs.promises.access(skillsDir).then(() => true).catch(() => false)) {
                    dirs.push(skillsDir);
                }
            } catch {
                // Non-fatal: skip if path is inaccessible
            }
        }

        // 2. Global skills (~/.coc/skills)
        if (this.dataDir) {
            const globalSkillsDir = path.join(this.dataDir, 'skills');
            try {
                if (await fs.promises.access(globalSkillsDir).then(() => true).catch(() => false)) {
                    dirs.push(globalSkillsDir);
                }
            } catch {
                // Non-fatal
            }
        }

        // 3. Extra skill folders from workspace config (in declared order)
        if (extraSkillFolders) {
            for (const folder of extraSkillFolders) {
                const resolved = path.isAbsolute(folder)
                    ? folder
                    : (root ? path.resolve(root, folder) : null);
                if (resolved) {
                    try {
                        if (await fs.promises.access(resolved).then(() => true).catch(() => false)) {
                            dirs.push(resolved);
                        }
                    } catch {
                        // Non-fatal
                    }
                }
            }
        }

        const skillDirectories = dirs.length > 0 ? dirs : undefined;

        return { skillDirectories, disabledSkills };
    }
}

// ============================================================================
// Default Task Classification Policy
// ============================================================================

/**
 * Default concurrency policy based on the unified task/mode model.
 *
 * - `run-workflow` and `run-script` are always exclusive (serialised).
 * - Chat tasks: `ask` and `plan` modes are shared (concurrent);
 *   `autopilot` mode is exclusive.
 */
export function defaultIsExclusive(task: QueuedTask): boolean {
    if (task.type === 'run-workflow' || task.type === 'run-script') return true;
    if (isChatPayload(task.payload)) {
        const mode = (task.payload as any).mode;
        return mode === 'autopilot';
    }
    return true; // default: exclusive
}

// ============================================================================
// Bridge Factory
// ============================================================================

/**
 * Create a QueueExecutor wired to a CLITaskExecutor and ProcessStore.
 *
 * Returns the executor and bridge so the caller can listen to events,
 * control lifecycle, and delegate follow-up execution to the API layer.
 */
export function createQueueExecutorBridge(
    queueManager: TaskQueueManager,
    store: ProcessStore,
    options: QueueExecutorBridgeOptions = {}
): { executor: QueueExecutor; bridge: QueueExecutorBridge } {
    const taskExecutor = new CLITaskExecutor(store, {
        approvePermissions: options.approvePermissions !== false,
        workingDirectory: options.workingDirectory,
        dataDir: options.dataDir,
        aiService: options.aiService,
        defaultTimeoutMs: options.defaultTimeoutMs,
        followUpSuggestions: options.followUpSuggestions,
        getWsServer: options.getWsServer,
    });

    // Inject queue manager so follow-ups can re-activate parent tasks
    taskExecutor.setQueueManager(queueManager);

    const executor = createQueueExecutor(queueManager, taskExecutor, {
        sharedConcurrency: options.sharedConcurrency ?? 5,
        exclusiveConcurrency: options.exclusiveConcurrency ?? 1,
        isExclusive: options.isExclusive ?? defaultIsExclusive,
        autoStart: options.autoStart !== false,
    });

    return { executor, bridge: taskExecutor };
}
