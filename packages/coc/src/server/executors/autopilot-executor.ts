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
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type {
    AgentMode,
    ProcessStore,
    QueuedTask,
} from '@plusplusoneplusplus/forge';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import {
    buildBoundedMemoryAddon,
    buildFollowUpSuggestionsAddon,
    buildUpdateTaskStatusAddon,
    buildSearchConversationsAddon,
    buildCreateWorkItemAddon,
    buildTavilyWebSearchAddon,
    applyLlmToolPreferences,
} from './prompt-builder';
import { systemMessageBuilder } from './system-message-builder';
import { readEffectiveDisabledLlmTools } from '../preferences-handler';
import type { ChatPayload } from '../tasks/task-types';
import type { ChatModeAIOptions, ChatModeExecutorOptions } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';

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

    protected async buildModeOptions(
        task: QueuedTask,
        prompt: string,
        _workingDirectory: string | undefined,
    ): Promise<ChatModeAIOptions> {
        const payload = task.payload as unknown as ChatPayload;
        const hasPlanFile = (payload.context?.files?.length ?? 0) > 1;

        const followUp = buildFollowUpSuggestionsAddon(
            this.followUpSuggestions.enabled,
            this.followUpSuggestions.count,
        );
        const updateStatus = buildUpdateTaskStatusAddon(hasPlanFile);
        const searchConversations = buildSearchConversationsAddon(this.store, payload.workspaceId, toQueueProcessId(task.id));
        const createWorkItem = buildCreateWorkItemAddon(
            this.dataDir,
            payload.workspaceId,
            this.getWsServerFn
                ? (event) => this.getWsServerFn!()?.broadcastProcessEvent(event as any)
                : undefined,
        );
        const tavilySearch = buildTavilyWebSearchAddon(this.dataDir);

        const boundedMemory = await buildBoundedMemoryAddon(this.dataDir, payload.workspaceId, this.buildCaptureContext(task));

        const disabledLlmTools = this.dataDir && payload.workspaceId
            ? readEffectiveDisabledLlmTools(this.dataDir, payload.workspaceId)
            : undefined;

        const { tools, suffix } = applyLlmToolPreferences(
            [followUp, updateStatus, searchConversations, createWorkItem, tavilySearch, boundedMemory],
            disabledLlmTools,
        );

        return {
            agentMode: 'autopilot' as AgentMode,
            systemMessage: await systemMessageBuilder().appendMemory(boundedMemory).build(),
            tools,
            effectivePrompt: prompt + suffix,
            dispose: boundedMemory.dispose,
        };
    }
}
