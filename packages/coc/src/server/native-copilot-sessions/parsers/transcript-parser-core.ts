/**
 * Shared reconstruction helpers for native CLI transcript parsers.
 *
 * Every helper here is provider-agnostic: JSONL tolerance, turn construction,
 * text/thinking/image block extraction, and tool-call bookkeeping. Provider
 * modules own only the envelope shape of their own CLI, so a Codex envelope
 * change cannot regress the Claude parser (or the reverse).
 */
import type {
    ReconstructedConversationTurn,
    ReconstructedTimelineItem,
    ReconstructedToolCall,
} from '../types';

export function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

export function asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

export function stringFromUnknown(value: unknown): string | undefined {
    if (typeof value === 'string') {
        return value;
    }
    if (value === undefined || value === null) {
        return undefined;
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

export function parseJsonl(rawJsonl: string): Record<string, unknown>[] {
    const records: Record<string, unknown>[] = [];
    for (const line of rawJsonl.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        try {
            const parsed = JSON.parse(trimmed);
            const rec = asRecord(parsed);
            if (rec) {
                records.push(rec);
            }
        } catch {
            // External CLI logs may be partially written. Keep usable lines.
        }
    }
    return records;
}

export function newTurn(role: 'user' | 'assistant', timestamp?: string): ReconstructedConversationTurn {
    return { role, content: '', timestamp, timeline: [] };
}

export function appendText(turn: ReconstructedConversationTurn, text: string, timestamp?: string): void {
    if (!text) {
        return;
    }
    turn.content = turn.content ? `${turn.content}\n\n${text}` : text;
    if (turn.role === 'assistant') {
        turn.timeline.push({ type: 'content', timestamp: timestamp ?? '', content: text });
    }
}

export function appendThinking(turn: ReconstructedConversationTurn, text: string): void {
    if (!text) {
        return;
    }
    turn.thinking = turn.thinking ? `${turn.thinking}\n\n${text}` : text;
}

export function stampTurnIndexes(turns: ReconstructedConversationTurn[]): ReconstructedConversationTurn[] | null {
    const visible = turns.filter(turn => {
        return turn.content.length > 0
            || Boolean(turn.thinking)
            || (turn.toolCalls?.length ?? 0) > 0
            || (turn.images?.length ?? 0) > 0;
    });
    if (visible.length === 0) {
        return null;
    }
    visible.forEach((turn, index) => {
        turn.turnIndex = index;
    });
    return visible;
}

export function dataUrlFromImageBlock(block: Record<string, unknown>): string | undefined {
    const source = asRecord(block.source);
    const data = asString(source?.data) ?? asString(block.data);
    const mediaType = asString(source?.media_type) ?? asString(source?.mime_type) ?? asString(block.mime_type);
    if (!data || !mediaType || !mediaType.startsWith('image/')) {
        return undefined;
    }
    return data.startsWith('data:') ? data : `data:${mediaType};base64,${data}`;
}

export function isDataImageUrl(value: string): boolean {
    return /^data:image\/[^;]+;base64,/i.test(value.trim());
}

export function extractCodexEventImages(payload: Record<string, unknown>): { images: string[]; localImages: string[] } {
    const images: string[] = [];
    const rawImages = payload.images;
    if (Array.isArray(rawImages)) {
        for (const value of rawImages) {
            if (typeof value === 'string') {
                if (isDataImageUrl(value)) {
                    images.push(value);
                }
                continue;
            }
            const block = asRecord(value);
            const image = block ? dataUrlFromImageBlock(block) : undefined;
            if (image) {
                images.push(image);
            }
        }
    }

    const localImages = Array.isArray(payload.local_images)
        ? payload.local_images.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : [];

    return { images, localImages };
}

export function extractTextFromBlocks(blocks: unknown): { text: string[]; thinking: string[]; images: string[] } {
    const text: string[] = [];
    const thinking: string[] = [];
    const images: string[] = [];
    if (!Array.isArray(blocks)) {
        const fallback = asString(blocks);
        return { text: fallback ? [fallback] : [], thinking, images };
    }
    for (const entry of blocks) {
        const block = asRecord(entry);
        if (!block) {
            continue;
        }
        const type = asString(block.type);
        const maybeText = asString(block.text) ?? asString(block.input_text) ?? asString(block.output_text);
        if (maybeText && (type === 'text' || type === 'input_text' || type === 'output_text' || !type)) {
            text.push(maybeText);
            continue;
        }
        const maybeThinking = asString(block.thinking) ?? asString(block.summary);
        if (maybeText && type === 'summary_text') {
            thinking.push(maybeText);
            continue;
        }
        if (maybeThinking && (type === 'thinking' || type === 'reasoning' || type === 'summary_text')) {
            thinking.push(maybeThinking);
            continue;
        }
        if (type === 'image' || type === 'input_image' || type === 'local_image') {
            const image = dataUrlFromImageBlock(block);
            if (image) {
                images.push(image);
            }
        }
    }
    return { text, thinking, images };
}

export function addToolStart(
    turn: ReconstructedConversationTurn,
    toolCallsById: Map<string, ReconstructedToolCall>,
    id: string,
    toolName: string,
    args: unknown,
    timestamp?: string,
): ReconstructedToolCall {
    const toolCall: ReconstructedToolCall = {
        id,
        toolName,
        args,
        status: 'running',
        startTime: timestamp,
    };
    toolCallsById.set(id, toolCall);
    (turn.toolCalls ??= []).push(toolCall);
    turn.timeline.push({ type: 'tool-start', timestamp: timestamp ?? '', toolCall });
    return toolCall;
}

export function addToolResult(
    owner: ReconstructedConversationTurn | null,
    toolCall: ReconstructedToolCall | undefined,
    result: unknown,
    isError: boolean,
    timestamp?: string,
): void {
    if (!toolCall) {
        return;
    }
    toolCall.status = isError ? 'failed' : 'completed';
    toolCall.endTime = timestamp;
    const resultText = stringFromUnknown(result);
    if (isError) {
        toolCall.error = resultText ?? 'Tool call failed';
    } else if (resultText !== undefined) {
        toolCall.result = resultText;
    }
    owner?.timeline.push({
        type: isError ? 'tool-failed' : 'tool-complete',
        timestamp: timestamp ?? '',
        toolCall,
    });
}

export function parseMaybeJson(value: unknown): unknown {
    if (typeof value !== 'string') {
        return value;
    }
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}
