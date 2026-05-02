/**
 * Plan Executor
 *
 * Concrete executor for `plan`-mode chat tasks.
 *
 * Extends ChatBaseExecutor to supply plan-mode specific AI options:
 * - agentMode: 'plan'
 * - systemMessage: READ_ONLY_SYSTEM_MESSAGE + auto-folder location block (AI
 *   proposes changes but may write plan files to the tasks directory)
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
import type { ChatPayload } from '../tasks/task-types';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import {
    buildModeSystemMessage,
    buildBoundedMemoryAddon,
    buildFollowUpSuggestionsAddon,
    buildSearchConversationsAddon,
    buildAskUserAddon,
    buildCreateWorkItemAddon,
    buildTavilyWebSearchAddon,
    applyLlmToolPreferences,
} from './prompt-builder';
import { systemMessageBuilder } from './system-message-builder';
import { readEffectiveDisabledLlmTools } from '../preferences-handler';
import type { ChatModeAIOptions, ChatModeExecutorOptions } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';

// ============================================================================
// PlanExecutor
// ============================================================================

export interface PlanExecutorOptions extends ChatModeExecutorOptions {
    getWsServer?: () => ProcessWebSocketServer | undefined;
}

export class PlanExecutor extends ChatBaseExecutor {
    private readonly getWsServerFn?: () => ProcessWebSocketServer | undefined;

    constructor(store: ProcessStore, options: PlanExecutorOptions, dataDir?: string) {
        super(store, options, dataDir);
        this.getWsServerFn = options.getWsServer;
    }

    protected async buildModeOptions(
        task: QueuedTask,
        prompt: string,
        workingDirectory: string | undefined,
    ): Promise<ChatModeAIOptions> {
        const payload = task.payload as unknown as ChatPayload;

        let autoFolderContext = undefined;
        if (workingDirectory) {
            autoFolderContext = await this.buildAutoFolderContext(
                workingDirectory,
                payload.workspaceId,
                true,
            );
        }

        const boundedMemory = await buildBoundedMemoryAddon(this.dataDir, payload.workspaceId, this.buildCaptureContext(task));
        const notePath = payload.context?.noteChat?.notePath;
        const systemMessage = await systemMessageBuilder()
            .append(buildModeSystemMessage('plan')?.content)
            .withRepoInstructions(workingDirectory, 'plan')
            .appendMemory(boundedMemory)
            .appendAutoFolder(autoFolderContext)
            .appendNoteFile(notePath)
            .build();

        const followUp = buildFollowUpSuggestionsAddon(
            this.followUpSuggestions.enabled,
            this.followUpSuggestions.count,
        );
        const searchConversations = buildSearchConversationsAddon(this.store, payload.workspaceId, toQueueProcessId(task.id));
        const createWorkItem = buildCreateWorkItemAddon(
            this.dataDir,
            payload.workspaceId,
            this.getWsServerFn
                ? (event) => this.getWsServerFn!()?.broadcastProcessEvent(event as any)
                : undefined,
        );
        const tavilySearch = buildTavilyWebSearchAddon(this.dataDir);

        const processId = toQueueProcessId(task.id);
        const askUser = buildAskUserAddon(this.askUser.enabled, {
            emitQuestion: (questionPayload) => {
                this.store.emitProcessEvent(processId, {
                    type: 'ask-user',
                    askUser: questionPayload,
                });
            },
            computeTurnIndex: () => 1,
        });
        const session = this.getOrCreateSession(processId);
        session.pendingAskUser = {
            answerQuestion: askUser.answerQuestion,
            skipQuestion: askUser.skipQuestion,
            cancelAll: askUser.cancelAll,
            hasPending: askUser.hasPending,
        };

        const disabledLlmTools = this.dataDir && payload.workspaceId
            ? readEffectiveDisabledLlmTools(this.dataDir, payload.workspaceId)
            : undefined;

        const { tools, suffix } = applyLlmToolPreferences(
            [followUp, searchConversations, askUser, createWorkItem, tavilySearch, boundedMemory],
            disabledLlmTools,
        );

        return {
            agentMode: 'plan' as AgentMode,
            systemMessage,
            tools,
            effectivePrompt: prompt + suffix,
            dispose: boundedMemory.dispose,
        };
    }
}
