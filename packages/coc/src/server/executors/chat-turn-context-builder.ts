/**
 * Chat Turn Context Builder
 *
 * Centralizes common addon assembly for all chat-mode executor paths:
 * ask/plan (ChatBaseExecutor.buildStandardModeOptions), Ralph
 * (RalphExecutor.buildModeOptions), follow-up
 * (FollowUpExecutor.executeFollowUp), and optionally autopilot
 * (AutopilotExecutor.buildModeOptions).
 *
 * Returns one cohesive context object so callers do not need to
 * independently coordinate Memory V2 tools, Memory V2 prompt context,
 * SDK built-in exclusions, ask-user handles, and resource disposal.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { Tool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { BroadcastWorkItemFn } from '../llm-tools/create-work-item-tool';
import type { AskUserToolDeps } from '../llm-tools/ask-user-tool';
import type { WakeupToolDeps, LoopToolDeps } from '../llm-tools/loop-tools';
import type { MemoryV2Addon } from './memory-v2-addon';
import { buildMemoryV2Addon } from './memory-v2-addon';
import { buildChatToolBundle } from './chat-tool-builder';
import type { ChatToolBundle } from './chat-tool-builder';

// ============================================================================
// Types
// ============================================================================

export interface ChatTurnContextInput {
    dataDir?: string;
    store: ProcessStore;
    workspaceId?: string;
    processId?: string;
    /**
     * The current prompt/query text — used for per-turn memory recall.
     * Pass undefined to skip per-turn recall (frozen snapshot only).
     */
    query?: string;
    followUpSuggestions?: { enabled: boolean; count: number };
    broadcastWorkItem?: BroadcastWorkItemFn;
    scheduleWakeup?: WakeupToolDeps;
    loopTools?: LoopToolDeps;
    askUser?: {
        enabled: boolean;
        deps: AskUserToolDeps;
    };
    /** Additional tool names to exclude beyond workspace preferences. */
    excludeTools?: string[];
    /**
     * Whether to include Memory V2 tools and context in this turn.
     * Defaults to true. Set to false to explicitly opt out (e.g. autopilot).
     */
    includeMemoryV2?: boolean;
}

export interface ChatTurnContext {
    /** AI-callable tool definitions. */
    tools: Tool<any>[];
    /** Aggregated tool-guidance prose — route into system message via `appendToolGuidance`. */
    toolGuidance: string;
    /**
     * The resolved Memory V2 addon.
     * Use `.appendMemoryV2(ctx.memoryV2)` on the system message builder.
     * When Memory V2 is not enabled or opted out, this is a no-op empty addon.
     */
    memoryV2: MemoryV2Addon;
    /**
     * Built-in Copilot tool names to suppress for this session.
     * Pass as `excludedTools` to `aiService.sendMessage(...)` when non-empty.
     */
    excludedTools: string[];
    /** Ask-user addon handles (defined when askUser.enabled is true). */
    askUser?: ChatToolBundle['askUser'];
    /** Dispose all open resources (e.g. memory DB handles). Safe to call multiple times. */
    dispose: () => void;
}

// ============================================================================
// Empty addon — returned when Memory V2 is opted out or unavailable
// ============================================================================

const EMPTY_MEM_V2: MemoryV2Addon = Object.freeze({
    systemMessageSuffix: undefined,
    tools: [],
    suffix: '',
    excludedBuiltinTools: [],
    dispose: () => {},
});

// ============================================================================
// Builder
// ============================================================================

/**
 * Assemble the common chat-turn capability context for any executor path.
 *
 * This is the single source-of-truth for wiring Memory V2 tools, Memory V2
 * prompt context, SDK built-in exclusions, ask-user handles, and loop/work-item
 * tools into one cohesive object. Callers pass the returned `ChatTurnContext`
 * into their system message builder and `sendMessage` options rather than
 * assembling these artifacts individually.
 *
 * @example
 * ```typescript
 * const ctx = await buildChatTurnContext({
 *     dataDir: this.dataDir,
 *     store: this.store,
 *     workspaceId: payload.workspaceId,
 *     processId,
 *     query: prompt,
 *     followUpSuggestions: this.followUpSuggestions,
 *     broadcastWorkItem,
 *     scheduleWakeup: loopDeps.scheduleWakeup,
 *     loopTools: loopDeps.loopTools,
 * });
 *
 * try {
 *     const systemMessage = await systemMessageBuilder()
 *         .append(modePrompt)
 *         .appendMemoryV2(ctx.memoryV2)
 *         .appendToolGuidance(ctx.toolGuidance)
 *         .build();
 *
 *     await aiService.sendMessage({
 *         tools: ctx.tools,
 *         excludedTools: ctx.excludedTools,
 *         systemMessage,
 *         ...
 *     });
 * } finally {
 *     ctx.dispose();
 * }
 * ```
 */
export async function buildChatTurnContext(input: ChatTurnContextInput): Promise<ChatTurnContext> {
    const includeMemoryV2 = input.includeMemoryV2 !== false;

    const memoryV2: MemoryV2Addon = includeMemoryV2
        ? await buildMemoryV2Addon(input.dataDir, input.workspaceId, input.query, input.processId)
        : EMPTY_MEM_V2;

    const toolBundle = buildChatToolBundle({
        dataDir: input.dataDir,
        store: input.store,
        workspaceId: input.workspaceId,
        processId: input.processId,
        followUpSuggestions: input.followUpSuggestions,
        broadcastWorkItem: input.broadcastWorkItem,
        memoryV2: includeMemoryV2 ? memoryV2 : undefined,
        scheduleWakeup: input.scheduleWakeup,
        loopTools: input.loopTools,
        askUser: input.askUser,
        excludeTools: input.excludeTools,
    });

    return {
        tools: toolBundle.tools,
        toolGuidance: toolBundle.toolGuidance,
        memoryV2,
        excludedTools: memoryV2.excludedBuiltinTools,
        askUser: toolBundle.askUser,
        dispose: () => {
            memoryV2.dispose();
        },
    };
}
