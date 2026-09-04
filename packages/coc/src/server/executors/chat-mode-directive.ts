/**
 * Chat Mode Directive
 *
 * The chat mode rides the outgoing **user** turn, not the system prompt.
 *
 * The system prompt is passed on every turn, including resumed ones, and sits
 * at the very front of the prefix, so any byte that changes with the mode pill
 * invalidates the cached prefix for the whole conversation — a 100-turn chat
 * that toggles ask → autopilot pays a full cache-creation pass over the entire
 * transcript. Appended user-turn content, by contrast, is always a fresh
 * suffix: re-sending the directive every turn costs its own tokens and
 * invalidates nothing.
 *
 * Same contract the repo-group member listing and the Ralph grilling directive
 * already follow (see `repo-group-chat-context.ts`).
 *
 * The directive is injected on **every** turn. That is stateless, immune to
 * compaction, and immune to a cold resume (a rebuilt history replays persisted
 * turns, which never carry the ride-along block), and it keeps the read-only
 * constraint as the most recent instruction in context — which matters because
 * ask mode auto-approves `Bash` and the prompt is the whole enforcement
 * mechanism.
 */

import { READ_ONLY_SYSTEM_MESSAGE, loadInstructions } from '@plusplusoneplusplus/forge';
import type { ChatMode, ChatPayload, LegacyChatMode } from '../tasks/task-types';
import {
    hasClassifyDiffContext,
    hasCommitChatContext,
    hasNoteChatContext,
    hasNoteCreateContext,
    hasReplicationContext,
    hasResolveCommentsContext,
    hasResolveDiffCommentsMultiContext,
    hasTaskGenerationContext,
    isChatPayload,
    isPrClassificationPayload,
    normalizeChatMode,
    normalizeChatModeOrDefault,
    resolveInstructionMode,
    TaskDefs,
} from '../tasks/task-types';
import { tagBlock } from './prompt-tags';

/** Tag wrapping the per-turn mode directive on the user message. */
export const CHAT_MODE_DIRECTIVE_TAG = 'coc-chat-mode';

/**
 * Note delivered on the first non-ask turn of a chat that previously ran in
 * ask mode. Without it the model still has the read-only block sitting in its
 * conversation history and keeps refusing to edit.
 */
export const MODE_SWITCHED_TO_AUTOPILOT_NOTE =
    'This chat has been switched to autopilot mode. The read-only restriction stated earlier ' +
    'in this conversation no longer applies; you may edit files and run commands directly.';

export interface ModeDirectiveInput {
    /** Mode this turn runs in. */
    mode: ChatMode;
    /** Mode the previous turn ran in; `undefined` on the first turn. */
    previousMode?: ChatMode;
    /**
     * Mode-specific repo instructions (`.github/coc/instructions-<mode>.md`),
     * already loaded. The shared `instructions.md` stays in the system prompt.
     */
    modeInstructions?: string;
}

/**
 * Build the tagged mode block for the outgoing user turn.
 *
 * Returns `undefined` when this turn has nothing mode-specific to say — a
 * fresh autopilot chat with no mode instructions.
 */
export function buildChatModeDirective(input: ModeDirectiveInput): string | undefined {
    const mode = normalizeChatModeOrDefault(input.mode);
    const previousMode = normalizeChatMode(input.previousMode);
    const parts: string[] = [];

    if (mode === 'ask') {
        parts.push(READ_ONLY_SYSTEM_MESSAGE.trim());
    } else if (previousMode === 'ask') {
        parts.push(MODE_SWITCHED_TO_AUTOPILOT_NOTE);
    }

    const modeInstructions = input.modeInstructions?.trim();
    if (modeInstructions) {
        parts.push(modeInstructions);
    }

    if (parts.length === 0) return undefined;
    return tagBlock(CHAT_MODE_DIRECTIVE_TAG, parts.join('\n\n'));
}

/**
 * Prepend the directive to an outgoing prompt so it reads as framing for the
 * request that follows (the tail of the message is already owned by
 * `appendRepoGroupContext`). Identity when there is no directive.
 */
export function prependChatModeDirective(prompt: string, directive: string | undefined): string {
    if (!directive) return prompt;
    return `${directive}\n\n${prompt}`;
}

/**
 * Load the mode-specific half of the repo instructions
 * (`.github/coc/instructions-<mode>.md`) for the mode directive. The shared
 * `instructions.md` is loaded separately into the system prompt, which must
 * stay mode-invariant.
 *
 * Never throws — a missing or unreadable instruction file simply yields no
 * block, matching `SystemMessageBuilder.withBaseRepoInstructions`.
 */
export async function loadChatModeInstructions(
    workingDirectory: string | undefined,
    mode: LegacyChatMode | undefined,
): Promise<string | undefined> {
    if (!workingDirectory || !mode) return undefined;
    try {
        return (await loadInstructions(workingDirectory, resolveInstructionMode(mode), { scope: 'mode' })) ?? undefined;
    } catch {
        return undefined;
    }
}

// ============================================================================
// Chat-visible disclosure
// ============================================================================

/**
 * The chat-visible half of the directive: the mode prose only.
 *
 * Prepended to the *stored* user turn so the transcript shows the constraint
 * the model was actually given on that turn, the same way the `<chat-style>`
 * and `<selected_skills>` blocks are stored. The repo's mode-specific
 * instructions are deliberately left out — they are repo configuration that has
 * never been surfaced in a transcript, and they would bury the user's message.
 *
 * Returns `undefined` when the turn has nothing mode-specific to disclose.
 */
export function buildChatModeDisplayBlock(input: {
    mode: ChatMode;
    previousMode?: ChatMode;
}): string | undefined {
    return buildChatModeDirective({ mode: input.mode, previousMode: input.previousMode });
}

/**
 * The mode a brand-new chat's first turn actually runs in, or `undefined` when
 * the task routes to an executor that sends no mode directive at all.
 *
 * Mirrors `ExecutorRegistry.resolveChatExecutor` — the same mirroring
 * `isChatStyleEligiblePayload` does, and for the same reason: the stored user
 * turn is written before an executor is picked, so the display layer has to
 * predict the routing. A task that lands on the note, note-create,
 * task-generation, replication or Ralph executors gets nothing, because those
 * executors send nothing; over-claiming here would put a constraint in the
 * transcript that the model was never told.
 *
 * The task *type* is checked first because Dreams runs its own internal steps
 * through `ProcessLifecycleRunner` with a `kind: 'chat'` payload but its own
 * one-shot AI call — it never reaches the executor registry, so it discloses
 * nothing.
 */
export function resolveFirstTurnDirectiveMode(
    task: { type?: string; payload?: Record<string, unknown> } | undefined,
): ChatMode | undefined {
    const payload = task?.payload;
    if (!payload) return undefined;
    if (task?.type !== TaskDefs.chat.kind && task?.type !== TaskDefs.prClassification.kind) return undefined;
    // pr-classification payloads are not chat payloads, and always run ask.
    if (isPrClassificationPayload(payload)) return 'ask';
    if (!isChatPayload(payload)) return undefined;

    if (hasTaskGenerationContext(payload) || hasReplicationContext(payload)) return undefined;
    if (
        hasResolveCommentsContext(payload)
        || hasResolveDiffCommentsMultiContext(payload)
        || (payload as ChatPayload).tools?.includes('resolve-comments')
    ) {
        // Multi-file resolve runs autopilot and sends no directive; single-file
        // is pinned to ask by ResolveCommentsExecutor whatever the payload says.
        return hasResolveDiffCommentsMultiContext(payload) ? undefined : 'ask';
    }
    // Commit chats and PR-diff classification are pinned to ask by their executors.
    if (hasCommitChatContext(payload) || hasClassifyDiffContext(payload)) return 'ask';
    if (hasNoteCreateContext(payload) || hasNoteChatContext(payload)) return undefined;

    const mode = normalizeChatModeOrDefault((payload as ChatPayload).mode);
    return mode === 'ralph' ? undefined : mode;
}
