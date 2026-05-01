/**
 * Chat Executor
 *
 * Concrete executor for `ask`-mode chat tasks.
 *
 * Extends ChatBaseExecutor to supply ask-mode specific AI options:
 * - agentMode: 'interactive'
 * - systemMessage: READ_ONLY_SYSTEM_MESSAGE + optional auto-folder location block
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
import type { ProcessWebSocketServer } from '../websocket';
import type { ChatPayload } from '../task-types';
import {
    buildModeSystemMessage,
    buildBoundedMemoryAddon,
    buildFollowUpSuggestionsAddon,
    buildUpdateTaskStatusAddon,
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
// ChatExecutor
// ============================================================================

export interface ChatExecutorOptions extends ChatModeExecutorOptions {
    getWsServer?: () => ProcessWebSocketServer | undefined;
}

export class ChatExecutor extends ChatBaseExecutor {
    private readonly getWsServerFn?: () => ProcessWebSocketServer | undefined;

    constructor(store: ProcessStore, options: ChatExecutorOptions, dataDir?: string) {
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
            );
        }

        const boundedMemory = await buildBoundedMemoryAddon(this.dataDir, payload.workspaceId, this.buildCaptureContext(task));
        const notePath = payload.context?.noteChat?.notePath;
        const systemMessage = await systemMessageBuilder()
            .append(buildModeSystemMessage('ask')?.content)
            .withRepoInstructions(workingDirectory, 'ask')
            .appendMemory(boundedMemory)
            .appendAutoFolder(autoFolderContext)
            .appendNoteFile(notePath)
            .build();

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

        const processId = toQueueProcessId(task.id);
        const askUser = buildAskUserAddon(false, {
            emitQuestion: (questionPayload) => {
                this.store.emitProcessEvent(processId, {
                    type: 'ask-user',
                    askUser: questionPayload,
                });
            },
            computeTurnIndex: () => 1,
        });
        // Store ask-user handles on the session so API endpoint can resolve answers
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
            [followUp, updateStatus, searchConversations, askUser, createWorkItem, tavilySearch, boundedMemory],
            disabledLlmTools,
        );

        return {
            agentMode: 'interactive' as AgentMode,
            systemMessage,
            tools,
            effectivePrompt: prompt + suffix,
            dispose: boundedMemory.dispose,
        };
    }
}
