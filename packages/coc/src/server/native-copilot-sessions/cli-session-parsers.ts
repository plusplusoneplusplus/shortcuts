import type {
    ReconstructedConversationTurn,
    ReconstructedTimelineItem,
    ReconstructedToolCall,
} from './types';

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function stringFromUnknown(value: unknown): string | undefined {
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

function parseJsonl(rawJsonl: string): Record<string, unknown>[] {
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

function newTurn(role: 'user' | 'assistant', timestamp?: string): ReconstructedConversationTurn {
    return { role, content: '', timestamp, timeline: [] };
}

function appendText(turn: ReconstructedConversationTurn, text: string, timestamp?: string): void {
    if (!text) {
        return;
    }
    turn.content = turn.content ? `${turn.content}\n\n${text}` : text;
    if (turn.role === 'assistant') {
        turn.timeline.push({ type: 'content', timestamp: timestamp ?? '', content: text });
    }
}

function appendThinking(turn: ReconstructedConversationTurn, text: string): void {
    if (!text) {
        return;
    }
    turn.thinking = turn.thinking ? `${turn.thinking}\n\n${text}` : text;
}

function stampTurnIndexes(turns: ReconstructedConversationTurn[]): ReconstructedConversationTurn[] | null {
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

function dataUrlFromImageBlock(block: Record<string, unknown>): string | undefined {
    const source = asRecord(block.source);
    const data = asString(source?.data) ?? asString(block.data);
    const mediaType = asString(source?.media_type) ?? asString(source?.mime_type) ?? asString(block.mime_type);
    if (!data || !mediaType || !mediaType.startsWith('image/')) {
        return undefined;
    }
    return data.startsWith('data:') ? data : `data:${mediaType};base64,${data}`;
}

function extractTextFromBlocks(blocks: unknown): { text: string[]; thinking: string[]; images: string[] } {
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

function addToolStart(
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

function addToolResult(
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

function parseMaybeJson(value: unknown): unknown {
    if (typeof value !== 'string') {
        return value;
    }
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

/**
 * Reconstruct a Claude Code transcript JSONL file into read-only dashboard turns.
 * Malformed lines and unknown block shapes are skipped; returns null when no
 * usable transcript content remains.
 */
export function parseClaudeTranscript(rawJsonl: string): ReconstructedConversationTurn[] | null {
    const turns: ReconstructedConversationTurn[] = [];
    const toolCallsById = new Map<string, ReconstructedToolCall>();
    const toolOwnersById = new Map<string, ReconstructedConversationTurn>();
    let currentAssistant: ReconstructedConversationTurn | null = null;

    for (const rec of parseJsonl(rawJsonl)) {
        const type = asString(rec.type);
        if (type !== 'user' && type !== 'assistant') {
            continue;
        }
        const timestamp = asString(rec.timestamp);
        const message = asRecord(rec.message);
        const role = asString(message?.role) ?? type;
        const content = message?.content;

        if (role === 'user') {
            const extracted = extractTextFromBlocks(content);
            const hasToolResults = Array.isArray(content)
                && content.some(block => asString(asRecord(block)?.type) === 'tool_result');
            if (extracted.text.length > 0 || extracted.images.length > 0) {
                const turn = newTurn('user', timestamp);
                for (const text of extracted.text) {
                    appendText(turn, text, timestamp);
                }
                if (extracted.images.length > 0) {
                    turn.images = extracted.images;
                }
                turns.push(turn);
                currentAssistant = null;
            } else if (!hasToolResults && typeof content === 'string') {
                const turn = newTurn('user', timestamp);
                appendText(turn, content, timestamp);
                turns.push(turn);
                currentAssistant = null;
            }
            if (Array.isArray(content)) {
                for (const blockValue of content) {
                    const block = asRecord(blockValue);
                    if (!block || asString(block.type) !== 'tool_result') {
                        continue;
                    }
                    const toolUseId = asString(block.tool_use_id);
                    const toolCall = toolUseId ? toolCallsById.get(toolUseId) : undefined;
                    const owner = toolUseId ? toolOwnersById.get(toolUseId) ?? currentAssistant : currentAssistant;
                    const extractedResult = extractTextFromBlocks(block.content);
                    const result = extractedResult.text.length > 0 ? extractedResult.text.join('\n\n') : block.content;
                    addToolResult(owner, toolCall, result, block.is_error === true, timestamp);
                }
            }
            continue;
        }

        if (role !== 'assistant') {
            continue;
        }
        currentAssistant = newTurn('assistant', timestamp);
        const model = asString(message?.model);
        if (model) {
            currentAssistant.model = model;
        }
        if (Array.isArray(content)) {
            for (const blockValue of content) {
                const block = asRecord(blockValue);
                if (!block) {
                    continue;
                }
                const blockType = asString(block.type);
                if (blockType === 'tool_use') {
                    const id = asString(block.id);
                    if (!id) {
                        continue;
                    }
                    const toolCall = addToolStart(
                        currentAssistant,
                        toolCallsById,
                        id,
                        asString(block.name) ?? 'unknown',
                        block.input,
                        timestamp,
                    );
                    toolOwnersById.set(toolCall.id, currentAssistant);
                    continue;
                }
                const extracted = extractTextFromBlocks([block]);
                for (const text of extracted.text) {
                    appendText(currentAssistant, text, timestamp);
                }
                for (const thinking of extracted.thinking) {
                    appendThinking(currentAssistant, thinking);
                }
                if (extracted.images.length > 0) {
                    currentAssistant.images = [...(currentAssistant.images ?? []), ...extracted.images];
                }
            }
        } else {
            const text = asString(content);
            if (text) {
                appendText(currentAssistant, text, timestamp);
            }
        }
        turns.push(currentAssistant);
    }

    return stampTurnIndexes(turns);
}

/**
 * Reconstruct an OpenAI Codex CLI rollout JSONL file into read-only dashboard
 * turns. The Codex rollout envelope is intentionally treated defensively so
 * newly-added event payloads do not break older CoC readers.
 */
export function parseCodexRollout(rawJsonl: string): ReconstructedConversationTurn[] | null {
    const turns: ReconstructedConversationTurn[] = [];
    const toolCallsById = new Map<string, ReconstructedToolCall>();
    const toolOwnersById = new Map<string, ReconstructedConversationTurn>();
    let currentAssistant: ReconstructedConversationTurn | null = null;
    let currentModel: string | undefined;

    for (const rec of parseJsonl(rawJsonl)) {
        const timestamp = asString(rec.timestamp);
        const envelopeType = asString(rec.type);
        const payload = asRecord(rec.payload);
        if (!payload) {
            continue;
        }

        if (envelopeType === 'turn_context') {
            currentModel = asString(payload.model) ?? currentModel;
            continue;
        }
        if (envelopeType !== 'response_item') {
            continue;
        }

        const itemType = asString(payload.type);
        if (itemType === 'message') {
            const role = asString(payload.role);
            if (role === 'user') {
                const extracted = extractTextFromBlocks(payload.content);
                if (extracted.text.length === 0 && extracted.images.length === 0) {
                    continue;
                }
                const turn = newTurn('user', timestamp);
                for (const text of extracted.text) {
                    appendText(turn, text, timestamp);
                }
                if (extracted.images.length > 0) {
                    turn.images = extracted.images;
                }
                turns.push(turn);
                currentAssistant = null;
                continue;
            }
            if (role === 'assistant') {
                currentAssistant = newTurn('assistant', timestamp);
                if (currentModel) {
                    currentAssistant.model = currentModel;
                }
                const extracted = extractTextFromBlocks(payload.content);
                for (const text of extracted.text) {
                    appendText(currentAssistant, text, timestamp);
                }
                for (const thinking of extracted.thinking) {
                    appendThinking(currentAssistant, thinking);
                }
                if (extracted.images.length > 0) {
                    currentAssistant.images = extracted.images;
                }
                turns.push(currentAssistant);
            }
            continue;
        }

        if (itemType === 'reasoning') {
            if (!currentAssistant) {
                currentAssistant = newTurn('assistant', timestamp);
                if (currentModel) {
                    currentAssistant.model = currentModel;
                }
                turns.push(currentAssistant);
            }
            const summary = extractTextFromBlocks(payload.summary);
            for (const thinking of summary.text.length > 0 ? summary.text : summary.thinking) {
                appendThinking(currentAssistant, thinking);
            }
            const encrypted = asString(payload.encrypted_content);
            if (!currentAssistant.thinking && encrypted) {
                appendThinking(currentAssistant, '[encrypted reasoning]');
            }
            continue;
        }

        if (itemType === 'function_call') {
            if (!currentAssistant) {
                currentAssistant = newTurn('assistant', timestamp);
                if (currentModel) {
                    currentAssistant.model = currentModel;
                }
                turns.push(currentAssistant);
            }
            const id = asString(payload.call_id) ?? asString(payload.id);
            if (!id) {
                continue;
            }
            const toolCall = addToolStart(
                currentAssistant,
                toolCallsById,
                id,
                asString(payload.name) ?? 'unknown',
                parseMaybeJson(payload.arguments),
                timestamp,
            );
            toolOwnersById.set(toolCall.id, currentAssistant);
            continue;
        }

        if (itemType === 'function_call_output') {
            const id = asString(payload.call_id) ?? asString(payload.id);
            const toolCall = id ? toolCallsById.get(id) : undefined;
            const owner = id ? toolOwnersById.get(id) ?? currentAssistant : currentAssistant;
            const isError = payload.is_error === true || asString(payload.status) === 'failed';
            addToolResult(owner, toolCall, payload.output, isError, timestamp);
        }
    }

    return stampTurnIndexes(turns);
}
