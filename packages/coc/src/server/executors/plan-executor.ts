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
import type { ProcessWebSocketServer } from '../websocket';
import {
    buildModeSystemMessage,
    appendAutoFolderBlock,
    appendBoundedMemoryContext,
    buildBoundedMemoryAddon,
    withRepoInstructions,
    buildFollowUpSuggestionsAddon,
    buildUpdateTaskStatusAddon,
    buildSearchConversationsAddon,
    buildAskUserAddon,
    buildCreateWorkItemAddon,
} from './prompt-builder';
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
            );
        }

        const boundedMemory = await buildBoundedMemoryAddon(this.dataDir, payload.workspaceId);
        const systemMessage = appendAutoFolderBlock(
            appendBoundedMemoryContext(
                await withRepoInstructions(
                    buildModeSystemMessage('plan'),
                    workingDirectory,
                    'plan',
                ),
                boundedMemory,
            ),
            autoFolderContext,
        );

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

        return {
            agentMode: 'plan' as AgentMode,
            systemMessage,
            tools: [...followUp.tools, ...updateStatus.tools, ...searchConversations.tools, ...askUser.tools, ...createWorkItem.tools, ...boundedMemory.tools],
            effectivePrompt: prompt + followUp.suffix + updateStatus.suffix + searchConversations.suffix + askUser.suffix + createWorkItem.suffix + boundedMemory.suffix,
        };
    }
}
