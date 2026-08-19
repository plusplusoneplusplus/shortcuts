/**
 * OpenAI Codex CLI rollout reconstruction (`~/.codex/sessions` rollout JSONL files).
 *
 * Owns only the Codex `response_item` / `event_msg` envelope. Shared
 * turn/tool/text mechanics live in `transcript-parser-core`.
 */

import type { ReconstructedConversationTurn, ReconstructedToolCall } from '../types';
import {
    addToolResult,
    addToolStart,
    appendText,
    appendThinking,
    asRecord,
    asString,
    extractCodexEventImages,
    extractTextFromBlocks,
    newTurn,
    parseJsonl,
    parseMaybeJson,
    stampTurnIndexes,
} from './transcript-parser-core';

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
        if (envelopeType === 'event_msg' && asString(payload.type) === 'user_message') {
            const message = asString(payload.message);
            const { images, localImages } = extractCodexEventImages(payload);
            if (!message && images.length === 0 && localImages.length === 0) {
                continue;
            }

            const previous = turns[turns.length - 1];
            const turn = previous?.role === 'user' && (!message || previous.content === message)
                ? previous
                : newTurn('user', timestamp);

            if (turn !== previous) {
                if (message) {
                    appendText(turn, message, timestamp);
                }
                turns.push(turn);
            }
            if (images.length > 0) {
                turn.images = [...(turn.images ?? []), ...images];
            }
            if (localImages.length > 0) {
                appendText(
                    turn,
                    localImages.map(imagePath => `Attached local image: \`${imagePath}\``).join('\n'),
                    timestamp,
                );
            }
            currentAssistant = null;
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
