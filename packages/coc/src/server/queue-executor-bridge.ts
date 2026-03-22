import type { ChatPayload, ChatMode } from './task-types';
import { isChatPayload, isChatFollowUp, isRunWorkflowPayload, isRunScriptPayload, hasTaskGenerationContext, hasResolveCommentsContext, hasReplicationContext } from './task-types';
import { applyFollowUpToTask } from './shared/queue-utils';
import type { Attachment, ConversationTurn, CopilotSDKService, ProcessStore, QueuedTask, QueueExecutor, TaskExecutionResult, TaskExecutor, TaskQueueManager } from '@plusplusoneplusplus/forge';
import { createQueueExecutor, DEFAULT_AI_TIMEOUT_MS, FileToolCallCacheStore, getCopilotSDKService, resolveToolCallCacheOptions } from '@plusplusoneplusplus/forge';
import * as path from 'path';
import { BaseExecutor } from './executors/base-executor';
import type { ExecutionContext } from './task-strategies';
import { TaskStrategyRegistry } from './task-strategies';
import { ReplicateTemplateStrategy } from './task-strategies/replicate-template-strategy';
import { ShellExecutor } from './executors/shell-executor';
import { WorkflowExecutor } from './executors/workflow-executor';
import { FollowUpExecutor } from './executors/follow-up-executor';
import { ChatExecutor } from './executors/chat-executor';
import { PlanExecutor } from './executors/plan-executor';
import { AutopilotExecutor } from './executors/autopilot-executor';
import { TaskGenerationExecutor } from './executors/task-generation-executor';
import { ResolveCommentsExecutor } from './executors/resolve-comments-executor';
import { ProcessLifecycleRunner } from './executors/process-lifecycle-runner';
import { resolveSkillConfig } from './executors/skill-config-resolver';
import { generateTitleIfNeeded as generateTitleIfNeededFn } from './executors/title-generator';

export interface CLITaskExecutorOptions {
    approvePermissions?: boolean; workingDirectory?: string; dataDir?: string;
    aiService?: CopilotSDKService; defaultTimeoutMs?: number;
    followUpSuggestions?: { enabled: boolean; count: number };
    getWsServer?: () => import('./websocket').ProcessWebSocketServer | undefined;
}
export interface QueueExecutorBridgeOptions extends CLITaskExecutorOptions {
    maxConcurrency?: number; sharedConcurrency?: number; exclusiveConcurrency?: number;
    isExclusive?: (task: QueuedTask) => boolean; autoStart?: boolean;
}
export interface QueueExecutorBridge {
    executeFollowUp(processId: string, message: string, attachments?: Attachment[], mode?: string, deliveryMode?: string): Promise<void>;
    isSessionAlive(processId: string): Promise<boolean>;
    requeueForFollowUp?(taskId: string, prompt: string, attachments?: Attachment[], imageTempDir?: string, mode?: string, deliveryMode?: string): Promise<void>;
    cancelProcess?(processId: string): Promise<void>;
}

export class CLITaskExecutor extends BaseExecutor implements TaskExecutor {
    private readonly approvePermissions: boolean;
    private readonly defaultWorkingDirectory?: string;
    private readonly aiService: CopilotSDKService;
    private queueManager?: TaskQueueManager;
    private readonly registry: TaskStrategyRegistry;
    private readonly workflowExecutor: WorkflowExecutor;
    private readonly followUpExecutor: FollowUpExecutor;
    private readonly chatExecutor: ChatExecutor;
    private readonly planExecutor: PlanExecutor;
    private readonly autopilotExecutor: AutopilotExecutor;
    private readonly taskGenerationExecutor: TaskGenerationExecutor;
    private readonly resolveCommentsExecutor: ResolveCommentsExecutor;
    private readonly runner: ProcessLifecycleRunner;

    constructor(store: ProcessStore, options: CLITaskExecutorOptions = {}) {
        super(store, options.dataDir);
        this.approvePermissions = options.approvePermissions !== false;
        this.defaultWorkingDirectory = options.workingDirectory;
        this.aiService = options.aiService ?? getCopilotSDKService();
        const cacheStore = new FileToolCallCacheStore(resolveToolCallCacheOptions(options.workingDirectory, this.dataDir ? path.join(this.dataDir, 'memory') : undefined));
        const skillCfg = (wsId: string | undefined, workDir?: string) => resolveSkillConfig(store, this.dataDir, wsId, workDir);
        const chatOpts = { workingDirectory: this.defaultWorkingDirectory, approvePermissions: this.approvePermissions, aiService: this.aiService, defaultTimeoutMs: options.defaultTimeoutMs ?? DEFAULT_AI_TIMEOUT_MS, followUpSuggestions: options.followUpSuggestions ?? { enabled: true, count: 3 }, toolCallCacheStore: cacheStore, resolveSkillConfig: skillCfg, resolveWorkspaceIdForPath: (p: string) => this.resolveWorkspaceIdForPath(p) };
        const onTitle = (pid: string, turns: ConversationTurn[]) => this.generateTitleIfNeeded(pid, turns);
        this.registry = new TaskStrategyRegistry();
        this.registry.register('replicate-template', new ReplicateTemplateStrategy());
        this.workflowExecutor = new WorkflowExecutor(store, { approvePermissions: this.approvePermissions, workingDirectory: this.defaultWorkingDirectory }, this.dataDir);
        this.followUpExecutor = new FollowUpExecutor(store, { workingDirectory: this.defaultWorkingDirectory, approvePermissions: this.approvePermissions, aiService: this.aiService, followUpSuggestions: options.followUpSuggestions ?? { enabled: true, count: 3 }, resolveWorkspaceIdForPath: (p) => this.resolveWorkspaceIdForPath(p), resolveSkillConfig: skillCfg, onTitleNeeded: onTitle }, this.dataDir);
        this.chatExecutor = new ChatExecutor(store, chatOpts, this.dataDir);
        this.planExecutor = new PlanExecutor(store, chatOpts, this.dataDir);
        this.autopilotExecutor = new AutopilotExecutor(store, chatOpts, this.dataDir);
        this.taskGenerationExecutor = new TaskGenerationExecutor(store, chatOpts, this.dataDir);
        this.resolveCommentsExecutor = new ResolveCommentsExecutor(store, chatOpts, options.getWsServer, this.dataDir);
        this.runner = new ProcessLifecycleRunner(store, this.dataDir, onTitle);
    }

    setQueueManager(qm: TaskQueueManager): void { this.queueManager = qm; }
    private generateTitleIfNeeded(processId: string, turns: ConversationTurn[]): void { generateTitleIfNeededFn(processId, turns, this.store, this.aiService, this.defaultWorkingDirectory, this.queueManager); }
    private async resolveWorkspaceIdForPath(rootPath: string): Promise<string> { const ws = (await this.store.getWorkspaces()).find(w => path.resolve(w.rootPath) === path.resolve(rootPath)); return ws?.id ?? rootPath; }

    async requeueForFollowUp(taskId: string, prompt: string, attachments?: Attachment[], imageTempDir?: string, mode?: string, deliveryMode?: string): Promise<void> {
        if (!this.queueManager) throw new Error('Queue manager is not available');
        if (!this.queueManager.getTask(taskId)) throw new Error(`Task ${taskId} not found`);
        applyFollowUpToTask(this.queueManager, taskId, prompt, attachments, imageTempDir, mode, deliveryMode);
    }

    async execute(task: QueuedTask): Promise<TaskExecutionResult> {
        return this.runner.run(task, { cancelledTasks: this.cancelledTasks, executeFollowUpFn: (pid, msg, att, mode, dm) => this.executeFollowUp(pid, msg, att, mode as ChatMode | undefined, dm), executeByTypeFn: (t, p) => this.executeByType(t, p), getWorkingDirectoryFn: (t) => this.getWorkingDirectory(t) });
    }

    cancel(taskId: string): void { this.cancelledTasks.add(taskId); }

    async cancelProcess(processId: string): Promise<void> {
        this.cancelledTasks.add(processId.replace('queue_', ''));
        try { const proc = await this.store.getProcess(processId); if (proc?.sdkSessionId) { await this.aiService.abortSession(proc.sdkSessionId); } } catch { /* Non-fatal */ }
    }

    async isSessionAlive(_processId: string): Promise<boolean> { return true; }

    async executeFollowUp(processId: string, message: string, attachments?: Attachment[], mode?: ChatMode, deliveryMode?: string): Promise<void> {
        return this.followUpExecutor.executeFollowUp(processId, message, attachments, mode, deliveryMode);
    }

    private buildExecutionContext(task: QueuedTask): ExecutionContext { return { processId: `queue_${task.id}`, store: this.store, approvePermissions: this.approvePermissions, workingDirectory: this.getWorkingDirectory(task) }; }

    private async executeByType(task: QueuedTask, prompt: string): Promise<unknown> {
        if (isRunWorkflowPayload(task.payload)) return this.workflowExecutor.execute(task);
        if (isRunScriptPayload(task.payload)) return new ShellExecutor(this.store, this.dataDir, this.defaultWorkingDirectory).execute(task);
        if (isChatPayload(task.payload) && !isChatFollowUp(task.payload)) {
            const payload = task.payload as unknown as ChatPayload;
            if (hasTaskGenerationContext(task.payload)) return this.taskGenerationExecutor.execute(task);
            if (hasReplicationContext(task.payload)) return this.registry.get('replicate-template')!.execute(task, this.buildExecutionContext(task));
            if (hasResolveCommentsContext(task.payload) || payload.tools?.includes('resolve-comments')) return this.resolveCommentsExecutor.executeTask(task);
            const mode = payload.mode;
            if (mode === 'plan') return this.planExecutor.execute(task, prompt);
            if (mode === 'autopilot') return this.autopilotExecutor.execute(task, prompt);
            return this.chatExecutor.execute(task, prompt);
        }
        return { status: 'completed', message: `Task type '${task.type}' executed (no-op in CLI mode)` };
    }

    private getWorkingDirectory(task: QueuedTask): string | undefined {
        if (isRunWorkflowPayload(task.payload)) return task.payload.workingDirectory || this.defaultWorkingDirectory;
        if (isRunScriptPayload(task.payload)) return task.payload.workingDirectory || this.defaultWorkingDirectory;
        if (isChatPayload(task.payload)) return task.payload.workingDirectory || (task.payload as unknown as ChatPayload).folderPath || this.defaultWorkingDirectory;
        return this.defaultWorkingDirectory;
    }
}

export function defaultIsExclusive(task: QueuedTask): boolean {
    if (task.type === 'run-workflow' || task.type === 'run-script') return true;
    if (isChatPayload(task.payload)) { const mode = (task.payload as any).mode; return mode === 'autopilot'; }
    return true;
}

export function createQueueExecutorBridge(queueManager: TaskQueueManager, store: ProcessStore, options: QueueExecutorBridgeOptions = {}): { executor: QueueExecutor; bridge: QueueExecutorBridge } {
    const bridge = new CLITaskExecutor(store, options);
    bridge.setQueueManager(queueManager);
    const executor = createQueueExecutor(queueManager, bridge, { sharedConcurrency: options.sharedConcurrency ?? 5, exclusiveConcurrency: options.exclusiveConcurrency ?? 1, isExclusive: options.isExclusive ?? defaultIsExclusive, autoStart: options.autoStart !== false });
    return { executor, bridge };
}