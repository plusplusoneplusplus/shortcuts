/**
 * Autopilot Executor
 *
 * Concrete executor for `autopilot`-mode chat tasks.
 *
 * Extends ChatBaseExecutor to supply autopilot-mode specific AI options:
 * - agentMode: 'autopilot'
 * - systemMessage: undefined (no read-only restriction — full read/write access)
 * - tools: follow-up suggestion tool (when configured)
 */

import type {
    AgentMode,
    ProcessStore,
    QueuedTask,
} from '@plusplusoneplusplus/forge';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import { systemMessageBuilder } from './system-message-builder';
import type { ChatPayload } from '../tasks/task-types';
import type { ChatModeAIOptions, ChatModeExecutorOptions } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';
import { buildChatTurnContext } from './chat-turn-context-builder';
import { buildSourceLocationMarkdownLinkSystemMessage } from './prompt-builder';

// ============================================================================
// AutopilotExecutor
// ============================================================================

/**
 * No extra members: the WebSocket accessor arrives through
 * `ChatModeExecutorOptions.runtime`.
 */
export type AutopilotExecutorOptions = ChatModeExecutorOptions;

export class AutopilotExecutor extends ChatBaseExecutor {

    constructor(store: ProcessStore, options: AutopilotExecutorOptions, dataDir?: string) {
        super(store, options, dataDir);
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
        const cronDeps = this.buildCronToolDeps(processId);

        // Autopilot explicitly opts out of Memory V2 — it operates in full-access
        // mode without per-session memory scoping.
        const ctx = await buildChatTurnContext({
            dataDir: this.dataDir,
            store: this.store,
            workspaceId: payload.workspaceId,
            processId,
            query: prompt,
            followUpSuggestions: this.followUpSuggestions,
            enqueueChat: this.runtime.getEnqueueChat?.(),
            sendMessage: this.runtime.getSendMessage?.(),
            sendToConversationRuntime: this.runtime.getSendToConversationRuntime?.(),
            scheduleWakeup: cronDeps.scheduleWakeup,
            cronTools: cronDeps.cronTools,
            // Registered in autopilot too, so the tool block is identical to
            // ask mode and a mid-chat mode switch does not invalidate the
            // conversation's prefix cache. An autopilot chat open in the
            // dashboard is attended, so the question is answerable.
            askUser: this.buildAskUserWiring(processId, {
                computeTurnIndex: () => 1,
                isInteractive: () => true,
            }),
            includeMemoryV2: false,
        });
        // Without this, POST /api/processes/:id/ask-user-response has nothing
        // to resolve against and the question hangs.
        this.setAskUserHandles(processId, {
            answerQuestion: ctx.askUser!.answerQuestion,
            skipQuestion: ctx.askUser!.skipQuestion,
            answerQuestions: ctx.askUser!.answerQuestions,
            cancelAll: ctx.askUser!.cancelAll,
            hasPending: ctx.askUser!.hasPending,
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
