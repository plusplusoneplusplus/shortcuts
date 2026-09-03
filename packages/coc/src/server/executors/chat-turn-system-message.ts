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
 *   7b. Codex `ask_user` discovery note (Codex only, when the tool is enabled)
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
    /**
     * Whether CoC's custom `ask_user` tool survived into this turn's final tool
     * bundle (after admin config, per-workspace disabled-tool preferences, and
     * context exclusions). Drives the Codex discovery block; never infer it from
     * `chat.askUser.enabled`, which would advertise a tool the workspace removed.
     */
    askUserAvailable?: boolean;
    /** Auto-folder save target; pass `undefined` to suppress the block. */
    autoFolderContext?: AutoFolderContext;
    /** Note being edited by a note chat, when applicable. */
    notePath?: string;
}

// ============================================================================
// Codex `ask_user` discovery
// ============================================================================

/**
 * Discovery-only note teaching Codex how CoC's bare `ask_user` name maps into
 * Codex's code-mode tool namespace.
 *
 * Codex models running in `code_mode_only` (e.g. `gpt-5.6-sol`) never see a
 * bare top-level `ask_user` declaration — CoC's MCP tools are deferred behind
 * `functions.exec` under the `mcp__coc_llm_tools__` prefix. Skills and prompts
 * (Ralph grilling, `grill-me`) name the tool as plain `ask_user`, so without
 * this mapping the model concludes the tool is missing, confuses it with the
 * unrelated Codex built-in `request_user_input`, and asks the user to switch to
 * Plan mode instead of opening the structured widget.
 *
 * Deliberately *only* discovery: batching, question types, deferred answers,
 * and unattended-run safety stay in the tool's own description, which the model
 * reads once it has located the tool.
 */
const CODEX_ASK_USER_DISCOVERY_MESSAGE = `\
<codex-ask-user-discovery>
CoC's custom \`ask_user\` tool IS available on this turn, even though no bare top-level \`ask_user\` declaration is shown to you.

- In Codex code mode it is a deferred tool: find \`mcp__coc_llm_tools__ask_user\` in \`ALL_TOOLS\` and call it through \`functions.exec\` as \`tools.mcp__coc_llm_tools__ask_user(...)\`.
- \`request_user_input\` is a separate Codex built-in. Its Plan-mode restriction does NOT apply to CoC's \`ask_user\`, and you never need Plan mode to ask a question here.
- Do not tell the user \`ask_user\` is unavailable, and do not fall back to a plain-text question, until you have actually looked up the deferred CoC tool above.
</codex-ask-user-discovery>`;

/**
 * Return the Codex `ask_user` discovery block, or `undefined` when it does not
 * apply — any non-Codex provider, or a turn whose final tool bundle does not
 * carry `ask_user`.
 */
export function buildCodexAskUserDiscoveryBlock(
    provider: ChatProvider | undefined,
    askUserAvailable: boolean | undefined,
): string | undefined {
    if (provider !== 'codex' || !askUserAvailable) return undefined;
    return CODEX_ASK_USER_DISCOVERY_MESSAGE;
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
        .append(buildCodexAskUserDiscoveryBlock(input.provider, input.askUserAvailable))
        .appendAutoFolder(input.autoFolderContext)
        .appendNoteFile(input.notePath)
        .build();
}
