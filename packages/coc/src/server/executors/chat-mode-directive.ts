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
import type { ChatMode, LegacyChatMode } from '../tasks/task-types';
import { normalizeChatMode, normalizeChatModeOrDefault, resolveInstructionMode } from '../tasks/task-types';
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
