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
import {
    buildFollowUpSuggestionsAddon,
} from './prompt-builder';
import type { ChatModeAIOptions, ChatModeExecutorOptions } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';

// ============================================================================
// AutopilotExecutor
// ============================================================================

export type AutopilotExecutorOptions = ChatModeExecutorOptions;

export class AutopilotExecutor extends ChatBaseExecutor {
    constructor(store: ProcessStore, options: AutopilotExecutorOptions, dataDir?: string) {
        super(store, options, dataDir);
    }

    protected async buildModeOptions(
        task: QueuedTask,
        prompt: string,
        _workingDirectory: string | undefined,
    ): Promise<ChatModeAIOptions> {
        const { tools, suffix } = buildFollowUpSuggestionsAddon(
            this.followUpSuggestions.enabled,
            this.followUpSuggestions.count,
        );

        return {
            agentMode: 'autopilot' as AgentMode,
            systemMessage: undefined,
            tools,
            effectivePrompt: prompt + suffix,
        };
    }
}
