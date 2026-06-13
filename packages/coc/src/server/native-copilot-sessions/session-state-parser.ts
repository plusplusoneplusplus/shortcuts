/**
 * Read-only parser for the native GitHub Copilot CLI per-session state log.
 *
 * Each native session keeps a rich event log at
 * `~/.copilot/session-state/<sessionId>/events.jsonl` — a newline-delimited
 * stream of `{ type, id, parentId, timestamp, data }` records covering user and
 * assistant messages, tool calls + results, model reasoning, images, and
 * errors. This module reconstructs that stream into ordered
 * {@link ReconstructedConversationTurn}s so the dashboard can render a native
 * session as a rich CoC chat transcript.
 *
 * This data is external and owned by the Copilot CLI: the parser only reads it
 * and never writes to `~/.copilot`. Missing or malformed input yields `null`
 * (never throws) so the caller can fall back to the flat `session-store.db`.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
    ReconstructedConversationTurn,
    ReconstructedTimelineItem,
    ReconstructedToolCall,
} from './types';

/** Default location of the native per-session state directory for the server user. */
export function getDefaultNativeSessionStateDir(): string {
    return path.join(os.homedir(), '.copilot', 'session-state');
}

export interface ParseNativeSessionStateOptions {
    /** Override of the `session-state` base directory (tests use synthetic fixtures). */
    sessionStateDir?: string;
}

/** One raw `events.jsonl` record. `data` shape varies by `type`. */
interface RawEvent {
    type?: unknown;
    timestamp?: unknown;
    data?: Record<string, unknown> | null;
}

/** Reject session ids that could escape the session-state directory. */
function isSafeSessionId(sessionId: string): boolean {
    return sessionId.length > 0
        && !sessionId.includes('/')
        && !sessionId.includes('\\')
        && !sessionId.includes('\0')
        && sessionId !== '.'
        && sessionId !== '..';
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

/**
 * Collect base64 data-URL images from a `user.message` attachments array.
 * Only embedded base64 attachments can be rendered inline; file-path
 * attachments (`{ type:'file', path, displayName }`) cannot be read here and
 * are surfaced as a text note by the caller instead.
 */
function collectImages(attachments: unknown): string[] {
    if (!Array.isArray(attachments)) {
        return [];
    }
    const images: string[] = [];
    for (const entry of attachments) {
        const rec = asRecord(entry);
        if (!rec) {
            continue;
        }
        const data = asString(rec.data);
        const mimeType = asString(rec.mimeType) ?? asString(rec.mediaType);
        if (data && mimeType && mimeType.startsWith('image/')) {
            images.push(data.startsWith('data:') ? data : `data:${mimeType};base64,${data}`);
        }
    }
    return images;
}

/** Extract the tool result text, preferring the full detailed content. */
function extractResult(result: unknown): string | undefined {
    const rec = asRecord(result);
    if (!rec) {
        return asString(result);
    }
    return asString(rec.detailedContent) ?? asString(rec.content);
}

/**
 * Parse a native session's `events.jsonl` into ordered conversation turns.
 *
 * Returns `null` when the log is missing, unreadable, or yields no usable
 * turns (malformed) — the caller then falls back to `session-store.db`.
 */
export function parseNativeSessionState(
    sessionId: string,
    options: ParseNativeSessionStateOptions = {},
): ReconstructedConversationTurn[] | null {
    try {
        if (!isSafeSessionId(sessionId)) {
            return null;
        }
        const baseDir = options.sessionStateDir ?? getDefaultNativeSessionStateDir();
        const eventsPath = path.join(baseDir, sessionId, 'events.jsonl');
        if (!fs.existsSync(eventsPath)) {
            return null;
        }
        const raw = fs.readFileSync(eventsPath, 'utf8');
        return reconstructTurns(raw);
    } catch {
        return null;
    }
}

/**
 * Reconstruct ordered turns from the raw `events.jsonl` text. Exposed for unit
 * testing without touching the filesystem. Returns `null` when no usable turns
 * could be reconstructed.
 */
export function reconstructTurns(rawJsonl: string): ReconstructedConversationTurn[] | null {
    const turns: ReconstructedConversationTurn[] = [];
    // Tool calls are correlated start↔complete by toolCallId across events.
    const toolCallsById = new Map<string, ReconstructedToolCall>();
    let currentAssistant: ReconstructedConversationTurn | null = null;
    let currentTurnId: string | undefined;
    let validEvents = 0;

    const newTurn = (role: 'user' | 'assistant', timestamp?: string): ReconstructedConversationTurn => ({
        role,
        content: '',
        timestamp,
        timeline: [],
    });

    for (const line of rawJsonl.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        let event: RawEvent;
        try {
            event = JSON.parse(trimmed) as RawEvent;
        } catch {
            // Skip a single malformed line; a partially-written log stays usable.
            continue;
        }
        const type = asString(event.type);
        const data = asRecord(event.data);
        if (!type) {
            continue;
        }
        const timestamp = asString(event.timestamp);
        validEvents += 1;

        switch (type) {
            case 'user.message': {
                currentAssistant = null;
                currentTurnId = undefined;
                const turn = newTurn('user', timestamp);
                turn.content = asString(data?.content) ?? '';
                const images = collectImages(data?.attachments);
                if (images.length > 0) {
                    turn.images = images;
                }
                turns.push(turn);
                break;
            }
            case 'assistant.message': {
                const turnId = asString(data?.turnId);
                // Coalesce consecutive assistant messages of the same model turn.
                if (!currentAssistant || (turnId !== undefined && turnId !== currentTurnId)) {
                    currentAssistant = newTurn('assistant', timestamp);
                    turns.push(currentAssistant);
                    currentTurnId = turnId;
                }
                const text = asString(data?.content);
                if (text) {
                    currentAssistant.content = currentAssistant.content
                        ? `${currentAssistant.content}\n\n${text}`
                        : text;
                    currentAssistant.timeline.push({
                        type: 'content',
                        timestamp: timestamp ?? '',
                        content: text,
                    });
                }
                const reasoning = asString(data?.reasoningText);
                if (reasoning) {
                    currentAssistant.thinking = currentAssistant.thinking
                        ? `${currentAssistant.thinking}\n\n${reasoning}`
                        : reasoning;
                }
                const model = asString(data?.model);
                if (model && !currentAssistant.model) {
                    currentAssistant.model = model;
                }
                break;
            }
            case 'tool.execution_start': {
                const toolCallId = asString(data?.toolCallId);
                if (!toolCallId) {
                    break;
                }
                // A tool call always belongs to an assistant turn; synthesize one
                // if the log starts mid-stream without a preceding message.
                if (!currentAssistant) {
                    currentAssistant = newTurn('assistant', timestamp);
                    turns.push(currentAssistant);
                }
                const toolCall: ReconstructedToolCall = {
                    id: toolCallId,
                    toolName: asString(data?.toolName) ?? 'unknown',
                    args: data?.arguments,
                    status: 'running',
                    startTime: timestamp,
                };
                toolCallsById.set(toolCallId, toolCall);
                (currentAssistant.toolCalls ??= []).push(toolCall);
                currentAssistant.timeline.push({
                    type: 'tool-start',
                    timestamp: timestamp ?? '',
                    toolCall,
                });
                break;
            }
            case 'tool.execution_complete': {
                const toolCallId = asString(data?.toolCallId);
                if (!toolCallId) {
                    break;
                }
                const toolCall = toolCallsById.get(toolCallId);
                if (!toolCall) {
                    break;
                }
                const success = data?.success !== false;
                toolCall.status = success ? 'completed' : 'failed';
                toolCall.endTime = timestamp;
                if (success) {
                    const result = extractResult(data?.result);
                    if (result !== undefined) {
                        toolCall.result = result;
                    }
                } else {
                    const err = asRecord(data?.error);
                    toolCall.error = asString(err?.message) ?? asString(data?.error) ?? 'Tool call failed';
                }
                const owner = currentAssistant;
                if (owner) {
                    owner.timeline.push({
                        type: success ? 'tool-complete' : 'tool-failed',
                        timestamp: timestamp ?? '',
                        toolCall,
                    });
                }
                break;
            }
            case 'skill.invoked': {
                const name = asString(data?.name);
                if (name && currentAssistant) {
                    (currentAssistant.skillNames ??= []).push(name);
                }
                break;
            }
            default:
                // system.message, hook.*, permission.*, external_tool.*,
                // session.*, subagent.*, assistant.turn_start/end — not part of
                // the rendered transcript.
                break;
        }
    }

    if (validEvents === 0 || turns.length === 0) {
        return null;
    }

    // Stamp a stable turn index for the renderer.
    turns.forEach((turn, index) => {
        turn.turnIndex = index;
    });
    return turns;
}
