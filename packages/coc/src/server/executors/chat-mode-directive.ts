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
 * First turns and one-shot executors inject unconditionally. Follow-ups ask
 * {@link shouldInjectChatModeDirective} first: the block is session state, so a
 * live, uncompacted chat that has not changed mode already has it and gets
 * nothing.
 *
 * ACCEPTED COST: in a long ask chat the read-only constraint stops being the
 * most recent instruction, while ask mode keeps auto-approving `Bash` and the
 * prompt is the whole enforcement mechanism. That recency loss is a deliberate
 * tradeoff for not re-sending the block on every turn; the signals below are
 * the safety valves.
 */

import { READ_ONLY_SYSTEM_MESSAGE, loadInstructions } from '@plusplusoneplusplus/forge';
import type { ConversationTurn, ProcessCompactionState, ProcessStore } from '@plusplusoneplusplus/forge';
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
    const prose = buildChatModeProse(input.mode, input.previousMode);
    const modeInstructions = input.modeInstructions?.trim() || undefined;

    const parts = [prose, modeInstructions].filter((part): part is string => !!part);
    if (parts.length === 0) return undefined;
    return tagBlock(CHAT_MODE_DIRECTIVE_TAG, parts.join('\n\n'));
}

/**
 * The mode prose half of the directive: the one fixed sentence-block this
 * turn's mode calls for, untagged, or `undefined` when the mode says nothing.
 *
 * Exactly one of two known constants, which is what makes a stored directive
 * splittable back into (prose, instructions) — see {@link parseChatModeMarker}.
 */
function buildChatModeProse(rawMode: ChatMode, rawPreviousMode: ChatMode | undefined): string | undefined {
    const mode = normalizeChatModeOrDefault(rawMode);
    const previousMode = normalizeChatMode(rawPreviousMode);
    if (mode === 'ask') return READ_ONLY_SYSTEM_MESSAGE.trim();
    if (previousMode === 'ask') return MODE_SWITCHED_TO_AUTOPILOT_NOTE;
    return undefined;
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
// Injection decision
// ============================================================================

/** Inputs for {@link shouldInjectChatModeDirective}. */
export interface ChatModeInjectionCheck {
    /** Mode this turn runs in. */
    mode: ChatMode;
    /** Mode the previous turn ran in; `undefined` on the first turn. */
    previousMode?: ChatMode;
    /**
     * Resolved `.github/coc/instructions-<mode>.md` for this turn.
     *
     * Only the prompt side has this — the route that persists the user turn
     * never loads a `workingDirectory`. Pass it together with
     * `checkInstructionDrift: true`; leave both off on the display side.
     */
    modeInstructions?: string;
    /**
     * Whether `modeInstructions` is authoritative. `false` (the display side)
     * means "unknown", which disables signal 5 rather than reading the absent
     * value as "no instructions".
     */
    checkInstructionDrift?: boolean;
    /** The process's persisted turns (the current user turn may or may not be present yet). */
    turns: ConversationTurn[] | undefined;
    /** `metadata.compaction` — the lifecycle of the most recent `/compact` run. */
    compaction: ProcessCompactionState | undefined;
    /**
     * False when the turn cannot resume a live SDK session and the executor
     * instead rebuilds history from persisted turns. Those turns inline the
     * *display* copy of the block, and `buildConversationHistoryContext` wraps
     * the replay in `<conversation_history>` — a quoted instruction, not an
     * active one.
     */
    canResumeSession: boolean;
}

/**
 * Decide whether this follow-up turn's outgoing prompt needs the mode block.
 *
 * The block is session state, so the default answer is "no" — a live,
 * uncompacted session in a stable mode already has it from an earlier turn. It
 * is re-injected only when the model provably does not have the right one:
 *
 *  1. **No live session to resume** (`canResumeSession === false`). History is
 *     rebuilt from persisted turns, which carry the block only as replayed
 *     quotation inside `<conversation_history>`.
 *  2. **Mode changed since the last injection**, in both directions —
 *     `→ ask` sends the read-only block, `ask → autopilot` sends
 *     {@link MODE_SWITCHED_TO_AUTOPILOT_NOTE}. This is the primary trigger and
 *     the reason the check exists.
 *  3. **Never injected before** — no earlier turn carries a `chatModeContext`.
 *  4. **Compaction since the last injection** — the summarizer may have dropped
 *     the block.
 *  5. **Mode-instruction drift** — the resolved
 *     `.github/coc/instructions-<mode>.md` differs from the copy last injected.
 *     Repo config can be edited mid-chat. Prompt side only: the route that
 *     writes the stored turn cannot load the file, so a *drift-only*
 *     re-injection is sent to the model but not disclosed in the transcript.
 *     Every other signal is evaluated identically on both sides, so the
 *     transcript and the prompt agree on which turns carried the block.
 *
 * Compaction detection mirrors `shouldInjectRepoGroupContext`: the
 * display-only result turn `/compact` appends (the only kind of `displayOnly`
 * assistant turn CoC produces) and `metadata.compaction`, checked
 * independently because they settle independently. NOTE: this only sees
 * explicit `/compact` runs. Provider-side background compaction is not
 * surfaced to the server by any SDK wrapper, so an invisible compaction can
 * drop the block with no re-injection. If a wrapper ever forwards
 * `compact_boundary`, feed it in as a further signal.
 *
 * ACCEPTED RISK: between injections the read-only constraint is no longer the
 * most recent instruction in a long ask chat, and ask mode auto-approves
 * `Bash`. Deliberate — see the file header.
 */
export function shouldInjectChatModeDirective(check: ChatModeInjectionCheck): boolean {
    const expectedProse = buildChatModeProse(check.mode, check.previousMode);
    const expectedInstructions = check.checkInstructionDrift ? check.modeInstructions?.trim() || undefined : undefined;

    // Nothing this turn could say. The display side lands here for every
    // autopilot turn, which is exactly what `buildChatModeDisplayBlock` already
    // returns nothing for.
    if (!expectedProse && !expectedInstructions) return false;
    if (!check.canResumeSession) return true;

    const turns = check.turns ?? [];
    let lastInjectedIndex = -1;
    for (let i = turns.length - 1; i >= 0; i--) {
        if (turns[i]?.chatModeContext) {
            lastInjectedIndex = i;
            break;
        }
    }
    if (lastInjectedIndex === -1) return true;

    const last = parseChatModeMarker(turns[lastInjectedIndex].chatModeContext ?? '');
    if (last.prose !== expectedProse) return true;
    if (check.checkInstructionDrift && last.instructions !== expectedInstructions) return true;

    for (let i = lastInjectedIndex + 1; i < turns.length; i++) {
        if (turns[i]?.role === 'assistant' && turns[i]?.displayOnly === true) return true;
    }

    const compaction = check.compaction;
    if (compaction?.state === 'completed' && compaction.completedAt) {
        const completedMs = Date.parse(compaction.completedAt);
        const injectedMs = toEpochMs(turns[lastInjectedIndex].timestamp);
        if (Number.isFinite(completedMs) && (injectedMs === undefined || completedMs > injectedMs)) return true;
    }

    return false;
}

/**
 * Record the injected directive on the process's most recent user turn.
 *
 * The single writer of `chatModeContext`: the executor that actually sent the
 * block writes the marker, verbatim. The display side only evaluates the same
 * decision — it never writes — so the two can never disagree about which turns
 * carried the directive. Resolves the turn index from a fresh store read, the
 * same way `persistRepoGroupContextOnUserTurn` does, because the user turn is
 * written by the dispatch route (or the process-creation path) before the
 * executor computes anything, and cron/wakeup follow-ups append theirs
 * mid-execution.
 *
 * Best-effort and never throws: bookkeeping must not be able to fail a turn. A
 * lost write only costs one redundant re-injection on the next turn.
 */
export async function persistChatModeContextOnUserTurn(
    store: ProcessStore,
    processId: string,
    directive: string | undefined,
): Promise<void> {
    if (!directive) return;
    try {
        const process = await store.getProcess(processId);
        const turns = process?.conversationTurns ?? [];
        for (let i = turns.length - 1; i >= 0; i--) {
            if (turns[i].role === 'user') {
                await store.updateTurnChatModeContext?.(processId, i, directive);
                return;
            }
        }
    } catch {
        // Ignore — the block still reaches the model either way.
    }
}

/**
 * Split a stored `chatModeContext` marker back into the two halves
 * {@link buildChatModeDirective} joined.
 *
 * The prose half is always one of two known constants, so the split is exact
 * rather than a guess at where the repo instructions begin. A marker written by
 * the display side carries no instructions; one written by the prompt side may.
 */
function parseChatModeMarker(marker: string): { prose?: string; instructions?: string } {
    const open = `<${CHAT_MODE_DIRECTIVE_TAG}>\n`;
    const close = `\n</${CHAT_MODE_DIRECTIVE_TAG}>`;
    let body = marker;
    if (body.startsWith(open)) body = body.slice(open.length);
    if (body.endsWith(close)) body = body.slice(0, -close.length);

    for (const prose of [READ_ONLY_SYSTEM_MESSAGE.trim(), MODE_SWITCHED_TO_AUTOPILOT_NOTE]) {
        if (body === prose) return { prose };
        if (body.startsWith(`${prose}\n\n`)) {
            return { prose, instructions: body.slice(prose.length + 2) || undefined };
        }
    }
    return { instructions: body || undefined };
}

/** Epoch millis for a turn timestamp (a `Date` in memory, an ISO string once serialized). */
function toEpochMs(timestamp: unknown): number | undefined {
    const ms = timestamp instanceof Date ? timestamp.getTime() : Date.parse(String(timestamp));
    return Number.isFinite(ms) ? ms : undefined;
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
