import type { ClientConversationTurn, ClientToolCall } from '../types/dashboard';

const CREATE_TOOL_NAMES = new Set(['create', 'write_file']);

/** File extensions considered "plan/doc" files worth pinning */
export const PINNED_EXTENSIONS = ['.md', '.txt', '.yaml', '.yml', '.json'];

export interface CreatedFileRecord {
    filePath: string;
    toolCall: ClientToolCall;
    turnIndex: number;
}

/**
 * Scan all turns for completed create/write_file tool calls.
 * Uses turn.timeline (has status) with fallback to turn.toolCalls
 * for historical turns loaded without timeline data.
 */
export function scanTurnsForCreatedFiles(
    turns: ClientConversationTurn[]
): CreatedFileRecord[] {
    const seen = new Set<string>();
    const results: CreatedFileRecord[] = [];

    for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        const toolCalls: ClientToolCall[] = [];

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
            if (!CREATE_TOOL_NAMES.has(tc.toolName)) continue;
            const args = typeof tc.args === 'object' ? tc.args ?? {} : {};
            const filePath: string = args.path || args.filePath || '';
            if (!filePath || seen.has(filePath)) continue;

            const ext = filePath.slice(filePath.lastIndexOf('.'));
            if (!PINNED_EXTENSIONS.includes(ext)) continue;

            seen.add(filePath);
            results.push({ filePath, toolCall: tc, turnIndex: i });
        }
    }

    return results;
}
