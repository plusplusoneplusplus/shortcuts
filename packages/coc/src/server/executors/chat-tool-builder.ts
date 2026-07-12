import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { Tool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { BroadcastWorkItemFn } from '../llm-tools/create-update-work-item-tool';
import type { EnqueueChatFn, SendMessageFn, SendToConversationRuntimeOptions } from '../llm-tools/send-to-conversation-tool';
import type { AskUserToolDeps } from '../llm-tools/ask-user-tool';
import type { WakeupToolDeps, LoopToolDeps } from '../llm-tools/loop-tools';
import { DEFAULT_DISABLED_LLM_TOOLS } from '../llm-tools/llm-tool-registry';
import { readEffectiveDisabledLlmTools } from '../preferences-handler';
import type { MemoryV2Addon } from './memory-v2-addon';
import {
    applyLlmToolPreferences,
    buildAskUserAddon,
    buildCanvasToolsAddon,
    buildSendToConversationAddon,
    buildCreateWorkItemAddon,
    buildFollowUpSuggestionsAddon,
    buildLoopToolsAddon,
    buildScheduleWakeupAddon,
    buildSearchConversationsAddon,
    buildTavilyWebSearchAddon,
} from './prompt-builder';

type ToolAddon = { tools: Tool<any>[]; suffix: string };
type AskUserAddon = ReturnType<typeof buildAskUserAddon>;

export interface ChatToolBundleOptions {
    dataDir?: string;
    store: ProcessStore;
    workspaceId?: string;
    /**
     * Bound in-process enqueue capability. When present (and the tool is enabled
     * by preferences), the `send_to_conversation` tool is included so an
     * agent can spawn a brand-new chat. Absent → the addon no-ops.
     */
    enqueueChat?: EnqueueChatFn;
    /**
     * Bound in-process follow-up delivery capability. Enables the post mode of
     * `send_to_conversation` (posting into an existing conversation). Optional.
     */
    sendMessage?: SendMessageFn;
    /** Runtime provider/tier helpers used by send_to_conversation. */
    sendToConversationRuntime?: SendToConversationRuntimeOptions;
    processId?: string;
    followUpSuggestions?: { enabled: boolean; count: number };
    askUser?: {
        enabled: boolean;
        deps: AskUserToolDeps;
    };
    broadcastWorkItem?: BroadcastWorkItemFn;
    /** Memory V2 addon (redesigned coc-memory system). */
    memoryV2?: MemoryV2Addon;
    scheduleWakeup?: WakeupToolDeps;
    loopTools?: LoopToolDeps;
    includeFollowUpSuggestions?: boolean;
    includeSearchConversations?: boolean;
    includeWorkItemTools?: boolean;
    includeTavilyWebSearch?: boolean;
    includeScheduleWakeup?: boolean;
    includeCanvasTools?: boolean;
    /** Overrides the `canvas.enabled` config flag (used by tests). */
    canvasToolsEnabled?: boolean;
    excludeTools?: string[];
}

export interface ChatToolBundle {
    tools: Tool<any>[];
    /**
     * Aggregated LLM-tool-guidance prose. Callers route this into the
     * system message via `systemMessageBuilder().appendToolGuidance(...)`
     * rather than appending it to the user prompt.
     */
    toolGuidance: string;
    askUser?: AskUserAddon;
}

/**
 * Low-level tool assembly for a single chat turn.
 *
 * **Prefer `buildChatTurnContext()` for executor code.** That wrapper calls
 * this function internally and additionally wires Memory V2 tools, Memory V2
 * prompt context, SDK built-in exclusions, and resource disposal into one
 * cohesive object so callers do not have to coordinate those artifacts manually.
 *
 * Use `buildChatToolBundle` directly only in `buildChatTurnContext` itself and
 * in its unit tests.
 */
export function buildChatToolBundle(options: ChatToolBundleOptions): ChatToolBundle {
    const addons: ToolAddon[] = [];

    if (options.includeFollowUpSuggestions !== false && options.followUpSuggestions) {
        addons.push(buildFollowUpSuggestionsAddon(
            options.followUpSuggestions.enabled,
            options.followUpSuggestions.count,
        ));
    }

    if (options.includeSearchConversations !== false) {
        addons.push(buildSearchConversationsAddon(
            options.store,
            options.workspaceId,
            options.processId,
        ));
    }

    if (options.enqueueChat) {
        addons.push(buildSendToConversationAddon(
            options.store,
            options.workspaceId,
            options.enqueueChat,
            options.processId,
            options.sendMessage,
            options.sendToConversationRuntime,
        ));
    }

    const askUser = options.askUser
        ? buildAskUserAddon(options.askUser.enabled, options.askUser.deps)
        : undefined;
    if (askUser) {
        addons.push(askUser);
    }

    if (options.includeWorkItemTools !== false) {
        addons.push(buildCreateWorkItemAddon(
            options.dataDir,
            options.workspaceId,
            options.broadcastWorkItem,
            { processStore: options.store },
        ));
    }

    if (options.includeTavilyWebSearch !== false) {
        addons.push(buildTavilyWebSearchAddon(options.dataDir));
    }

    if (options.includeScheduleWakeup !== false) {
        addons.push(buildScheduleWakeupAddon(options.scheduleWakeup));
    }

    if (options.loopTools) {
        addons.push(buildLoopToolsAddon(options.loopTools));
    }

    if (options.includeCanvasTools !== false) {
        addons.push(buildCanvasToolsAddon(
            options.dataDir,
            options.store,
            options.workspaceId,
            options.processId,
            options.canvasToolsEnabled !== undefined ? { enabled: options.canvasToolsEnabled } : undefined,
        ));
    }

    if (options.memoryV2) {
        addons.push(options.memoryV2);
    }

    const disabledLlmTools = options.dataDir && options.workspaceId
        ? readEffectiveDisabledLlmTools(options.dataDir, options.workspaceId)
        : undefined;
    const disabledWithContextExclusions = mergeDisabledTools(disabledLlmTools, options.excludeTools);
    const { tools, toolGuidance } = applyLlmToolPreferences(addons, disabledWithContextExclusions);

    return { tools, toolGuidance, askUser };
}

function mergeDisabledTools(
    disabledLlmTools: string[] | undefined,
    excludeTools: string[] | undefined,
): string[] | undefined {
    if (!excludeTools || excludeTools.length === 0) {
        return disabledLlmTools;
    }

    return Array.from(new Set([
        ...(disabledLlmTools ?? DEFAULT_DISABLED_LLM_TOOLS),
        ...excludeTools,
    ]));
}
