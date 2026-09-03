/**
 * Autopilot Executor
 *
 * Concrete executor for `autopilot`-mode chat tasks.
 *
 * Extends ChatBaseExecutor to supply autopilot-mode specific AI options:
 * - agentMode: 'autopilot'
 * - systemMessage: the shared, mode-invariant first-turn message (identical to
 *   the one an ask-mode first turn builds, so a chat that starts in autopilot
 *   and later switches to ask does not rewrite its cached prefix)
 * - tools: follow-up suggestion tool (when configured)
 *
 * Autopilot emits no mode directive on turn 1 — there is nothing to say until
 * the chat has actually been in ask mode (see `chat-mode-directive.ts`).
 */

import type {
    AgentMode,
    AutoFolderContext,
    ProcessStore,
    QueuedTask,
} from '@plusplusoneplusplus/forge';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { ChatPayload } from '../tasks/task-types';
import type { ChatModeAIOptions, ChatModeExecutorOptions } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';
import { buildChatTurnContext } from './chat-turn-context-builder';
import { buildChatModeDirective, loadChatModeInstructions, prependChatModeDirective } from './chat-mode-directive';

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
        workingDirectory: string | undefined,
    ): Promise<ChatModeAIOptions> {
        const payload = task.payload as unknown as ChatPayload;

        const processId = toQueueProcessId(task.id);
        // Same save-location block the ask path resolves, for the same reason:
        // the block is mode-invariant, so both first-turn builders must produce it.
        const autoFolderContext: AutoFolderContext | undefined = workingDirectory
            ? await this.buildAutoFolderContext(workingDirectory, payload.workspaceId)
            : undefined;
        const cronDeps = this.buildCronToolDeps(processId);

        // Autopilot explicitly opts out of Memory V2 — it operates in full-access
        // mode without per-session memory scoping. This is the one block that
        // still differs between the two first-turn builders; it costs nothing
        // today because the Memory V2 recall block is rebuilt from each turn's
        // query anyway, so a memory-enabled chat has no stable prefix to lose.
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

        const systemMessage = await this.buildFirstTurnSystemMessage({
            task,
            workingDirectory,
            autoFolderContext,
            memoryV2: ctx.memoryV2,
            toolGuidance: ctx.toolGuidance,
            askUserAvailable: this.askUserSurvivedFiltering(ctx.tools),
        });

        const effectivePrompt = prependChatModeDirective(
            prompt,
            buildChatModeDirective({
                mode: 'autopilot',
                modeInstructions: await loadChatModeInstructions(workingDirectory, 'autopilot'),
            }),
        );

        return {
            agentMode: 'autopilot' as AgentMode,
            systemMessage,
            tools: ctx.tools,
            effectivePrompt,
            dispose: ctx.dispose,
        };
    }
}
