/**
 * Chat Executor
 *
 * Concrete executor for `ask`-mode chat tasks.
 *
 * Extends ChatBaseExecutor to supply ask-mode specific AI options:
 * - agentMode: 'interactive'
 * - systemMessage: READ_ONLY_SYSTEM_MESSAGE + optional auto-folder location block
 * - tools: follow-up suggestion tool (when configured)
 */

import type { ProcessStore, QueuedTask } from '@plusplusoneplusplus/forge';
import type { ChatModeAIOptions, ChatModeExecutorOptions } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';

// ============================================================================
// ChatExecutor
// ============================================================================

/**
 * No extra members: the WebSocket accessor arrives through
 * `ChatModeExecutorOptions.runtime`.
 */
export type ChatExecutorOptions = ChatModeExecutorOptions;

export class ChatExecutor extends ChatBaseExecutor {

    constructor(store: ProcessStore, options: ChatExecutorOptions, dataDir?: string) {
        super(store, options, dataDir);
    }

    /** Manual ask-mode chat is an interactive turn — keep the client warm. */
    protected override keepClientWarm(): boolean {
        return true;
    }

    protected async buildModeOptions(
        task: QueuedTask,
        prompt: string,
        workingDirectory: string | undefined,
    ): Promise<ChatModeAIOptions> {
        return this.buildStandardModeOptions(
            task,
            prompt,
            'ask',
            workingDirectory,
        );
    }
}
