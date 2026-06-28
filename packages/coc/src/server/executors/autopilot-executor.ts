/**
 * Autopilot Executor
 *
 * Concrete executor for `autopilot`-mode chat tasks.
 *
 * Extends ChatBaseExecutor to supply autopilot-mode specific AI options:
 * - agentMode: 'autopilot'
 * - systemMessage: undefined (no read-only restriction — full read/write access)
 * - tools: follow-up suggestion tool (when configured)
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type {
    AgentMode,
    ProcessStore,
    QueuedTask,
} from '@plusplusoneplusplus/forge';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import { systemMessageBuilder } from './system-message-builder';
import type { ChatPayload } from '../tasks/task-types';
import type { ChatModeAIOptions, ChatModeExecutorOptions } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';
import { buildChatTurnContext } from './chat-turn-context-builder';
import { buildSourceLocationMarkdownLinkSystemMessage } from './prompt-builder';

// ============================================================================
// AutopilotExecutor
// ============================================================================

export interface AutopilotExecutorOptions extends ChatModeExecutorOptions {
    getWsServer?: () => ProcessWebSocketServer | undefined;
}

export class AutopilotExecutor extends ChatBaseExecutor {
    private readonly getWsServerFn?: () => ProcessWebSocketServer | undefined;

    constructor(store: ProcessStore, options: AutopilotExecutorOptions, dataDir?: string) {
        super(store, options, dataDir);
        this.getWsServerFn = options.getWsServer;
    }

    /** Autopilot is an interactive chat-process turn — keep the client warm. */
    protected override keepClientWarm(): boolean {
        return true;
    }

    protected async buildModeOptions(
        task: QueuedTask,
        prompt: string,
        _workingDirectory: string | undefined,
    ): Promise<ChatModeAIOptions> {
        const payload = task.payload as unknown as ChatPayload;

        const processId = toQueueProcessId(task.id);
        const loopDeps = this.buildLoopToolDeps(processId);

        // Autopilot explicitly opts out of Memory V2 — it operates in full-access
        // mode without per-session memory scoping.
        const ctx = await buildChatTurnContext({
            dataDir: this.dataDir,
            store: this.store,
            workspaceId: payload.workspaceId,
            processId,
            query: prompt,
            followUpSuggestions: this.followUpSuggestions,
            broadcastWorkItem: this.getWsServerFn
                ? (event) => this.getWsServerFn!()?.broadcastProcessEvent(event as any)
                : undefined,
            enqueueChat: this.getEnqueueChat?.(),
            scheduleWakeup: loopDeps.scheduleWakeup,
            loopTools: loopDeps.loopTools,
            includeMemoryV2: false,
        });

        const systemMessage = await systemMessageBuilder()
            .appendGlobalSystemPrompt(this.resolveGlobalSystemPrompt())
            .append(buildSourceLocationMarkdownLinkSystemMessage(payload.provider ?? this.provider)?.content)
            .appendToolGuidance(ctx.toolGuidance)
            .build();

        return {
            agentMode: 'autopilot' as AgentMode,
            systemMessage,
            tools: ctx.tools,
            effectivePrompt: prompt,
            dispose: ctx.dispose,
        };
    }
}
