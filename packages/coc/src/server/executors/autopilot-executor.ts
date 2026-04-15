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
    appendMemoryContext,
    buildFollowUpSuggestionsAddon,
    buildUpdateTaskStatusAddon,
    buildSearchConversationsAddon,
} from './prompt-builder';
import type { ChatPayload } from '../task-types';
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
        const payload = task.payload as unknown as ChatPayload;
        const hasPlanFile = (payload.context?.files?.length ?? 0) > 1;

        const followUp = buildFollowUpSuggestionsAddon(
            this.followUpSuggestions.enabled,
            this.followUpSuggestions.count,
        );
        const updateStatus = buildUpdateTaskStatusAddon(hasPlanFile);
        const searchConversations = buildSearchConversationsAddon(this.store, payload.workspaceId);

        return {
            agentMode: 'autopilot' as AgentMode,
            systemMessage: appendMemoryContext(undefined, this.dataDir, payload.workspaceId),
            tools: [...followUp.tools, ...updateStatus.tools, ...searchConversations.tools],
            effectivePrompt: prompt + followUp.suffix + updateStatus.suffix + searchConversations.suffix,
        };
    }
}
