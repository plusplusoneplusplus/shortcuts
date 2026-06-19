// Reconstructs a single sub-agent's conversation from the main chat's turns, so
// it can be rendered read-only in the very same ConversationArea the main thread
// uses (identical tool-call rendering, no extra fetch).
//
// All of a sub-agent's steps are captured flat in the main conversation, linked
// by `parentToolCallId`. We collect the sub-agent's full descendant subtree
// (every tool call whose parent chain reaches `subAgentId`) and emit two
// synthetic turns: a user turn carrying the Task prompt, and an assistant turn
// carrying those steps (timeline + toolCalls) plus the Task result as its
// closing content.

import type { ClientConversationTurn, ClientTimelineItem, ClientToolCall } from '../../../types/dashboard';
import { asRecord, asString, buildAgentCompletionByTaskId, collectToolCalls, rawArgs } from './agentToolCalls';

/**
 * Build `[userTurn, assistantTurn]` for the sub-agent `subAgentId`, or `[]` when
 * that sub-agent isn't present in `turns`.
 *
 * The filtered steps deliberately KEEP their `parentToolCallId`. The sub-agent's
 * own Task call is absent from the synthetic turn, so the thread renderer
 * (ConversationTurnBubble) leaves the sub-agent's direct steps at top level
 * (their parent isn't in the turn) while nesting deeper descendants under their
 * parents — re-rooting the subtree exactly like the main thread. Stripping the
 * ids would re-enable the renderer's interval/trailing-task auto-nesting and
 * risk incorrect nesting.
 */
export function buildSubAgentTurns(
    turns: ClientConversationTurn[] | undefined,
    subAgentId: string,
): ClientConversationTurn[] {
    const all = collectToolCalls(turns || []);
    const byId = new Map<string, ClientToolCall>(all.map((tc) => [tc.id, tc]));
    const task = byId.get(subAgentId);
    if (!task) {
        return [];
    }

    // A call belongs to this sub-agent when its parent chain reaches subAgentId.
    const isDescendant = (tc: ClientToolCall): boolean => {
        let cursor = tc.parentToolCallId;
        const seen = new Set<string>();
        while (cursor) {
            if (cursor === subAgentId) {
                return true;
            }
            if (seen.has(cursor)) {
                return false; // cycle guard
            }
            seen.add(cursor);
            cursor = byId.get(cursor)?.parentToolCallId;
        }
        return false;
    };
    const descendantIds = new Set(all.filter(isDescendant).map((tc) => tc.id));

    // Filter the main turns' timeline to this sub-agent's steps, preserving
    // chronological order (timeline order is what the renderer relies on for
    // tool-start/complete pairing). toolCalls is the renderer's fallback.
    const timeline: ClientTimelineItem[] = [];
    for (const turn of turns || []) {
        for (const item of turn.timeline || []) {
            const id = item.toolCall?.id;
            if (id && descendantIds.has(id)) {
                timeline.push(item);
            }
        }
    }
    const toolCalls = all.filter((tc) => descendantIds.has(tc.id));

    const args = asRecord(rawArgs(task));
    const prompt = asString(args.prompt) || asString(args.description);
    const result = buildAgentCompletionByTaskId(all).get(task.id)?.result
        ?? (typeof task.result === 'string' ? task.result : '');

    const userTurn: ClientConversationTurn = {
        role: 'user',
        content: prompt,
        turnIndex: 0,
        timeline: [],
    };
    const assistantTurn: ClientConversationTurn = {
        role: 'assistant',
        content: result,
        turnIndex: 1,
        toolCalls,
        timeline,
    };
    return [userTurn, assistantTurn];
}
