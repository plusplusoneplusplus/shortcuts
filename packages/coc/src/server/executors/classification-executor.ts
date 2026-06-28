/**
 * Classification Executor
 *
 * Concrete executor for PR diff classification tasks. Dispatched for
 * `pr-classification` tasks (first-class) or legacy chat tasks carrying
 * `payload.context.classifyDiff`.
 *
 * Extends ChatBaseExecutor to inject a per-invocation `saveClassification`
 * tool pre-bound with the (workspaceId, repoId, origin storage scope, prId,
 * headSha) tuple. The AI calls the tool with the final per-hunk classifications
 * and the handler writes them to the file-based classification store.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type {
    AgentMode,
    ProcessStore,
    QueuedTask,
} from '@plusplusoneplusplus/forge';
import type { Tool } from '@plusplusoneplusplus/coc-agent-sdk';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { ChatPayload, PrClassificationPayload } from '../tasks/task-types';
import { isPrClassificationPayload, isChatPayload } from '../tasks/task-types';
import type { ChatModeAIOptions, ChatModeExecutorOptions } from './chat-base-executor';
import { ChatBaseExecutor } from './chat-base-executor';
import {
    buildFollowUpSuggestionsAddon,
    buildSearchConversationsAddon,
    buildTavilyWebSearchAddon,
    buildModeSystemMessage,
    applyLlmToolPreferences,
    buildSourceLocationMarkdownLinkSystemMessage,
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
        const ctx = resolveClassificationContext(task.payload as Record<string, unknown>);
        const wsId = ctx.workspaceId;
        const processId = toQueueProcessId(task.id);

        const tools: Tool<unknown>[] = [];
        let toolGuidance = '';

        if (this.dataDir && wsId && ctx.repoId && ctx.prId && ctx.headSha) {
            const { tool } = createSaveClassificationTool({
                dataDir: this.dataDir,
                workspaceId: wsId,
                repoId: ctx.repoId,
                prId: ctx.prId,
                headSha: ctx.headSha,
                processId,
                storageScope: ctx.classificationStorageOriginId,
            });
            tools.push(tool);
            toolGuidance += SAVE_CLASSIFICATION_SUFFIX;
        }

        // Standard chat tools (search, memory, etc.) — same pattern as other executors.
        const followUp = buildFollowUpSuggestionsAddon(
            this.followUpSuggestions.enabled,
            this.followUpSuggestions.count,
        );
        const searchConversations = buildSearchConversationsAddon(this.store, wsId, processId);
        const tavilySearch = buildTavilyWebSearchAddon(this.dataDir);

        const disabledLlmTools = this.dataDir && wsId
            ? readEffectiveDisabledLlmTools(this.dataDir, wsId)
            : undefined;

        const { tools: filteredTools, toolGuidance: filteredGuidance } = applyLlmToolPreferences(
            [followUp, searchConversations, tavilySearch],
            disabledLlmTools,
        );

        tools.push(...filteredTools);
        toolGuidance += filteredGuidance;

        const systemMessage = await systemMessageBuilder()
            .append(buildModeSystemMessage('ask')?.content)
            .appendGlobalSystemPrompt(this.resolveGlobalSystemPrompt())
            .withRepoInstructions(workingDirectory, 'ask')
            .append(buildSourceLocationMarkdownLinkSystemMessage(readProvider(task.payload, this.provider))?.content)
            .appendToolGuidance(toolGuidance)
            .build();

        return {
            agentMode: 'interactive' as AgentMode,
            systemMessage,
            tools,
            effectivePrompt: prompt,
            dispose: undefined,
        };
    }
}

/**
 * Resolve classification context from either the first-class PrClassificationPayload
 * or the legacy ChatPayload with `context.classifyDiff`.
 */
function resolveClassificationContext(payload: Record<string, unknown>): {
    workspaceId?: string;
    repoId?: string;
    classificationStorageOriginId?: string;
    prId?: string;
    headSha?: string;
} {
    if (isPrClassificationPayload(payload)) {
        const p = payload as unknown as PrClassificationPayload;
        return {
            workspaceId: p.workspaceId,
            repoId: p.repoId,
            classificationStorageOriginId: p.classificationStorageOriginId,
            prId: p.prId,
            headSha: p.headSha,
        };
    }

    if (isChatPayload(payload)) {
        const p = payload as unknown as ChatPayload;
        return {
            workspaceId: p.workspaceId,
            repoId: p.context?.classifyDiff?.repoId,
            prId: p.context?.classifyDiff?.prId,
            headSha: p.context?.classifyDiff?.headSha,
        };
    }
    return {};
}

function readProvider(payload: unknown, fallback: 'copilot' | 'codex' | 'claude'): 'copilot' | 'codex' | 'claude' {
    if (payload && typeof payload === 'object') {
        const provider = (payload as { provider?: unknown }).provider;
        if (provider === 'copilot' || provider === 'codex' || provider === 'claude') {
            return provider;
        }
    }
    return fallback;
}
