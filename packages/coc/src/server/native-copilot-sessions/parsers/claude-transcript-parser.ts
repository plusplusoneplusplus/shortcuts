/**
 * Claude Code transcript reconstruction (`~/.claude/projects` JSONL files).
 *
 * Owns only the Claude event envelope. Shared turn/tool/text mechanics live
 * in `transcript-parser-core`.
 */

import type { ReconstructedConversationTurn, ReconstructedToolCall } from '../types';
import {
    addToolResult,
    addToolStart,
    appendText,
    appendThinking,
    asRecord,
    asString,
    extractTextFromBlocks,
    newTurn,
    parseJsonl,
    stampTurnIndexes,
} from './transcript-parser-core';

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
