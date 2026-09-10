/**
 * chatChangesModel — the whole-chat equivalent of a whisper group's diff source.
 *
 * The whisper collapsed group reconstructs a diff for the tool calls of *one*
 * group. The panel's "Changes" entry needs the same thing for *every* turn of
 * the selected chat, so this module walks a chat's retained turns once and
 * produces the same `WhisperDiffOpenContext` the existing viewer already
 * consumes — no new store, no new API, no second reconstruction path.
 *
 * Three rules it encodes:
 *
 *  1. **Only completed, successful write records count.** A pending, running,
 *     failed, or errored `edit`/`create`/`apply_patch` has not changed
 *     anything yet, and prose in an assistant message never has. A file whose
 *     diff text cannot be rebuilt still counts — the viewer lists it as
 *     unavailable rather than hiding it.
 *  2. **One record is one record, however it arrives.** A turn carries its tool
 *     calls both in `toolCalls` and inline in `timeline`; the same id in one
 *     turn is the same call and is replayed once. The same id reused in a
 *     *different* turn is a different call, so identity is `(turn, id)`.
 *  3. **Chronology is the whole point.** Calls stay in turn order, then in
 *     timeline order within a turn, so repeated edits to a file — including a
 *     later revert — replay as successive steps rather than collapsing into a
 *     net before/after.
 */

import type { ClientConversationTurn, ClientToolCall } from '../../../../types/dashboard';
import type { WhisperDiffOpenContext } from './WhisperCollapsedGroup';
import type { WhisperDiffToolCall } from './buildWhisperFileDiff';
import { collectFileEdits } from './toolGroupUtils';

/** A tool record as this model needs it — the subset of `ClientToolCall`. */
export interface ChatChangeToolRecord {
    id?: string;
    toolName: string;
    args?: unknown;
    status?: string;
}

/**
 * Statuses that mean "this call is done and it worked". `undefined` counts:
 * turns restored from older history carry no status, and dropping them would
 * silently hide a real chat's changes.
 */
function isSettledSuccess(status: string | undefined): boolean {
    return status === undefined || status === 'completed';
}

/**
 * Every tool record of a chat, in chronological order, de-duplicated within
 * each turn by tool id. Records with no id cannot be de-duplicated, so they are
 * taken from `toolCalls` only — the timeline copy of an id-less record would
 * otherwise double it.
 */
export function collectChatToolRecords(
    turns: readonly ClientConversationTurn[],
): ChatChangeToolRecord[] {
    const records: ChatChangeToolRecord[] = [];
    for (const turn of turns) {
        const seen = new Set<string>();
        const push = (call: ClientToolCall | undefined, allowAnonymous: boolean) => {
            if (!call || typeof call.toolName !== 'string') return;
            const id = typeof call.id === 'string' && call.id !== '' ? call.id : null;
            if (id === null) {
                if (!allowAnonymous) return;
            } else {
                if (seen.has(id)) return;
                seen.add(id);
            }
            records.push({
                ...(id === null ? {} : { id }),
                toolName: call.toolName,
                args: call.args,
                ...(call.status === undefined ? {} : { status: call.status }),
            });
        };
        for (const call of turn.toolCalls ?? []) push(call, true);
        for (const item of turn.timeline ?? []) push(item.toolCall, false);
    }
    return records;
}

/** The records that may establish a file change: settled and successful. */
export function completedChangeRecords(
    records: readonly ChatChangeToolRecord[],
): ChatChangeToolRecord[] {
    return records.filter(record => isSettledSuccess(record.status));
}

export interface ChatChangesSource {
    /** Owning clone the edited paths belong to — where any request must route. */
    ownerWorkspaceId: string;
    /** The chat whose history produced this context. */
    chatId: string;
}

/**
 * The whole-chat diff context, or `null` when the chat records no file change.
 *
 * `null` is what hides the menu entry and what an open tab renders as its empty
 * state, so "no chat selected" and "chat with no edits" reach the same answer
 * through the same path.
 */
export function buildChatChangesContext(
    turns: readonly ClientConversationTurn[] | null | undefined,
    source: ChatChangesSource,
): WhisperDiffOpenContext | null {
    if (!turns || turns.length === 0) return null;
    const records = completedChangeRecords(collectChatToolRecords(turns));
    const toolCalls: WhisperDiffToolCall[] = records.map(record => ({
        toolName: record.toolName,
        args: record.args,
    }));
    const files = collectFileEdits(toolCalls);
    if (files.length === 0) return null;
    return {
        files,
        toolCalls,
        commits: [],
        workspaceId: source.ownerWorkspaceId,
    };
}

/** Whether the chat has any recorded file change — the menu entry's gate. */
export function chatHasChanges(
    turns: readonly ClientConversationTurn[] | null | undefined,
    source: ChatChangesSource,
): boolean {
    return buildChatChangesContext(turns, source) !== null;
}
