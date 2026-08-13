/**
 * Chat Turn System Message
 *
 * Single source of truth for the chat system message shared by the first-turn
 * path (`ChatBaseExecutor.buildStandardModeOptions`) and the continuation path
 * (`FollowUpExecutor.executeFollowUp`).
 *
 * Block order is load-bearing — it is what the model actually reads — so it is
 * fixed here rather than repeated at each call site:
 *
 *   1. mode restrictions (ask / autopilot / ralph)
 *   2. admin global system prompt
 *   3. For Each generation contract
 *   4. Map Reduce generation contract
 *   5. repo instructions (AGENTS.md / CLAUDE.md for the working directory)
 *   6. source-location markdown-link guidance (provider-specific)
 *   7. Memory V2 context
 *   8. tool guidance
 *   9. auto-folder save location
 *  10. note file context
 *
 * Callers decide *whether* a block applies (e.g. grilling suppresses the
 * auto-folder block, and follow-ups only pass it in ask mode) by passing
 * `undefined`; they do not decide where it lands.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { AutoFolderContext, SystemMessageConfig } from '@plusplusoneplusplus/forge';
import type { ChatMode, ChatProvider } from '../tasks/task-types';
import {
    buildForEachGenerationSystemMessage,
    buildMapReduceGenerationSystemMessage,
    buildModeSystemMessage,
    buildSourceLocationMarkdownLinkSystemMessage,
} from './prompt-builder';
import { systemMessageBuilder } from './system-message-builder';
import type { MemoryV2Addon } from './memory-v2-addon';

// ============================================================================
// Types
// ============================================================================

export interface ChatTurnSystemMessageInput {
    /** Chat mode driving both the mode block and the repo-instruction flavor. */
    mode: ChatMode;
    /** Working directory used to load repo instructions. */
    workingDirectory: string | undefined;
    /** Provider whose source-location link guidance applies to this turn. */
    provider: ChatProvider;
    /** Admin-configured global system prompt; `undefined` when unset. */
    globalSystemPrompt?: string;
    /** For Each generation context, or `null` when this turn is not a generation turn. */
    forEachGeneration: Parameters<typeof buildForEachGenerationSystemMessage>[0];
    /** Map Reduce generation context, or `null` when this turn is not a generation turn. */
    mapReduceGeneration: Parameters<typeof buildMapReduceGenerationSystemMessage>[0];
    /** Memory V2 addon resolved for this turn. */
    memoryV2: MemoryV2Addon;
    /** Aggregated tool-guidance prose from the turn's tool bundle. */
    toolGuidance: string;
    /** Auto-folder save target; pass `undefined` to suppress the block. */
    autoFolderContext?: AutoFolderContext;
    /** Note being edited by a note chat, when applicable. */
    notePath?: string;
}

// ============================================================================
// Builder
// ============================================================================

/**
 * Assemble the chat-turn system message in the canonical block order.
 *
 * Returns `undefined` when every block is empty, matching the underlying
 * builder's contract (a turn with nothing to say sends no system message).
 */
export function buildChatTurnSystemMessage(
    input: ChatTurnSystemMessageInput,
): Promise<SystemMessageConfig | undefined> {
    return systemMessageBuilder()
        .append(buildModeSystemMessage(input.mode)?.content)
        .appendGlobalSystemPrompt(input.globalSystemPrompt)
        .append(buildForEachGenerationSystemMessage(input.forEachGeneration)?.content)
        .append(buildMapReduceGenerationSystemMessage(input.mapReduceGeneration)?.content)
        .withRepoInstructions(input.workingDirectory, input.mode)
        .append(buildSourceLocationMarkdownLinkSystemMessage(input.provider)?.content)
        .appendMemoryV2(input.memoryV2)
        .appendToolGuidance(input.toolGuidance)
        .appendAutoFolder(input.autoFolderContext)
        .appendNoteFile(input.notePath)
        .build();
}
