/**
 * Autopilot Executor
 *
 * Concrete executor for `autopilot`-mode chat tasks.
 *
 * Extends ChatBaseExecutor to supply autopilot-mode specific AI options:
 * - agentMode: 'autopilot'
 * - systemMessage: strong directive to always use tools (never narrate-only)
 * - tools: update_task_status + search_conversations (NO follow-up suggestions)
 *
 * Follow-up suggestions are intentionally excluded from autopilot mode because
 * they prime the model to produce text-only responses, which causes the SDK
 * agentic loop to terminate prematurely.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type {
    AgentMode,
    ProcessStore,
    QueuedTask,
    SystemMessageConfig,
} from '@plusplusoneplusplus/forge';
import {
    appendMemoryContext,
    buildUpdateTaskStatusAddon,
    buildSearchConversationsAddon,
} from './prompt-builder';
import type { ChatPayload } from '../task-types';
import type { ChatModeAIOptions, ChatModeExecutorOptions } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';
import type { CopilotClientCache } from './copilot-client-cache';

// ============================================================================
// Autopilot System Message
// ============================================================================

/**
 * System message for autopilot mode that instructs the model to always
 * complete work via tool calls rather than narrating intent.
 */
export const AUTOPILOT_SYSTEM_MESSAGE =
    'You are in autonomous execution mode. You MUST complete the task entirely using tool calls. ' +
    'NEVER respond with only text describing what you plan to do — always follow through with the actual tool calls. ' +
    'If you need to create files, edit code, run commands, or commit changes, use the appropriate tools immediately. ' +
    'Do not stop until the task is fully complete, including any final steps like committing changes or running tests.';

// ============================================================================
// AutopilotExecutor
// ============================================================================

export type AutopilotExecutorOptions = ChatModeExecutorOptions;

export class AutopilotExecutor extends ChatBaseExecutor {
    constructor(store: ProcessStore, options: AutopilotExecutorOptions, dataDir?: string, clientCache?: CopilotClientCache) {
        super(store, options, dataDir, clientCache);
    }

    protected async buildModeOptions(
        task: QueuedTask,
        prompt: string,
        _workingDirectory: string | undefined,
    ): Promise<ChatModeAIOptions> {
        const payload = task.payload as unknown as ChatPayload;
        const hasPlanFile = (payload.context?.files?.length ?? 0) > 1;

        const updateStatus = buildUpdateTaskStatusAddon(hasPlanFile);
        const searchConversations = buildSearchConversationsAddon(this.store, payload.workspaceId);

        // Build system message: autopilot directive + memory context
        const baseSystemMessage: SystemMessageConfig = { mode: 'append' as const, content: AUTOPILOT_SYSTEM_MESSAGE };
        const systemMessage = appendMemoryContext(baseSystemMessage, this.dataDir, payload.workspaceId);

        return {
            agentMode: 'autopilot' as AgentMode,
            systemMessage,
            tools: [...updateStatus.tools, ...searchConversations.tools],
            effectivePrompt: prompt + updateStatus.suffix + searchConversations.suffix,
        };
    }
}
