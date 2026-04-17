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
    appendAutoFolderBlock,
    appendMemoryContext,
    withRepoInstructions,
    buildFollowUpSuggestionsAddon,
    buildUpdateTaskStatusAddon,
    buildSearchConversationsAddon,
    buildCreateWorkItemAddon,
} from './prompt-builder';
import type { ChatModeAIOptions, ChatModeExecutorOptions } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';

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

        const systemMessage = appendAutoFolderBlock(
            appendMemoryContext(
                await withRepoInstructions(
                    buildModeSystemMessage('ask'),
                    workingDirectory,
                    'ask',
                ),
                this.dataDir,
                payload.workspaceId,
            ),
            autoFolderContext,
        );

        const hasPlanFile = (payload.context?.files?.length ?? 0) > 1;
        const followUp = buildFollowUpSuggestionsAddon(
            this.followUpSuggestions.enabled,
            this.followUpSuggestions.count,
        );
        const updateStatus = buildUpdateTaskStatusAddon(hasPlanFile);
        const searchConversations = buildSearchConversationsAddon(this.store, payload.workspaceId);
        const createWorkItem = buildCreateWorkItemAddon(
            this.dataDir,
            payload.workspaceId,
            this.getWsServerFn
                ? (event) => this.getWsServerFn!()?.broadcastProcessEvent(event as any)
                : undefined,
        );

        return {
            agentMode: 'interactive' as AgentMode,
            systemMessage,
            tools: [...followUp.tools, ...updateStatus.tools, ...searchConversations.tools, ...createWorkItem.tools],
            effectivePrompt: prompt + followUp.suffix + updateStatus.suffix + searchConversations.suffix + createWorkItem.suffix,
        };
    }
}
