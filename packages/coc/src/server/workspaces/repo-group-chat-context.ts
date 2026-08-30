/**
 * Dispatch-time chat context for repo-group workspaces.
 *
 * When a chat targets a repo-group workspace, the dispatch path grants each
 * live member's root path via `SendMessageOptions.additionalDirectories` so
 * autopilot can read/edit member repos without permission friction, and tells
 * the model which repos are in the group by appending a member listing to the
 * outgoing prompt: each member's name, absolute local path, and — when the
 * membership carries one — its description. Stale members (workspace removed or
 * path missing on disk) are silently skipped.
 *
 * The two halves have different cadences:
 *
 *  - `additionalDirectories` is an SDK permission option, not conversation
 *    state, so callers pass it on EVERY turn.
 *  - `promptBlock` is conversation state: once it is in the session it stays in
 *    the session, so re-appending it to every follow-up just burns tokens and
 *    repeats the same listing over and over. It is appended only when the model
 *    would otherwise not have it — see {@link shouldInjectRepoGroupContext}.
 *
 * The block rides the prompt sent to the SDK — it is never spliced into the
 * persisted user message. It is instead recorded verbatim on that user turn's
 * `repoGroupContext` field (see `persistRepoGroupContextOnUserTurn`) so the
 * chat can reveal what the model was told without polluting the transcript or
 * the history replayed back to the model on later turns. That field doubles as
 * the durable "last injected here, with this content" marker the injection
 * decision reads back, so it is written only on turns that actually carried the
 * block — a turn with no `repoGroupContext` means the model was told nothing on
 * that turn, and the UI discloses exactly that.
 */

import * as os from 'os';
import * as path from 'path';
import type { ConversationTurn, ProcessCompactionState, ProcessStore } from '@plusplusoneplusplus/forge';
import { tagBlock } from '../executors/prompt-tags';
import { isRepoGroupWorkspaceId, readRepoGroup, resolveRepoGroupMembers } from './repo-group-workspace';

/** Tag wrapping the appended member listing in the outgoing prompt. */
export const REPO_GROUP_CONTEXT_TAG = 'repo_group_context';

export interface RepoGroupChatContext {
    /** Tagged prompt section listing each live member's name, absolute path, and description. */
    promptBlock: string;
    /** Live member root paths, in membership order. */
    additionalDirectories: string[];
}

/**
 * Resolve the chat context for a workspace. Returns `undefined` unless
 * `workspaceId` is a repo-group workspace with a readable membership file and
 * at least one live member — callers can spread/append unconditionally.
 */
export async function resolveRepoGroupChatContext(
    store: ProcessStore,
    dataDir: string | undefined,
    workspaceId: string | undefined,
): Promise<RepoGroupChatContext | undefined> {
    if (!workspaceId || !isRepoGroupWorkspaceId(workspaceId)) return undefined;
    const effectiveDataDir = dataDir ?? path.join(os.homedir(), '.coc');
    const group = readRepoGroup(effectiveDataDir, workspaceId);
    if (!group) return undefined;
    const live = (await resolveRepoGroupMembers(effectiveDataDir, store, workspaceId))
        .filter(m => !m.stale && typeof m.name === 'string' && typeof m.rootPath === 'string');
    if (live.length === 0) return undefined;
    const listing = live
        .map(m => {
            const line = `- ${m.name}: ${m.rootPath}`;
            const description = typeof m.description === 'string' ? m.description.trim() : '';
            return description ? `${line} — ${description}` : line;
        })
        .join('\n');
    return {
        promptBlock: tagBlock(REPO_GROUP_CONTEXT_TAG, `Repo group "${group.name}" members:\n${listing}`),
        additionalDirectories: live.map(m => m.rootPath as string),
    };
}

/**
 * Record the injected block on the process's most recent user turn so the chat
 * UI can disclose it. Resolves the turn index from a fresh store read — the
 * user turn is written by the dispatch route (or the process-creation path)
 * before the executor computes the context, and cron/wakeup follow-ups append
 * theirs mid-execution.
 *
 * Best-effort and never throws: visibility must not be able to fail a turn.
 */
export async function persistRepoGroupContextOnUserTurn(
    store: ProcessStore,
    processId: string,
    context: RepoGroupChatContext | undefined,
): Promise<void> {
    if (!context) return;
    try {
        const process = await store.getProcess(processId);
        const turns = process?.conversationTurns ?? [];
        for (let i = turns.length - 1; i >= 0; i--) {
            if (turns[i].role === 'user') {
                await store.updateTurnRepoGroupContext?.(processId, i, context.promptBlock);
                return;
            }
        }
    } catch {
        // Ignore — the block still reaches the model either way.
    }
}

/** Inputs for {@link shouldInjectRepoGroupContext}. */
export interface RepoGroupInjectionCheck {
    /** Resolved context for this turn, or `undefined` for non-group chats. */
    context: RepoGroupChatContext | undefined;
    /** The process's persisted turns (the current user turn may or may not be present yet). */
    turns: ConversationTurn[] | undefined;
    /** `metadata.compaction` — the lifecycle of the most recent `/compact` run. */
    compaction: ProcessCompactionState | undefined;
    /**
     * False when the turn cannot resume a live SDK session and the executor
     * instead rebuilds history from persisted turns. The block is deliberately
     * not in those turns, so a rebuild loses it entirely.
     */
    canResumeSession: boolean;
}

/**
 * Decide whether this turn's outgoing prompt needs the member listing.
 *
 * The block is session state, so the default answer is "no" — a live,
 * uncompacted session already has it from an earlier turn. It is re-injected
 * only when the model provably does not have it, or has a stale copy:
 *
 *  1. **No live session to resume** (`canResumeSession === false`). Covers the
 *     very first turn and every cold-resume, where history is rebuilt from
 *     persisted turns that never contain the block.
 *  2. **Never injected before** — no earlier turn carries a `repoGroupContext`.
 *  3. **Membership drift** — the resolved listing differs from the one last
 *     injected (a member was added, removed, renamed, moved, or went stale).
 *     The block is tiny (~60 tokens for a five-repo group), so refreshing it
 *     the moment it goes wrong is cheaper than letting the model act on a bad
 *     path.
 *  4. **Compaction since the last injection** — the summarizer may have dropped
 *     the block, so the model gets it again.
 *
 * Compaction detection uses the two durable records the `/compact` route
 * writes: the display-only result turn it appends to the transcript (the only
 * kind of `displayOnly` assistant turn CoC produces) and
 * `metadata.compaction`. Both are checked because they can settle
 * independently. NOTE: this only sees explicit `/compact` runs. Provider-side
 * background compaction (`infiniteSessions.backgroundCompactionThreshold`) is
 * not surfaced to the server by any SDK wrapper — the Claude wrapper reads
 * `compact_boundary` only inside its own `compactSession()` drive loop — so it
 * cannot be detected here. If a wrapper ever forwards that boundary, feed it in
 * as a third signal.
 */
export function shouldInjectRepoGroupContext(check: RepoGroupInjectionCheck): boolean {
    const { context, canResumeSession } = check;
    if (!context) return false;
    if (!canResumeSession) return true;

    const turns = check.turns ?? [];
    let lastInjectedIndex = -1;
    for (let i = turns.length - 1; i >= 0; i--) {
        if (turns[i]?.repoGroupContext) {
            lastInjectedIndex = i;
            break;
        }
    }
    if (lastInjectedIndex === -1) return true;
    if (turns[lastInjectedIndex].repoGroupContext !== context.promptBlock) return true;

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

/** Epoch millis for a turn timestamp (a `Date` in memory, an ISO string once serialized). */
function toEpochMs(timestamp: unknown): number | undefined {
    const ms = timestamp instanceof Date ? timestamp.getTime() : Date.parse(String(timestamp));
    return Number.isFinite(ms) ? ms : undefined;
}

/** Append the context block to a prompt; identity when there is no context. */
export function appendRepoGroupContext(prompt: string, context: RepoGroupChatContext | undefined): string {
    return context ? `${prompt}\n\n${context.promptBlock}` : prompt;
}
