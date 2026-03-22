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
import type { ChatPayload } from '../task-types';
import {
    buildModeSystemMessage,
    withRepoInstructions,
    buildFollowUpSuggestionsAddon,
} from './prompt-builder';
import type { ChatModeAIOptions, ChatModeExecutorOptions } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';

// ============================================================================
// PlanExecutor
// ============================================================================

export type PlanExecutorOptions = ChatModeExecutorOptions;

export class PlanExecutor extends ChatBaseExecutor {
    constructor(store: ProcessStore, options: PlanExecutorOptions, dataDir?: string) {
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

        const systemMessage = await withRepoInstructions(
            buildModeSystemMessage('plan', autoFolderContext),
            workingDirectory,
            'plan',
        );

        const { tools, suffix } = buildFollowUpSuggestionsAddon(
            this.followUpSuggestions.enabled,
            this.followUpSuggestions.count,
        );

        return {
            agentMode: 'plan' as AgentMode,
            systemMessage,
            tools,
            effectivePrompt: prompt + suffix,
        };
    }
}
