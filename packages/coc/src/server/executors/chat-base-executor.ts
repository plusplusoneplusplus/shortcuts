/**
 * Chat Mode Base Executor
 *
 * Abstract base class for the three AI chat-mode executors (chat/plan/autopilot).
 * Owns the shared AI SDK call lifecycle: image handling, availability check, skill
 * resolution, tool-call capture, streaming, session cleanup, and output persistence.
 *
 * Subclasses implement `buildModeOptions()` to supply mode-specific params:
 * - agentMode (interactive | plan | autopilot)
 * - systemMessage (mode-specific prompt restrictions)
 * - tools (follow-up suggestions or other injected tools)
 * - effectivePrompt (prompt with any mode-specific suffix appended)
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
    AgentMode,
    Attachment,
    AutoFolderContext,
    CopilotSDKService,
    MemoryToolCaptureContext,
    ProcessStore,
    QueuedTask,
    SystemMessageConfig,
    TimelineItem,
    Tool,
    ToolEvent,
} from '@plusplusoneplusplus/forge';
import {
    approveAllPermissions,
    FileToolCallCacheStore,
    getLogger,
    LogCategory,
    mergeConsecutiveContentItems,
    TASK_FILTER,
    ToolCallCapture,
    rewriteLargePrompt,
    toQueueProcessId,
} from '@plusplusoneplusplus/forge';
import type { ChatPayload } from '../task-types';
import { saveImagesToTempFiles, cleanupTempDir, rehydrateImagesIfNeeded } from './image-store';
import { resolveTaskRoot } from '../task-root-resolver';
import { getRepoDataPath } from '../paths';
import { BaseExecutor } from './base-executor';
import { assertNoAskUserConflict, prependSelectedSkillsDirective } from './prompt-builder';
import { isValidTaskFolder } from './auto-folder-utils';

// ============================================================================
// Types
// ============================================================================

export interface ChatModeExecutorOptions {
    /** Default working directory for AI sessions */
    workingDirectory?: string;
    /** Whether to auto-approve AI permission requests (default: true) */
    approvePermissions?: boolean;
    /** The AI service instance to use for sending messages */
    aiService: CopilotSDKService;
    /** Default timeout in ms for tasks that do not specify their own timeoutMs */
    defaultTimeoutMs: number;
    /** Follow-up suggestions configuration */
    followUpSuggestions: { enabled: boolean; count: number };
    /** Ask-user interactive tool configuration */
    askUser?: { enabled: boolean };
    /** Shared store for tool-call Q&A capture (explore cache) */
    toolCallCacheStore: FileToolCallCacheStore;
    /** Resolve skill configuration for a workspace */
    resolveSkillConfig: (wsId: string | undefined, workDir?: string) => Promise<{ skillDirectories?: string[]; disabledSkills?: string[] }>;
    /** Resolve workspace ID for a root path */
    resolveWorkspaceIdForPath: (rootPath: string) => Promise<string>;
    /** Callback when a capture-mode memory.add completes (triggers aggregate enqueue). */
    onMemoryCaptured?: (workspaceId: string, target: string) => void;
}

/** Return type for the AI call result. */
export interface ChatModeExecutionResult {
    response: string;
    sessionId?: string;
    toolCalls?: unknown[];
    /** Merged timeline captured from the executor session before cleanup. */
    timeline: TimelineItem[];
    /** Follow-up suggestions emitted via suggest_follow_ups tool, if any. */
    pendingSuggestions?: string[];
}

/** Mode-specific AI call parameters supplied by each concrete executor. */
export interface ChatModeAIOptions {
    agentMode: AgentMode | undefined;
    systemMessage: SystemMessageConfig | undefined;
    tools: Tool<unknown>[];
    /** Prompt with any mode-specific suffix already appended. */
    effectivePrompt: string;
    /** Clean up resources (e.g. raw memory DB handles) after execution. */
    dispose?: () => void;
}

// ============================================================================
// ChatBaseExecutor
// ============================================================================

export abstract class ChatBaseExecutor extends BaseExecutor {
    protected readonly approvePermissions: boolean;
    protected readonly defaultWorkingDirectory?: string;
    protected readonly aiService: CopilotSDKService;
    protected readonly defaultTimeoutMs: number;
    protected readonly followUpSuggestions: { enabled: boolean; count: number };
    protected readonly askUser: { enabled: boolean };
    protected readonly toolCallCacheStore: FileToolCallCacheStore;
    protected readonly resolveSkillConfigFn: (wsId: string | undefined, workDir?: string) => Promise<{ skillDirectories?: string[]; disabledSkills?: string[] }>;
    protected readonly resolveWorkspaceIdForPathFn: (rootPath: string) => Promise<string>;
    protected readonly onMemoryCapturedFn?: (workspaceId: string, target: string) => void;

    constructor(store: ProcessStore, options: ChatModeExecutorOptions, dataDir?: string) {
        super(store, dataDir);
        this.approvePermissions = options.approvePermissions !== false;
        this.defaultWorkingDirectory = options.workingDirectory;
        this.aiService = options.aiService;
        this.defaultTimeoutMs = options.defaultTimeoutMs;
        this.followUpSuggestions = options.followUpSuggestions;
        this.askUser = options.askUser ?? { enabled: false };
        this.toolCallCacheStore = options.toolCallCacheStore;
        this.resolveSkillConfigFn = options.resolveSkillConfig;
        this.resolveWorkspaceIdForPathFn = options.resolveWorkspaceIdForPath;
        this.onMemoryCapturedFn = options.onMemoryCaptured;
    }

    // ========================================================================
    // Template method — subclasses provide mode-specific AI options
    // ========================================================================

    /**
     * Build mode-specific AI call options: agent mode, system message, tools,
     * and the final effective prompt (with any mode suffix appended).
     */
    protected abstract buildModeOptions(
        task: QueuedTask,
        prompt: string,
        workingDirectory: string | undefined,
    ): Promise<ChatModeAIOptions>;

    // ========================================================================
    // Shared helper — capture context for bounded memory addon
    // ========================================================================

    /**
     * Build a MemoryToolCaptureContext from a queued task.
     * Used by all chat-mode executors to activate capture mode.
     */
    protected buildCaptureContext(task: QueuedTask): MemoryToolCaptureContext {
        return {
            processId: toQueueProcessId(task.id),
            turnIndex: 0,
        };
    }

    // ========================================================================
    // Shared helper — auto-folder context (used by ask and plan modes)
    // ========================================================================

    /**
     * Resolve the target root directory and list existing sub-folders.
     *
     * When `isPlanMode` is true the target root is `notes/Plans/` (auto-created)
     * so that plan files land in the Notes tab rather than the Tasks tree.
     * All other modes continue to use the tasks root.
     */
    protected async buildAutoFolderContext(
        workingDirectory: string,
        workspaceId?: string,
        isPlanMode?: boolean,
    ): Promise<AutoFolderContext> {
        const wsId = workspaceId || await this.resolveWorkspaceIdForPathFn(workingDirectory);
        const effectiveDataDir = this.dataDir ?? path.join(os.homedir(), '.coc');

        let folderRoot: string;
        if (isPlanMode) {
            folderRoot = path.join(getRepoDataPath(effectiveDataDir, wsId, 'notes'), 'Plans');
            await fs.promises.mkdir(folderRoot, { recursive: true });
        } else {
            folderRoot = resolveTaskRoot({
                dataDir: effectiveDataDir,
                rootPath: workingDirectory,
                workspaceId: wsId,
            }).absolutePath;
        }

        const entries = await fs.promises
            .readdir(folderRoot, { withFileTypes: true })
            .catch(() => [] as fs.Dirent[]);
        const existingFolders = entries
            .filter(e => e.isDirectory() && isValidTaskFolder(e.name))
            .map(e => e.name);
        return { tasksRoot: folderRoot, existingFolders };
    }

    // ========================================================================
    // Shared execute — AI call lifecycle
    // ========================================================================

    /**
     * Execute a chat-mode AI task.
     *
     * Flow:
     * 1. Resolve working directory from task payload
     * 2. Call buildModeOptions() to get mode-specific params
     * 3. Initialize session, register flush handler
     * 4. Rehydrate and save images to temp files
     * 5. Check AI availability
     * 6. Resolve skill configuration
     * 7. Set up tool-call capture
     * 8. Send message via AI SDK with streaming callbacks
     * 9. Return { response, sessionId, toolCalls }
     * 10. In finally: cleanup images, session, flush handler, persist output
     */
    async execute(task: QueuedTask, prompt: string): Promise<ChatModeExecutionResult> {
        const processId = toQueueProcessId(task.id);
        const payload = task.payload as unknown as ChatPayload;
        const workingDirectory = payload.workingDirectory || payload.folderPath || this.defaultWorkingDirectory;

        let { agentMode, systemMessage, tools, effectivePrompt, dispose: modeDispose } = await this.buildModeOptions(task, prompt, workingDirectory);

        // Persist system prompt to process metadata (fire-and-forget, non-blocking)
        if (systemMessage?.content) {
            const capturedContent = systemMessage.content;
            (async () => {
                try {
                    const proc = await this.store.getProcess(processId);
                    if (proc) {
                        await this.store.updateProcess(processId, {
                            metadata: {
                                type: proc.metadata?.type ?? task.type,
                                ...(proc.metadata ?? {}),
                                systemPrompt: capturedContent,
                            } as any,
                        });
                    }
                } catch { /* non-fatal */ }
            })();
        }

        this.getOrCreateSession(processId).outputBuffer = '';
        this.store.registerFlushHandler?.(processId, () => this.flushConversationTurn(processId, true));

        // Rehydrate externalized images from blob store before image decoding
        await rehydrateImagesIfNeeded(payload as unknown as Record<string, unknown>);

        let attachments: Attachment[] | undefined;
        let imageTempDir: string | undefined;
        let pasteCleanup: (() => void) | undefined;
        const payloadImages = (payload as unknown as Record<string, unknown>)?.images;
        if (Array.isArray(payloadImages) && payloadImages.length > 0) {
            const validImages = payloadImages
                .filter((img: unknown) => typeof img === 'string')
                .slice(0, 10) as string[];
            if (validImages.length > 0) {
                const saved = saveImagesToTempFiles(validImages);
                imageTempDir = saved.tempDir;
                attachments = saved.attachments.length > 0 ? saved.attachments : undefined;
            }
        }

        try {
            // Rewrite large prompts to file-path references
            const effectiveDataDir = this.dataDir ?? path.join(os.homedir(), '.coc');
            const wsId = payload.workspaceId;
            if (wsId) {
                const rewritten = await rewriteLargePrompt(effectivePrompt, effectiveDataDir, wsId);
                if (rewritten) {
                    effectivePrompt = rewritten.rewrittenPrompt;
                    pasteCleanup = rewritten.cleanup;
                }
            }

            const availability = await this.aiService.isAvailable();
            if (!availability.available) {
                throw new Error(`Copilot SDK not available: ${availability.error || 'unknown reason'}`);
            }

            const timeoutMs = task.config.timeoutMs || this.defaultTimeoutMs;
            const taskWorkspaceId = payload.workspaceId;
            const { skillDirectories, disabledSkills } = await this.resolveSkillConfigFn(taskWorkspaceId, workingDirectory);
            effectivePrompt = prependSelectedSkillsDirective(
                effectivePrompt,
                (payload as ChatPayload).context?.skills,
            );

            let captureHandler: ((event: ToolEvent) => void) | undefined;
            try {
                const capture = new ToolCallCapture(this.toolCallCacheStore, TASK_FILTER);
                captureHandler = capture.createToolEventHandler();
            } catch (err) {
                getLogger().warn(LogCategory.AI, `[ChatModeExecutor] ToolCallCapture setup failed: ${err}`);
            }

            const toolEventHandler = this.buildToolEventHandler(
                processId,
                () => 1,
                taskWorkspaceId && this.onMemoryCapturedFn
                    ? (target: string) => this.onMemoryCapturedFn!(taskWorkspaceId, target)
                    : undefined,
            );

            const sendTools = tools.length > 0 ? tools : undefined;
            // Guard: CoC uses its custom ask_user tool (SSE/widget flow).
            // The SDK's native onUserInputRequest must NOT be set at the same time.
            assertNoAskUserConflict({ tools: sendTools });

            const sendOptions = {
                prompt: effectivePrompt,
                mode: agentMode,
                model: task.config.model,
                reasoningEffort: task.config.reasoningEffort ?? 'high',
                infiniteSessions: { enabled: true } as const,
                workingDirectory,
                timeoutMs,
                attachments,
                tools: sendTools,
                systemMessage,
                skillDirectories,
                disabledSkills,
                onPermissionRequest: this.approvePermissions ? approveAllPermissions : undefined,
                onSessionCreated: (sessionId: string) => {
                    this.store.updateProcess(processId, { sdkSessionId: sessionId }).catch(() => {
                        // Non-fatal: store may be a stub
                    });
                },
                onStreamingChunk: (chunk: string) => {
                    this.getOrCreateSession(processId).outputBuffer += chunk;
                    this.appendTimelineItem(processId, { type: 'content', timestamp: new Date(), content: chunk });
                    try {
                        this.store.emitProcessOutput(processId, chunk);
                    } catch {
                        // Non-fatal: store may be a stub
                    }
                    this.checkThrottleAndFlush(processId);
                },
                onToolEvent: captureHandler
                    ? (event: ToolEvent) => {
                        try { toolEventHandler(event); } catch { /* non-fatal */ }
                        try { captureHandler!(event); } catch { /* non-fatal */ }
                    }
                    : toolEventHandler,
                onBackgroundTasksChanged: this.buildBackgroundTaskHandler(processId),
            };

            let result;
            result = await this.aiService.sendMessage(sendOptions);

            if (!result.success) {
                throw new Error(result.error || 'AI execution failed');
            }

            // Capture session state BEFORE the finally block runs cleanup.
            // (return value expressions are evaluated before finally executes)
            const finalTimeline = mergeConsecutiveContentItems(
                this.sessions.get(processId)?.timelineBuffer ?? [],
            );
            const pendingSuggestions = this.sessions.get(processId)?.pendingSuggestions;

            return {
                response: result.response || '(Task completed via tool execution — no text response produced)',
                sessionId: result.sessionId,
                toolCalls: result.toolCalls,
                timeline: finalTimeline,
                pendingSuggestions,
            };
        } finally {
            if (imageTempDir) { cleanupTempDir(imageTempDir); }
            if (pasteCleanup) { pasteCleanup(); }
            modeDispose?.();
            // Cancel any pending ask-user questions before cleanup
            this.sessions.get(processId)?.pendingAskUser?.cancelAll();
            const buffer = this.sessions.get(processId)?.outputBuffer ?? '';
            this.cleanupSession(processId);
            this.store.unregisterFlushHandler?.(processId);
            await this.persistOutput(processId, buffer, payload.workspaceId);
        }
    }
}
