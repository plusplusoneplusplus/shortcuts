import * as crypto from 'crypto';
import type {
    ISDKService,
    ProcessStore,
    QueuedTask,
    SDKInvocationResult,
    SystemMessageConfig,
} from '@plusplusoneplusplus/forge';
import {
    denyAllPermissions,
    resolveModelForProvider,
    toQueueProcessId,
} from '@plusplusoneplusplus/forge';
import type { ChatProvider } from '../tasks/task-types';
import type { DreamInternalProcessPurpose, DreamInternalStepRequest, DreamInternalStepResult } from '../dreams/dream-internal-process';
import { ProcessLifecycleRunner } from './process-lifecycle-runner';

export interface DreamInternalProcessExecutorOptions {
    store: ProcessStore;
    aiService: ISDKService;
    dataDir?: string;
    provider?: ChatProvider;
    resolveAiServiceForProvider?: (provider: ChatProvider) => ISDKService;
}

export class DreamInternalProcessExecutionError extends Error {
    readonly processId: string;
    readonly purpose: DreamInternalProcessPurpose;

    constructor(message: string, options: { processId: string; purpose: DreamInternalProcessPurpose }) {
        super(message);
        this.name = 'DreamInternalProcessExecutionError';
        this.processId = options.processId;
        this.purpose = options.purpose;
    }
}

export class DreamInternalProcessExecutor {
    private readonly store: ProcessStore;
    private readonly aiService: ISDKService;
    private readonly resolveAiServiceForProvider?: (provider: ChatProvider) => ISDKService;
    private readonly defaultProvider: ChatProvider;
    private readonly runner: ProcessLifecycleRunner;

    constructor(options: DreamInternalProcessExecutorOptions) {
        this.store = options.store;
        this.aiService = options.aiService;
        this.resolveAiServiceForProvider = options.resolveAiServiceForProvider;
        this.defaultProvider = options.provider ?? 'copilot';
        this.runner = new ProcessLifecycleRunner(options.store, options.dataDir, () => undefined, this.defaultProvider);
    }

    async runStep(input: DreamInternalStepRequest): Promise<DreamInternalStepResult> {
        const workspaceId = input.workspaceId.trim();
        if (!workspaceId) {
            throw new Error('workspaceId is required');
        }
        const runId = input.runId.trim();
        if (!runId) {
            throw new Error('runId is required');
        }

        const task = this.createTask({ ...input, workspaceId, runId });
        const processId = toQueueProcessId(task.id);
        const cancelledTasks = new Set<string>();
        const abortListener = () => cancelledTasks.add(task.id);
        if (input.signal?.aborted) {
            cancelledTasks.add(task.id);
        } else {
            input.signal?.addEventListener('abort', abortListener, { once: true });
        }

        let response = '';
        try {
            const result = await this.runner.run(task, {
                cancelledTasks,
                executeFollowUpFn: async () => {
                    throw new Error('Dream internal processes do not support follow-up messages');
                },
                executeByTypeFn: async (runningTask, prompt) => {
                    input.onProcessStarted?.(processId);
                    await this.attachDreamStepMetadata(processId, runningTask, input);
                    const execution = await this.executeReadOnlyAiStep(input, prompt);
                    response = execution.response;
                    return execution;
                },
                getWorkingDirectoryFn: () => undefined,
            });
            if (input.signal?.aborted || cancelledTasks.has(task.id)) {
                throw new DreamInternalProcessExecutionError(
                    `Dream ${input.purpose} was cancelled`,
                    { processId, purpose: input.purpose },
                );
            }
            if (!result.success) {
                throw new DreamInternalProcessExecutionError(
                    result.error?.message ?? 'Dream internal process failed',
                    { processId, purpose: input.purpose },
                );
            }
            return { processId, response };
        } finally {
            input.signal?.removeEventListener('abort', abortListener);
        }
    }

    private createTask(input: DreamInternalStepRequest): QueuedTask {
        const type = taskTypeForPurpose(input.purpose);
        return {
            id: `${type}-${input.runId}-${crypto.randomBytes(4).toString('hex')}`,
            repoId: input.workspaceId,
            type,
            priority: 'low',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: input.prompt,
                workspaceId: input.workspaceId,
                ...(input.provider ? { provider: input.provider } : {}),
                ...(input.model ? { model: input.model } : {}),
                ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
            },
            config: {
                ...(input.model ? { model: input.model } : {}),
                ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
                timeoutMs: input.timeoutMs,
            },
            displayName: displayNameForPurpose(input.purpose),
        };
    }

    private async attachDreamStepMetadata(
        processId: string,
        task: QueuedTask,
        input: DreamInternalStepRequest,
    ): Promise<void> {
        const current = await this.store.getProcess(processId, input.workspaceId);
        const provider = input.provider ?? this.defaultProvider;
        const model = resolveModelForProvider(provider, input.model).model;
        await this.store.updateProcess(processId, {
            ...(input.parentProcessId ? { parentProcessId: input.parentProcessId } : {}),
            title: displayNameForPurpose(input.purpose),
            metadata: {
                ...(current?.metadata ?? {}),
                type: task.type,
                workspaceId: input.workspaceId,
                provider,
                ...(model ? { model } : {}),
                ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
                mode: 'ask',
                dreamStep: {
                    kind: input.purpose,
                    purpose: displayNameForPurpose(input.purpose),
                    workspaceId: input.workspaceId,
                    runId: input.runId,
                    readOnly: true,
                    toolsEnabled: false,
                    mcpEnabled: false,
                    permissionPolicy: 'deny-all',
                    timeoutMs: input.timeoutMs,
                    ...(input.parentProcessId ? { parentProcessId: input.parentProcessId } : {}),
                    ...(input.analyzerProcessId ? { analyzerProcessId: input.analyzerProcessId } : {}),
                },
            },
        });
    }

    private async executeReadOnlyAiStep(
        input: DreamInternalStepRequest,
        prompt: string,
    ): Promise<{ response: string; effectiveModel?: string; sessionId?: string; tokenUsage?: SDKInvocationResult['tokenUsage']; timeline: [] }> {
        const provider = input.provider ?? this.defaultProvider;
        const aiService = input.provider && this.resolveAiServiceForProvider
            ? this.resolveAiServiceForProvider(input.provider)
            : this.aiService;
        const model = resolveModelForProvider(provider, input.model).model;
        const systemMessage: SystemMessageConfig = { mode: 'replace', content: input.systemPrompt };
        const result = await aiService.sendMessage({
            prompt,
            ...(model ? { model } : {}),
            ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
            timeoutMs: input.timeoutMs,
            ...(input.signal ? { signal: input.signal } : {}),
            mode: 'interactive',
            systemMessage,
            streaming: false,
            loadDefaultMcpConfig: false,
            mcpServers: {},
            availableTools: [],
            tools: [],
            onPermissionRequest: denyAllPermissions,
        });
        if (!result.success) {
            throw new Error(result.error ?? `Dream ${input.purpose} failed`);
        }
        return {
            response: result.response ?? '',
            effectiveModel: result.effectiveModel ?? model,
            sessionId: result.sessionId,
            tokenUsage: result.tokenUsage,
            timeline: [],
        };
    }
}

function taskTypeForPurpose(purpose: DreamInternalProcessPurpose): string {
    return purpose === 'analyzer' ? 'dream-analyzer' : 'dream-critic';
}

function displayNameForPurpose(purpose: DreamInternalProcessPurpose): string {
    return purpose === 'analyzer' ? 'Dream analyzer' : 'Dream critic';
}
