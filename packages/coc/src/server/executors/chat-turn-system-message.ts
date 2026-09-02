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
 *   1. admin global system prompt
 *   2. For Each generation contract
 *   3. Map Reduce generation contract
 *   4. base repo instructions (shared `.github/coc/instructions.md`)
 *   5. source-location markdown-link guidance (provider-specific)
 *   6. Memory V2 context
 *   7. tool guidance
 *   8. auto-folder save location
 *   9. note file context
 *
 * **This message is mode-invariant by contract.** It carries no `mode` input:
 * the read-only directive and the mode-specific repo instructions ride the
 * outgoing user turn instead (see `chat-mode-directive.ts`), so toggling the
 * mode pill mid-chat leaves the conversation's cached prefix intact. Do not
 * re-introduce a mode branch here — `chat-turn-system-message.test.ts` asserts
 * byte equality across modes.
 *
 * Callers decide *whether* a block applies (e.g. grilling suppresses the
 * auto-folder block) by passing `undefined`; they do not decide where it lands.
 */

import type { AutoFolderContext, SystemMessageConfig } from '@plusplusoneplusplus/forge';
import type { ChatProvider } from '../tasks/task-types';
import {
    buildForEachGenerationSystemMessage,
    buildMapReduceGenerationSystemMessage,
    buildSourceLocationMarkdownLinkSystemMessage,
} from './prompt-builder';
import { systemMessageBuilder } from './system-message-builder';
import type { MemoryV2Addon } from './memory-v2-addon';

// ============================================================================
// Types
// ============================================================================

export interface ChatTurnSystemMessageInput {
    /** Working directory used to load the shared repo instructions. */
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
        .appendGlobalSystemPrompt(input.globalSystemPrompt)
        .append(buildForEachGenerationSystemMessage(input.forEachGeneration)?.content)
        .append(buildMapReduceGenerationSystemMessage(input.mapReduceGeneration)?.content)
        .withBaseRepoInstructions(input.workingDirectory)
        .append(buildSourceLocationMarkdownLinkSystemMessage(input.provider)?.content)
        .appendMemoryV2(input.memoryV2)
        .appendToolGuidance(input.toolGuidance)
        .appendAutoFolder(input.autoFolderContext)
        .appendNoteFile(input.notePath)
        .build();
}
