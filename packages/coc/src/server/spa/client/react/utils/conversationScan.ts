import type { ClientConversationTurn, ClientToolCall } from '../types/dashboard';

const CREATE_TOOL_NAMES = new Set(['create', 'write_file', 'create_file']);

/** File extensions considered "plan/doc" files worth pinning */
export const PINNED_EXTENSIONS = ['.md', '.txt', '.yaml', '.yml', '.json'];

/** Regex to extract file path from tool-complete result prose. */
const CREATED_FILE_RE = /Created file (.+\.\w+)/;

export interface CreatedFileRecord {
    filePath: string;
    toolCall: ClientToolCall;
    turnIndex: number;
}

/** Resolve the effective tool name, falling back to the raw `name` field on persisted entries. */
function resolveToolName(tc: ClientToolCall): string {
    return tc.toolName || (tc as any).name || '';
}

/**
 * Build a map from toolCallId → args using tool-start timeline entries.
 * tool-start events carry the full parameters while tool-complete may not.
 */
function buildToolStartArgsMap(
    timeline: ClientConversationTurn['timeline']
): Map<string, Record<string, any>> {
    const map = new Map<string, Record<string, any>>();
    for (const item of timeline ?? []) {
        if (item.type === 'tool-start' && item.toolCall) {
            const args = typeof item.toolCall.args === 'object' ? item.toolCall.args ?? {} : {};
            if (item.toolCall.id && Object.keys(args).length > 0) {
                map.set(item.toolCall.id, args);
            }
        }
    }
    return map;
}

/** Try to extract a file path from tool-complete result text. */
function parseFilePathFromResult(result: string | undefined): string {
    if (!result) return '';
    const match = CREATED_FILE_RE.exec(result);
    return match?.[1] ?? '';
}

/**
 * Scan all turns for completed create/write_file/create_file tool calls.
 * Uses turn.timeline (has status) with fallback to turn.toolCalls
 * for historical turns loaded without timeline data.
 *
 * Handles three data-shape variations:
 * 1. Normal: toolName + args.path present on tool-complete
 * 2. Persisted: name (not toolName) field, args may be empty
 * 3. Live SSE: toolName='unknown', args={} — resolved via tool-start or result parsing
 */
export function scanTurnsForCreatedFiles(
    turns: ClientConversationTurn[]
): CreatedFileRecord[] {
    const seen = new Set<string>();
    const results: CreatedFileRecord[] = [];

    for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        const toolCalls: ClientToolCall[] = [];

        // Build args lookup from tool-start entries (carries full parameters)
        const toolStartArgs = buildToolStartArgsMap(turn.timeline);

        // Also build a toolName lookup from tool-start entries
        const toolStartNames = new Map<string, string>();
        for (const item of turn.timeline ?? []) {
            if (item.type === 'tool-start' && item.toolCall) {
                const name = resolveToolName(item.toolCall);
                if (item.toolCall.id && name) {
                    toolStartNames.set(item.toolCall.id, name);
                }
            }
        }

        // Primary: timeline events (live + recent history)
        for (const item of turn.timeline ?? []) {
            if (item.type === 'tool-complete' && item.toolCall) {
                toolCalls.push(item.toolCall);
            }
        }
        // Fallback: flat toolCalls array (older history format)
        if (toolCalls.length === 0 && turn.toolCalls?.length) {
            toolCalls.push(...turn.toolCalls);
        }

        for (const tc of toolCalls) {
            // Resolve tool name: tc.toolName > tc.name > matching tool-start name
            const effectiveName = resolveToolName(tc) !== 'unknown'
                ? resolveToolName(tc)
                : (tc.id && toolStartNames.get(tc.id)) || resolveToolName(tc);

            if (!CREATE_TOOL_NAMES.has(effectiveName)) continue;

            // Resolve args: tc.args > tool-start args (by toolCallId)
            let args = typeof tc.args === 'object' ? tc.args ?? {} : {};
            const hasPath = args.path || args.filePath;
            if (!hasPath && tc.id && toolStartArgs.has(tc.id)) {
                args = toolStartArgs.get(tc.id)!;
            }

            let filePath: string = args.path || args.filePath || '';

            // Last resort: parse file path from result text
            if (!filePath && tc.result) {
                filePath = parseFilePathFromResult(tc.result);
            }

            if (!filePath || seen.has(filePath)) continue;

            const ext = filePath.slice(filePath.lastIndexOf('.'));
            if (!PINNED_EXTENSIONS.includes(ext)) continue;

            seen.add(filePath);
            results.push({ filePath, toolCall: tc, turnIndex: i });
        }
    }

    return results;
}
