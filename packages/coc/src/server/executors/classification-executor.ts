/**
 * Classification Executor
 *
 * Concrete executor for PR diff classification chat tasks. Dispatched when
 * `payload.context.classifyDiff` is present (see `hasClassifyDiffContext`).
 *
 * Extends ChatBaseExecutor to inject a per-invocation `saveClassification`
 * tool pre-bound with the (workspaceId, repoId, prId, headSha) tuple. The
 * AI calls the tool with the final per-hunk classifications and the handler
 * writes them to the file-based classification store.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type {
    AgentMode,
    ProcessStore,
    QueuedTask,
    Tool,
} from '@plusplusoneplusplus/forge';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { ChatPayload } from '../tasks/task-types';
import type { ChatModeAIOptions, ChatModeExecutorOptions } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';
import {
    buildFollowUpSuggestionsAddon,
    buildMemoryReadToolsAddon,
    buildSearchConversationsAddon,
    buildTavilyWebSearchAddon,
    applyLlmToolPreferences,
} from './prompt-builder';
import { systemMessageBuilder } from './system-message-builder';
import { readEffectiveDisabledLlmTools } from '../preferences-handler';
import { createSaveClassificationTool } from '../llm-tools/save-classification-tool';

const SAVE_CLASSIFICATION_SUFFIX =
    '\n\nIMPORTANT: After you have classified every `@@` hunk, call the `saveClassification` tool ' +
    'EXACTLY ONCE with the full array of per-hunk classifications. ' +
    'Do NOT print the classifications as JSON or markdown in your response — the persistence layer ' +
    'reads them directly from the tool call. Only call the tool after you have inspected every hunk.';

export class ClassificationExecutor extends ChatBaseExecutor {
    constructor(
        store: ProcessStore,
        options: ChatModeExecutorOptions,
        dataDir?: string,
    ) {
        super(store, options, dataDir);
    }

    protected async buildModeOptions(
        task: QueuedTask,
        prompt: string,
        workingDirectory: string | undefined,
    ): Promise<ChatModeAIOptions> {
        const payload = task.payload as unknown as ChatPayload;
        const classifyDiff = payload.context?.classifyDiff;
        const wsId = payload.workspaceId;
        const processId = toQueueProcessId(task.id);

        const boundedMemory = await this.buildMemoryAddon(wsId, this.buildCaptureContext(task), prompt);
        const systemMessage = await systemMessageBuilder()
            .withRepoInstructions(workingDirectory, 'autopilot')
            .appendMemory(boundedMemory)
            .build();

        const tools: Tool<unknown>[] = [];
        let toolSuffix = '';

        if (this.dataDir && wsId && classifyDiff?.repoId && classifyDiff?.prId && classifyDiff?.headSha) {
            const { tool } = createSaveClassificationTool({
                dataDir: this.dataDir,
                workspaceId: wsId,
                repoId: classifyDiff.repoId,
                prId: classifyDiff.prId,
                headSha: classifyDiff.headSha,
                processId,
            });
            tools.push(tool);
            toolSuffix += SAVE_CLASSIFICATION_SUFFIX;
        }

        // Standard chat tools (search, memory, etc.) — same pattern as other executors.
        const followUp = buildFollowUpSuggestionsAddon(
            this.followUpSuggestions.enabled,
            this.followUpSuggestions.count,
        );
        const searchConversations = buildSearchConversationsAddon(this.store, wsId, processId);
        const tavilySearch = buildTavilyWebSearchAddon(this.dataDir);
        const memoryReadTools = buildMemoryReadToolsAddon(this.dataDir, wsId);

        const disabledLlmTools = this.dataDir && wsId
            ? readEffectiveDisabledLlmTools(this.dataDir, wsId)
            : undefined;

        const { tools: filteredTools, suffix: filteredSuffix } = applyLlmToolPreferences(
            [followUp, searchConversations, tavilySearch, memoryReadTools, boundedMemory],
            disabledLlmTools,
        );

        tools.push(...filteredTools);
        toolSuffix += filteredSuffix;

        return {
            agentMode: 'autopilot' as AgentMode,
            systemMessage,
            tools,
            effectivePrompt: prompt + toolSuffix,
            dispose: boundedMemory.dispose,
        };
    }
}
