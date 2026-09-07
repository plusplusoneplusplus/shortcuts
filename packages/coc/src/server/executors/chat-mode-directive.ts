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

import { READ_ONLY_SYSTEM_MESSAGE, buildAutoFolderLocationBlock, loadInstructions, toForwardSlashes } from '@plusplusoneplusplus/forge';
import type { AutoFolderContext, ConversationTurn, ProcessCompactionState, ProcessStore } from '@plusplusoneplusplus/forge';
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
 * Tag wrapping the read-only rules inside the mode directive. Owned by the
 * SDK's {@link READ_ONLY_SYSTEM_MESSAGE} constant; named here because the plan
 * save guidance is spliced in just before the closing tag.
 */
export const READ_ONLY_TAG = 'coc-read-only-mode';

/**
 * Sentence introducing the plan save guidance nested inside the read-only
 * section.
 *
 * Load-bearing in two directions: it tells the model the destination applies
 * only to an explicit "save a plan" request (it is not a standing instruction
 * to produce a plan for every question), and it is the literal marker
 * {@link stripPlanSaveGuidance} splits on when a stored directive has to be
 * compared against one resolved without folder context.
 */
export const PLAN_SAVE_GUIDANCE_INTRO = 'If the user asks you to save a plan:';

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
    /**
     * Where a plan belongs when the user asks for one, resolved to the
     * workspace's `notes/Plans` root. Rendered *inside* the read-only section
     * because it is the exception that section already carves out; `undefined`
     * (no working directory, an artifact-bound chat, a Ralph grilling turn)
     * renders the read-only rules alone.
     *
     * Ask mode only — the directive drops it in every other mode.
     */
    planSaveContext?: AutoFolderContext;
}

/**
 * Build the tagged mode block for the outgoing user turn.
 *
 * Returns `undefined` when this turn has nothing mode-specific to say — a
 * fresh autopilot chat with no mode instructions.
 */
export function buildChatModeDirective(input: ModeDirectiveInput): string | undefined {
    const prose = buildChatModeProse(input.mode, input.previousMode, input.planSaveContext);
    const modeInstructions = input.modeInstructions?.trim() || undefined;

    const parts = [prose, modeInstructions].filter((part): part is string => !!part);
    if (parts.length === 0) return undefined;
    return tagBlock(CHAT_MODE_DIRECTIVE_TAG, parts.join('\n\n'));
}

/**
 * The mode prose half of the directive: the read-only section this turn's mode
 * calls for, untagged, or `undefined` when the mode says nothing.
 *
 * Either a complete `<coc-read-only-mode>` section (optionally carrying the
 * nested plan save guidance) or the fixed autopilot transition note, which is
 * what makes a stored directive splittable back into
 * (prose, instructions) — see {@link parseChatModeMarker}.
 */
function buildChatModeProse(
    rawMode: ChatMode,
    rawPreviousMode: ChatMode | undefined,
    planSaveContext?: AutoFolderContext,
): string | undefined {
    const mode = normalizeChatModeOrDefault(rawMode);
    const previousMode = normalizeChatMode(rawPreviousMode);
    if (mode === 'ask') return buildReadOnlySection(planSaveContext);
    if (previousMode === 'ask') return MODE_SWITCHED_TO_AUTOPILOT_NOTE;
    return undefined;
}

/**
 * The read-only section, with the plan destination nested inside it when one
 * applies.
 *
 * The guidance goes *inside* `</coc-read-only-mode>` rather than after it
 * because it explains the plan-file exception those rules already name; a
 * sibling block reads as a second, competing instruction. The SDK's shared
 * constant stays workspace-agnostic — the workspace data is spliced in here.
 */
function buildReadOnlySection(planSaveContext?: AutoFolderContext): string {
    const base = READ_ONLY_SYSTEM_MESSAGE.trim();
    if (!planSaveContext) return base;

    const close = `</${READ_ONLY_TAG}>`;
    const closeIndex = base.lastIndexOf(close);
    // Defensive: a constant that no longer carries the tag still yields valid
    // read-only rules, just without the (unsplittable) nested guidance.
    if (closeIndex < 0) return base;

    const head = base.slice(0, closeIndex).replace(/\s+$/, '');
    const location = buildAutoFolderLocationBlock(
        toForwardSlashes(planSaveContext.tasksRoot),
        // Directory enumeration order is not meaningful, so a copy is sorted
        // with plain code-unit ordering: the same folders must render the same
        // bytes on every platform, or drift detection re-injects for nothing.
        [...planSaveContext.existingFolders].sort(),
    );
    return `${head}\n\n${PLAN_SAVE_GUIDANCE_INTRO}\n${location}\n${close}`;
}

/**
 * Undo {@link buildReadOnlySection}'s splice, yielding the read-only rules a
 * caller with no folder context would have produced.
 *
 * Lets the display side — which never resolves folders — compare a stored
 * directive against its own expectation without reading "I did not resolve
 * plan context" as "the plan context was removed".
 */
function stripPlanSaveGuidance(section: string): string {
    const marker = `\n\n${PLAN_SAVE_GUIDANCE_INTRO}\n`;
    const start = section.indexOf(marker);
    if (start < 0) return section;
    const close = `</${READ_ONLY_TAG}>`;
    const closeIndex = section.lastIndexOf(close);
    if (closeIndex < start) return section;
    return `${section.slice(0, start)}\n${close}`;
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
    /**
     * Plan save destination resolved for this turn, or `undefined` when the
     * turn is not eligible for one. Only meaningful together with
     * {@link ChatModeInjectionCheck.checkPlanContextDrift}.
     */
    planSaveContext?: AutoFolderContext;
    /**
     * Whether `planSaveContext` is authoritative. `false` (the display side,
     * which never touches the filesystem) means "unknown", so the comparison
     * runs against the plan-guidance-stripped read-only rules instead of
     * reading the absent value as "the destination was removed".
     */
    checkPlanContextDrift?: boolean;
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
 *  6. **Plan-destination drift** — the resolved `notes/Plans` root or its
 *     folder listing differs from the copy last injected, or the turn's
 *     eligibility for the guidance flipped. Folders are created and renamed
 *     mid-chat. Prompt side only, for the same reason as signal 5: the display
 *     side cannot read the filesystem, so it compares the read-only rules with
 *     the guidance stripped back out.
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
    const expectedProse = buildChatModeProse(
        check.mode,
        check.previousMode,
        check.checkPlanContextDrift ? check.planSaveContext : undefined,
    );
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
    // Folder-blind callers compare against the stripped prose so an
    // unresolved destination never looks like a removed one.
    const lastProse = check.checkPlanContextDrift ? last.prose : last.proseBase;
    if (lastProse !== expectedProse) return true;
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

/** The three independently-compared pieces of a stored directive. */
export interface ParsedChatModeMarker {
    /** The leading prose verbatim, including any nested plan save guidance. */
    prose?: string;
    /** The same prose with the plan save guidance removed, for folder-blind callers. */
    proseBase?: string;
    /** Everything after the prose: the repo's mode-specific instructions. */
    instructions?: string;
}

/**
 * Split a stored `chatModeContext` marker back into the halves
 * {@link buildChatModeDirective} joined.
 *
 * The read-only half is no longer a fixed constant — it carries workspace
 * folder data — so it is located by its own `<coc-read-only-mode>` wrapper
 * rather than by string equality. The autopilot note is still a constant. Both
 * splits are exact rather than a guess at where the repo instructions begin.
 *
 * A marker whose read-only section never closes is malformed: it yields no
 * prose, so the caller re-injects rather than trusting an unparseable record.
 */
export function parseChatModeMarker(marker: string): ParsedChatModeMarker {
    const open = `<${CHAT_MODE_DIRECTIVE_TAG}>\n`;
    const close = `\n</${CHAT_MODE_DIRECTIVE_TAG}>`;
    let body = marker;
    if (body.startsWith(open)) body = body.slice(open.length);
    if (body.endsWith(close)) body = body.slice(0, -close.length);

    const readOnlyOpen = `<${READ_ONLY_TAG}>`;
    const readOnlyClose = `</${READ_ONLY_TAG}>`;
    if (body.startsWith(readOnlyOpen)) {
        const end = body.indexOf(readOnlyClose);
        if (end < 0) return { instructions: body || undefined };
        const section = body.slice(0, end + readOnlyClose.length);
        const rest = body.slice(end + readOnlyClose.length).replace(/^\n+/, '');
        return {
            prose: section,
            proseBase: stripPlanSaveGuidance(section),
            instructions: rest || undefined,
        };
    }

    const note = MODE_SWITCHED_TO_AUTOPILOT_NOTE;
    if (body === note) return { prose: note, proseBase: note };
    if (body.startsWith(`${note}\n\n`)) {
        return { prose: note, proseBase: note, instructions: body.slice(note.length + 2) || undefined };
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
 * The disclosure block for a **follow-up** turn, or `undefined` when this turn
 * sends nothing.
 *
 * The display counterpart of the executor's decision: same
 * {@link shouldInjectChatModeDirective} call, evaluated from what the route
 * already has on the process record, with `checkInstructionDrift` off because
 * the route never loads a `workingDirectory`. Everything else is identical, so
 * the stored turn carries the block on exactly the turns the prompt does — a
 * drift-only re-injection is the single documented exception, and it errs
 * towards disclosing less than was sent rather than more.
 *
 * Only evaluates; the executor that actually sends the block is the single
 * writer of the `chatModeContext` marker both sides read.
 */
export function buildFollowUpChatModeDisplayBlock(input: {
    mode: ChatMode;
    previousMode?: ChatMode;
    process: {
        conversationTurns?: ConversationTurn[];
        metadata?: { compaction?: ProcessCompactionState };
        sdkSessionId?: string;
    } | undefined;
}): string | undefined {
    if (!shouldInjectChatModeDirective({
        mode: input.mode,
        previousMode: input.previousMode,
        turns: input.process?.conversationTurns,
        compaction: input.process?.metadata?.compaction,
        canResumeSession: !!input.process?.sdkSessionId,
    })) {
        return undefined;
    }
    return buildChatModeDisplayBlock({ mode: input.mode, previousMode: input.previousMode });
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
