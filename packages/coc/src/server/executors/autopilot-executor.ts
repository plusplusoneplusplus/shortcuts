/**
 * Autopilot Executor
 *
 * Concrete executor for `autopilot`-mode chat tasks.
 *
 * The turn itself is built by `ChatBaseExecutor.buildStandardModeOptions`,
 * shared with ask mode: the tool bundle, the system message, and the context
 * build are identical in both modes, so a chat that starts in autopilot and
 * later switches to ask does not rewrite its cached prefix. Only `agentMode`,
 * the ask-only plan-save / Ralph-grill contracts, and `ask_user`
 * interactivity vary — see that method for the full list.
 *
 * Autopilot emits no mode-transition note on turn 1 — there is nothing to say
 * until the chat has actually been in ask mode (see `chat-mode-directive.ts`).
 */

import type { ProcessStore, QueuedTask } from '@plusplusoneplusplus/forge';
import type { ChatModeAIOptions, ChatModeExecutorOptions } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';

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
        return this.buildStandardModeOptions(task, prompt, 'autopilot', workingDirectory);
    }
}
