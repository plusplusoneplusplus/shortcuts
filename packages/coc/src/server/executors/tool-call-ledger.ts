/**
 * Read-only view of one process's tool calls, used by the `system_one` tool to
 * resolve refs like `{ tool: "bash", nth: -1 }`.
 *
 * The current turn comes from the live streaming timeline buffer (store writes
 * are throttled, so the buffer is the source of truth mid-turn). Earlier turns
 * come from the stored conversation. Entries are folded by `toolCall.id`, the
 * last status wins, and the live buffer wins over a stored copy of the same id.
 *
 * Nested calls (`parentToolCallId` set) are skipped: the chat model never saw
 * their results, only the parent's summary.
 */

import type { ConversationTurn, TimelineItem } from '@plusplusoneplusplus/forge';

export type LedgerScope = 'current' | 'any';

export interface LedgerEntry {
    id: string;
    name: string;
    status: 'running' | 'completed' | 'failed';
    result?: string;
    error?: string;
    /** True when the call belongs to the in-flight turn. */
    current: boolean;
}

export interface ToolCallLedger {
    /** Tool calls in time order (oldest first), excluding `excludeId`. */
    list(opts: { excludeId?: string; scope: LedgerScope }): Promise<LedgerEntry[]>;
}

export interface ToolCallLedgerSources {
    /** Live timeline buffer of the in-flight turn (undefined when no turn is streaming). */
    getLiveTimeline: () => readonly TimelineItem[] | undefined;
    /** Stored conversation turns for the same process. */
    getStoredTurns: () => Promise<readonly ConversationTurn[] | undefined>;
}

function toolCallName(toolCall: NonNullable<TimelineItem['toolCall']>): string {
    return (toolCall as { toolName?: string }).toolName || toolCall.name || '';
}

function foldTimeline(items: readonly TimelineItem[], current: boolean, into: Map<string, LedgerEntry>): void {
    for (const item of items) {
        const call = item.toolCall;
        if (!call?.id || call.parentToolCallId) continue;
        if (item.type !== 'tool-start' && item.type !== 'tool-complete' && item.type !== 'tool-failed') continue;
        const status = item.type === 'tool-start' ? 'running' : item.type === 'tool-complete' ? 'completed' : 'failed';
        const prev = into.get(call.id);
        // Map.set on an existing id keeps its first-seen position (call start order).
        into.set(call.id, {
            id: call.id,
            name: toolCallName(call) || prev?.name || '',
            status,
            result: call.result ?? prev?.result,
            error: call.error ?? prev?.error,
            current,
        });
    }
}

export function createToolCallLedger(sources: ToolCallLedgerSources): ToolCallLedger {
    return {
        async list({ excludeId, scope }) {
            const live = new Map<string, LedgerEntry>();
            foldTimeline(sources.getLiveTimeline() ?? [], true, live);

            const entries = new Map<string, LedgerEntry>();
            if (scope === 'any') {
                for (const turn of (await sources.getStoredTurns()) ?? []) {
                    foldTimeline(turn.timeline ?? [], false, entries);
                }
                for (const id of live.keys()) entries.delete(id);
            }
            for (const [id, entry] of live) entries.set(id, entry);

            return [...entries.values()].filter(entry => entry.id !== excludeId);
        },
    };
}
