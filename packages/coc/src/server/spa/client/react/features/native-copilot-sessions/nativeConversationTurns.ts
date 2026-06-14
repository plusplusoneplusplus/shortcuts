/**
 * Map the backend-reconstructed native Copilot conversation
 * ({@link ReconstructedConversationTurn}, from `session-state/<id>/events.jsonl`
 * or the `session-store.db` fallback) into the SPA chat shape
 * ({@link ClientConversationTurn}) so the read-only detail view can reuse the
 * existing `ConversationArea` / `ConversationTurnBubble` components without a
 * fork.
 *
 * The two shapes are deliberately near-identical; the only structural gap is
 * `thinking`: `ClientConversationTurn` has no reasoning field, so the model's
 * readable reasoning is folded into the assistant turn's content stream as a
 * markdown blockquote at map time (see {@link thinkingToMarkdown}).
 */

import type {
    ReconstructedConversationTurn,
    ReconstructedTimelineItem,
    ReconstructedToolCall,
} from '@plusplusoneplusplus/coc-client';
import type {
    ClientConversationTurn,
    ClientTimelineItem,
    ClientToolCall,
} from '../../types/dashboard';

/**
 * Render a turn's readable reasoning as a markdown blockquote so it folds into
 * the assistant bubble's content stream (the chat components have no dedicated
 * reasoning slot). A trailing blank line keeps the blockquote a separate
 * markdown block from the assistant text that follows it — timeline content
 * items are concatenated without separators before markdown parsing.
 */
export function thinkingToMarkdown(thinking: string): string {
    const quoted = thinking
        .split('\n')
        .map(line => (line.length > 0 ? `> ${line}` : '>'))
        .join('\n');
    return `> 🧠 **Reasoning**\n>\n${quoted}\n\n`;
}

function mapToolCall(toolCall: ReconstructedToolCall): ClientToolCall {
    return {
        id: toolCall.id,
        toolName: toolCall.toolName,
        args: toolCall.args,
        status: toolCall.status,
        ...(toolCall.result !== undefined ? { result: toolCall.result } : {}),
        ...(toolCall.error !== undefined ? { error: toolCall.error } : {}),
        ...(toolCall.startTime !== undefined ? { startTime: toolCall.startTime } : {}),
        ...(toolCall.endTime !== undefined ? { endTime: toolCall.endTime } : {}),
    };
}

function mapTimelineItem(item: ReconstructedTimelineItem): ClientTimelineItem {
    return {
        type: item.type,
        timestamp: item.timestamp,
        ...(item.content !== undefined ? { content: item.content } : {}),
        ...(item.toolCall ? { toolCall: mapToolCall(item.toolCall) } : {}),
    };
}

/** Map a single reconstructed turn into the SPA chat turn shape. */
export function toClientConversationTurn(turn: ReconstructedConversationTurn): ClientConversationTurn {
    const timeline: ClientTimelineItem[] = Array.isArray(turn.timeline)
        ? turn.timeline.map(mapTimelineItem)
        : [];
    let content = turn.content ?? '';

    // Fold assistant reasoning into the content stream. Prepending a content
    // timeline item makes it render above the assistant text (assistant turns
    // render from the timeline); also prepending to `content` covers the
    // tool-only / empty-timeline fallback path and keeps copy/raw faithful.
    if (turn.role === 'assistant' && turn.thinking) {
        const reasoning = thinkingToMarkdown(turn.thinking);
        timeline.unshift({ type: 'content', timestamp: turn.timestamp ?? '', content: reasoning });
        content = content ? `${reasoning}${content}` : reasoning;
    }

    const mapped: ClientConversationTurn = {
        role: turn.role,
        content,
        timeline,
    };
    if (turn.timestamp !== undefined) mapped.timestamp = turn.timestamp;
    if (turn.turnIndex !== undefined) mapped.turnIndex = turn.turnIndex;
    if (turn.toolCalls && turn.toolCalls.length > 0) mapped.toolCalls = turn.toolCalls.map(mapToolCall);
    if (turn.images && turn.images.length > 0) mapped.images = turn.images;
    if (turn.skillNames && turn.skillNames.length > 0) mapped.skillNames = turn.skillNames;
    if (turn.model) mapped.model = turn.model;
    if (turn.isError) mapped.isError = true;
    return mapped;
}

/** Map a reconstructed conversation into SPA chat turns (empty when absent). */
export function toClientConversationTurns(
    conversation: ReconstructedConversationTurn[] | undefined | null,
): ClientConversationTurn[] {
    if (!Array.isArray(conversation)) return [];
    return conversation.map(toClientConversationTurn);
}
