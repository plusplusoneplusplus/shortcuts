import type { ConversationTurn, ISDKService, ProcessStore, QueuedTask } from '@plusplusoneplusplus/forge';
import { approveAllPermissions, toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { ChatPayload } from '../tasks/task-types';
import { isChatPayload, isChatFollowUp, isRunWorkflowPayload, isRunScriptPayload, hasTaskGenerationContext, hasResolveCommentsContext, hasResolveDiffCommentsMultiContext, hasReplicationContext, hasCommitChatContext, hasNoteChatContext, hasNoteCreateContext, hasClassifyDiffContext, isPrClassificationPayload, isDreamRunPayload, normalizeChatModeOrDefault } from '../tasks/task-types';
import type { ChatMode } from '../tasks/task-types';
import type { ExecutionContext } from '../task-strategies';
import { TaskStrategyRegistry } from '../task-strategies';
import { ReplicateTemplateStrategy } from '../task-strategies/replicate-template-strategy';
import { ShellExecutor } from './shell-executor';
import { WorkflowExecutor } from './workflow-executor';
import { FollowUpExecutor } from './follow-up-executor';
import { ChatExecutor } from './chat-executor';
import { AutopilotExecutor } from './autopilot-executor';
import { RalphExecutor } from './ralph-executor';
import { TaskGenerationExecutor } from './task-generation-executor';
import { ResolveCommentsExecutor } from './resolve-comments-executor';
import { CommitChatExecutor } from './commit-chat-executor';
import { NoteChatExecutor } from './note-chat-executor';
import { NoteCreateExecutor } from './note-create-executor';
import { ClassificationExecutor } from './classification-executor';
import { DreamTaskExecutor } from './dream-task-executor';
import { ProcessLifecycleRunner } from './process-lifecycle-runner';
import { WrappedTaskExecutor } from './wrapped-task-executor';
import type { SkillExecuteFn } from './wrapped-task-executor';
import type { ITaskExecutor } from './executor-types';

export interface ExecutorRegistryOptions {
    approvePermissions: boolean;
    defaultWorkingDirectory?: string;
    aiService: ISDKService;
    dataDir?: string;
    defaultTimeoutMs: number;
    followUpSuggestions: { enabled: boolean; count: number };
    askUser?: { enabled: boolean };
    /** Default AI provider name recorded on new processes when the task has no provider override. */
    provider?: 'copilot' | 'codex' | 'claude' | 'opencode';
    /** Enables the gated multi-agent Ralph grilling prompt contract. */
    ralphMultiAgentGrillEnabled?: boolean;
    /**
     * Resolve an ISDKService for a given provider, checking enablement.
     * Injected from the bridge so executors can route per-chat without
     * receiving the RuntimeConfigService directly.
     */
    resolveAiServiceForProvider?: (provider: import('../tasks/task-types').ChatProvider) => ISDKService;
    /**
     * Live read of the admin-configured global system prompt
     * (`chat.globalSystemPrompt`). Threaded to user-facing chat executors so
     * the operator-wide instruction reaches every provider via `systemMessage`.
     */
    getGlobalSystemPrompt?: () => string | undefined;
    resolveSkillConfig: (wsId: string | undefined, workDir?: string) => Promise<{ skillDirectories?: string[]; disabledSkills?: string[] }>;
    resolveWorkspaceIdForPath: (rootPath: string) => Promise<string>;
    onTitleNeeded: (processId: string, turns: ConversationTurn[]) => void;
    getWsServer?: () => import('../streaming/websocket').ProcessWebSocketServer | undefined;
    getLoopInfra?: () => import('./chat-base-executor').LoopInfraDeps | undefined;
    /** Late-bound in-process enqueue capability for the `send_to_conversation` tool. */
    getEnqueueChat?: () => import('../llm-tools/send-to-conversation-tool').EnqueueChatFn | undefined;
    /** Late-bound follow-up delivery capability for the post mode of `send_to_conversation`. */
    getSendMessage?: () => import('../llm-tools/send-to-conversation-tool').SendMessageFn | undefined;
    /** Late-bound provider/tier helpers for `send_to_conversation`. */
    getSendToConversationRuntime?: () => import('../llm-tools/send-to-conversation-tool').SendToConversationRuntimeOptions | undefined;
    getMcpOauthManager?: () => import('../mcp-oauth').McpOauthManager | undefined;
    getDreamRunExecutor?: () => import('../dreams/dream-runner').DreamRunExecutor | undefined;
    cancelledTasks?: Set<string>;
    /**
     * Shared per-process AbortController registry owned by the queue bridge.
     * Chat-mode executors register a controller per turn so the bridge's
     * cancel path can abort an in-flight `sendMessage` even before an
     * `sdkSessionId` is persisted.
     */
    processAbortControllers?: Map<string, AbortController>;
}

/**
 * Central registry that owns all executor instances and provides
 * task dispatch logic. Replaces the 9-way constructor fan-out
 * previously in CLITaskExecutor.
 */
export class ExecutorRegistry {
    readonly followUpExecutor: FollowUpExecutor;
    readonly runner: ProcessLifecycleRunner;

    private readonly store: ProcessStore;
    private readonly approvePermissions: boolean;
    private readonly defaultWorkingDirectory?: string;
    private readonly dataDir?: string;
    private readonly aiService: ISDKService;
    private readonly resolveSkillConfigFn: ExecutorRegistryOptions['resolveSkillConfig'];
    private readonly workflowExecutor: WorkflowExecutor;
    private readonly chatExecutor: ChatExecutor;
    private readonly autopilotExecutor: AutopilotExecutor;
    private readonly ralphExecutor: RalphExecutor;
    private readonly taskGenerationExecutor: TaskGenerationExecutor;
    private readonly resolveCommentsExecutor: ResolveCommentsExecutor;
    private readonly commitChatExecutor: CommitChatExecutor;
    private readonly noteChatExecutor: NoteChatExecutor;
    private readonly noteCreateExecutor: NoteCreateExecutor;
    private readonly classificationExecutor: ClassificationExecutor;
    private readonly dreamTaskExecutor: DreamTaskExecutor;
    private readonly strategyRegistry: TaskStrategyRegistry;

    constructor(store: ProcessStore, options: ExecutorRegistryOptions) {
        this.store = store;
        this.approvePermissions = options.approvePermissions;
        this.defaultWorkingDirectory = options.defaultWorkingDirectory;
        this.dataDir = options.dataDir;
        this.aiService = options.aiService;
        this.resolveSkillConfigFn = options.resolveSkillConfig;

        const chatOpts = {
            workingDirectory: options.defaultWorkingDirectory,
            approvePermissions: options.approvePermissions,
            aiService: options.aiService,
            defaultTimeoutMs: options.defaultTimeoutMs,
            followUpSuggestions: options.followUpSuggestions,
            askUser: options.askUser,
            resolveSkillConfig: options.resolveSkillConfig,
            resolveWorkspaceIdForPath: options.resolveWorkspaceIdForPath,
            getLoopInfra: options.getLoopInfra,
            getEnqueueChat: options.getEnqueueChat,
            getSendMessage: options.getSendMessage,
            getSendToConversationRuntime: options.getSendToConversationRuntime,
            getMcpOauthManager: options.getMcpOauthManager,
            provider: options.provider,
            ralphMultiAgentGrillEnabled: options.ralphMultiAgentGrillEnabled,
            resolveAiServiceForProvider: options.resolveAiServiceForProvider,
            getGlobalSystemPrompt: options.getGlobalSystemPrompt,
            processAbortControllers: options.processAbortControllers,
        };

        this.strategyRegistry = new TaskStrategyRegistry();
        this.strategyRegistry.register('replicate-template', new ReplicateTemplateStrategy());

        this.workflowExecutor = new WorkflowExecutor(store, { approvePermissions: options.approvePermissions, workingDirectory: options.defaultWorkingDirectory }, options.dataDir);
        this.followUpExecutor = new FollowUpExecutor(store, { ...chatOpts, onTitleNeeded: options.onTitleNeeded, getWsServer: options.getWsServer }, options.dataDir);
        this.chatExecutor = new ChatExecutor(store, { ...chatOpts, getWsServer: options.getWsServer }, options.dataDir);
        this.autopilotExecutor = new AutopilotExecutor(store, { ...chatOpts, getWsServer: options.getWsServer }, options.dataDir);
        this.ralphExecutor = new RalphExecutor(store, { ...chatOpts, getWsServer: options.getWsServer }, options.dataDir);
        this.taskGenerationExecutor = new TaskGenerationExecutor(store, chatOpts, options.dataDir);
        this.resolveCommentsExecutor = new ResolveCommentsExecutor(store, chatOpts, options.getWsServer, options.dataDir);
        this.commitChatExecutor = new CommitChatExecutor(store, chatOpts, options.getWsServer, options.dataDir);
        this.noteChatExecutor = new NoteChatExecutor(store, chatOpts, options.dataDir);
        this.noteCreateExecutor = new NoteCreateExecutor(store, chatOpts, options.dataDir);
        this.classificationExecutor = new ClassificationExecutor(store, chatOpts, options.dataDir);
        this.dreamTaskExecutor = new DreamTaskExecutor({
            getRunner: options.getDreamRunExecutor ?? (() => undefined),
            cancelledTasks: options.cancelledTasks ?? new Set(),
        });
        this.runner = new ProcessLifecycleRunner(store, options.dataDir, options.onTitleNeeded, options.provider);
    }

    /** Dispatch a task to the appropriate executor based on its type and payload. */
    async dispatch(task: QueuedTask, prompt: string): Promise<unknown> {
        if (isRunWorkflowPayload(task.payload)) return this.workflowExecutor.execute(task);
        if (isRunScriptPayload(task.payload)) return new ShellExecutor(this.store, this.dataDir, this.defaultWorkingDirectory).execute(task);
        if (isPrClassificationPayload(task.payload)) return this.classificationExecutor.execute(task, task.payload.prompt);
        if (isDreamRunPayload(task.payload)) return this.dreamTaskExecutor.execute(task);
        if (isChatPayload(task.payload) && !isChatFollowUp(task.payload)) {
            const payload = task.payload as unknown as ChatPayload;
            const executor = this.resolveChatExecutor(task, payload);

            if (payload.beforeScript || payload.afterScript || payload.postActions?.length) {
                const hasSkillActions = payload.postActions?.some(a => a.type === 'skill');
                return new WrappedTaskExecutor(
                    executor,
                    this.store,
                    hasSkillActions ? this.resolveSkillConfigFn : undefined,
                    hasSkillActions ? this.buildSkillExecuteFn() : undefined,
                ).execute(task, prompt);
            }

            return executor.execute(task, prompt);
        }
        return { status: 'completed', message: `Task type '${task.type}' executed (no-op in CLI mode)` };
    }

    /** Resolve the working directory for a task. */
    getWorkingDirectory(task: QueuedTask): string | undefined {
        if (isRunWorkflowPayload(task.payload)) return task.payload.workingDirectory || this.defaultWorkingDirectory;
        if (isRunScriptPayload(task.payload)) return task.payload.workingDirectory || this.defaultWorkingDirectory;
        if (isPrClassificationPayload(task.payload)) return task.payload.workingDirectory || this.defaultWorkingDirectory;
        if (isDreamRunPayload(task.payload)) return task.payload.workingDirectory || this.defaultWorkingDirectory;
        if (isChatPayload(task.payload)) return task.payload.workingDirectory || (task.payload as unknown as ChatPayload).folderPath || this.defaultWorkingDirectory;
        return this.defaultWorkingDirectory;
    }

    /** Build execution context for strategy-based execution. */
    buildExecutionContext(task: QueuedTask): ExecutionContext {
        return { processId: toQueueProcessId(task.id), store: this.store, approvePermissions: this.approvePermissions, workingDirectory: this.getWorkingDirectory(task) };
    }

    /** Create a skill execution callback that invokes the AI service directly. */
    private buildSkillExecuteFn(): SkillExecuteFn {
        return async (prompt, workingDirectory, model) => {
            const result = await this.aiService.sendMessage({
                prompt,
                mode: 'autopilot',
                model,
                workingDirectory,
                onPermissionRequest: this.approvePermissions ? approveAllPermissions : undefined,
            });
            if (!result.success) throw new Error(result.error || 'Skill execution failed');
            return result.response || '';
        };
    }

    /** Resolve the chat-mode executor based on payload context and mode. */
    private resolveChatExecutor(task: QueuedTask, payload: ChatPayload): ITaskExecutor {
        if (hasTaskGenerationContext(task.payload)) return this.taskGenerationExecutor;
        if (hasReplicationContext(task.payload)) return { execute: (t: QueuedTask) => this.strategyRegistry.get('replicate-template')!.execute(t, this.buildExecutionContext(t)) };
        if (hasResolveCommentsContext(task.payload) || hasResolveDiffCommentsMultiContext(task.payload) || payload.tools?.includes('resolve-comments')) return { execute: (t: QueuedTask) => this.resolveCommentsExecutor.executeTask(t) };
        if (hasCommitChatContext(task.payload)) return this.commitChatExecutor;
        if (hasClassifyDiffContext(task.payload)) return this.classificationExecutor;
        if (hasNoteCreateContext(task.payload)) return this.noteCreateExecutor;
        if (hasNoteChatContext(task.payload)) return this.noteChatExecutor;
        const mode = normalizeChatModeOrDefault(payload.mode);
        if (mode === 'autopilot') return this.autopilotExecutor;
        if (mode === 'ralph') return this.ralphExecutor;
        return this.chatExecutor;
    }

    /**
     * Look up the pending ask-user handles for a process across all executors
     * that support the ask_user tool (ask and follow-up modes).
     */
    getAskUserHandles(processId: string): ReturnType<typeof this.chatExecutor.getAskUserHandles> {
        return this.chatExecutor.getAskUserHandles(processId)
            ?? this.followUpExecutor.getAskUserHandles(processId);
    }
}
