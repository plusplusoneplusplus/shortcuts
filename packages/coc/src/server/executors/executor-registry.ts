import type { ConversationTurn, CopilotSDKService, FileToolCallCacheStore, ProcessStore, QueuedTask } from '@plusplusoneplusplus/forge';
import type { ChatPayload } from '../task-types';
import { isChatPayload, isChatFollowUp, isRunWorkflowPayload, isRunScriptPayload, hasTaskGenerationContext, hasResolveCommentsContext, hasResolveDiffCommentsMultiContext, hasReplicationContext } from '../task-types';
import type { ExecutionContext } from '../task-strategies';
import { TaskStrategyRegistry } from '../task-strategies';
import { ReplicateTemplateStrategy } from '../task-strategies/replicate-template-strategy';
import { ShellExecutor } from './shell-executor';
import { WorkflowExecutor } from './workflow-executor';
import { FollowUpExecutor } from './follow-up-executor';
import { ChatExecutor } from './chat-executor';
import { PlanExecutor } from './plan-executor';
import { AutopilotExecutor } from './autopilot-executor';
import { TaskGenerationExecutor } from './task-generation-executor';
import { ResolveCommentsExecutor } from './resolve-comments-executor';
import { MemoryAggregateExecutor } from '../memory/memory-aggregate-executor';
import { ProcessLifecycleRunner } from './process-lifecycle-runner';
import { WrappedTaskExecutor } from './wrapped-task-executor';
import type { ITaskExecutor } from './executor-types';

export interface ExecutorRegistryOptions {
    approvePermissions: boolean;
    defaultWorkingDirectory?: string;
    aiService: CopilotSDKService;
    dataDir?: string;
    defaultTimeoutMs: number;
    followUpSuggestions: { enabled: boolean; count: number };
    toolCallCacheStore: FileToolCallCacheStore;
    resolveSkillConfig: (wsId: string | undefined, workDir?: string) => Promise<{ skillDirectories?: string[]; disabledSkills?: string[] }>;
    resolveWorkspaceIdForPath: (rootPath: string) => Promise<string>;
    onTitleNeeded: (processId: string, turns: ConversationTurn[]) => void;
    getWsServer?: () => import('../websocket').ProcessWebSocketServer | undefined;
}

/**
 * Central registry that owns all executor instances and provides
 * task dispatch logic. Replaces the 9-way constructor fan-out
 * previously in CLITaskExecutor.
 */
export class ExecutorRegistry {
    readonly followUpExecutor: FollowUpExecutor;
    readonly memoryAggregateExecutor: MemoryAggregateExecutor;
    readonly runner: ProcessLifecycleRunner;

    private readonly store: ProcessStore;
    private readonly approvePermissions: boolean;
    private readonly defaultWorkingDirectory?: string;
    private readonly dataDir?: string;
    private readonly workflowExecutor: WorkflowExecutor;
    private readonly chatExecutor: ChatExecutor;
    private readonly planExecutor: PlanExecutor;
    private readonly autopilotExecutor: AutopilotExecutor;
    private readonly taskGenerationExecutor: TaskGenerationExecutor;
    private readonly resolveCommentsExecutor: ResolveCommentsExecutor;
    private readonly strategyRegistry: TaskStrategyRegistry;

    constructor(store: ProcessStore, options: ExecutorRegistryOptions) {
        this.store = store;
        this.approvePermissions = options.approvePermissions;
        this.defaultWorkingDirectory = options.defaultWorkingDirectory;
        this.dataDir = options.dataDir;

        const chatOpts = {
            workingDirectory: options.defaultWorkingDirectory,
            approvePermissions: options.approvePermissions,
            aiService: options.aiService,
            defaultTimeoutMs: options.defaultTimeoutMs,
            followUpSuggestions: options.followUpSuggestions,
            toolCallCacheStore: options.toolCallCacheStore,
            resolveSkillConfig: options.resolveSkillConfig,
            resolveWorkspaceIdForPath: options.resolveWorkspaceIdForPath,
        };

        this.strategyRegistry = new TaskStrategyRegistry();
        this.strategyRegistry.register('replicate-template', new ReplicateTemplateStrategy());

        this.workflowExecutor = new WorkflowExecutor(store, { approvePermissions: options.approvePermissions, workingDirectory: options.defaultWorkingDirectory }, options.dataDir);
        this.followUpExecutor = new FollowUpExecutor(store, { workingDirectory: options.defaultWorkingDirectory, approvePermissions: options.approvePermissions, aiService: options.aiService, followUpSuggestions: options.followUpSuggestions, resolveWorkspaceIdForPath: options.resolveWorkspaceIdForPath, resolveSkillConfig: options.resolveSkillConfig, onTitleNeeded: options.onTitleNeeded }, options.dataDir);
        this.chatExecutor = new ChatExecutor(store, chatOpts, options.dataDir);
        this.planExecutor = new PlanExecutor(store, chatOpts, options.dataDir);
        this.autopilotExecutor = new AutopilotExecutor(store, chatOpts, options.dataDir);
        this.taskGenerationExecutor = new TaskGenerationExecutor(store, chatOpts, options.dataDir);
        this.resolveCommentsExecutor = new ResolveCommentsExecutor(store, chatOpts, options.getWsServer, options.dataDir);
        this.memoryAggregateExecutor = new MemoryAggregateExecutor(store, options.dataDir ?? '');
        this.runner = new ProcessLifecycleRunner(store, options.dataDir, options.onTitleNeeded);
    }

    /** Dispatch a task to the appropriate executor based on its type and payload. */
    async dispatch(task: QueuedTask, prompt: string): Promise<unknown> {
        if (isRunWorkflowPayload(task.payload)) return this.workflowExecutor.execute(task);
        if (isRunScriptPayload(task.payload)) return new ShellExecutor(this.store, this.dataDir, this.defaultWorkingDirectory).execute(task);
        if (isChatPayload(task.payload) && !isChatFollowUp(task.payload)) {
            const payload = task.payload as unknown as ChatPayload;
            const executor = this.resolveChatExecutor(task, payload);

            if (payload.beforeScript || payload.afterScript) {
                return new WrappedTaskExecutor(executor, this.store).execute(task, prompt);
            }

            return executor.execute(task, prompt);
        }
        return { status: 'completed', message: `Task type '${task.type}' executed (no-op in CLI mode)` };
    }

    /** Resolve the working directory for a task. */
    getWorkingDirectory(task: QueuedTask): string | undefined {
        if (isRunWorkflowPayload(task.payload)) return task.payload.workingDirectory || this.defaultWorkingDirectory;
        if (isRunScriptPayload(task.payload)) return task.payload.workingDirectory || this.defaultWorkingDirectory;
        if (isChatPayload(task.payload)) return task.payload.workingDirectory || (task.payload as unknown as ChatPayload).folderPath || this.defaultWorkingDirectory;
        return this.defaultWorkingDirectory;
    }

    /** Build execution context for strategy-based execution. */
    buildExecutionContext(task: QueuedTask): ExecutionContext {
        return { processId: `queue_${task.id}`, store: this.store, approvePermissions: this.approvePermissions, workingDirectory: this.getWorkingDirectory(task) };
    }

    /** Resolve the chat-mode executor based on payload context and mode. */
    private resolveChatExecutor(task: QueuedTask, payload: ChatPayload): ITaskExecutor {
        if (hasTaskGenerationContext(task.payload)) return this.taskGenerationExecutor;
        if (hasReplicationContext(task.payload)) return { execute: (t: QueuedTask) => this.strategyRegistry.get('replicate-template')!.execute(t, this.buildExecutionContext(t)) };
        if (hasResolveCommentsContext(task.payload) || hasResolveDiffCommentsMultiContext(task.payload) || payload.tools?.includes('resolve-comments')) return { execute: (t: QueuedTask) => this.resolveCommentsExecutor.executeTask(t) };
        const mode = payload.mode;
        if (mode === 'plan') return this.planExecutor;
        if (mode === 'autopilot') return this.autopilotExecutor;
        return this.chatExecutor;
    }
}
