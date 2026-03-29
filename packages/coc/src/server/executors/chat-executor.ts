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
import type { ChatPayload } from '../task-types';
import {
    buildModeSystemMessage,
    appendAutoFolderBlock,
    withRepoInstructions,
    buildFollowUpSuggestionsAddon,
} from './prompt-builder';
import type { ChatModeAIOptions, ChatModeExecutorOptions } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';

// ============================================================================
// ChatExecutor
// ============================================================================

export type ChatExecutorOptions = ChatModeExecutorOptions;

export class ChatExecutor extends ChatBaseExecutor {
    constructor(store: ProcessStore, options: ChatExecutorOptions, dataDir?: string) {
        super(store, options, dataDir);
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
            await withRepoInstructions(
                buildModeSystemMessage('ask'),
                workingDirectory,
                'ask',
            ),
            autoFolderContext,
        );

        const { tools, suffix } = buildFollowUpSuggestionsAddon(
            this.followUpSuggestions.enabled,
            this.followUpSuggestions.count,
        );

        return {
            agentMode: 'interactive' as AgentMode,
            systemMessage,
            tools,
            effectivePrompt: prompt + suffix,
        };
    }
}
