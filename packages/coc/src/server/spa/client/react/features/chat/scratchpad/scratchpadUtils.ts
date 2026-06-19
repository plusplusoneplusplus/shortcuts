import type { ClientConversationTurn } from '../../../types/dashboard';
import { FILE_WRITE_TOOLS } from '../../../utils/fileWriteTools';
import { normalizeToolName } from '../conversation/tool-calls/toolNormalization';

function parseArgs(args: unknown): Record<string, unknown> | null {
    if (!args) return null;
    if (typeof args === 'object') return args as Record<string, unknown>;
    if (typeof args === 'string') {
        try { return JSON.parse(args); } catch { return null; }
    }
    return null;
}

/**
 * Extracts a .md file path from the args of a single tool call.
 * Checks the field names used by the various file-writing tools:
 *   `path`         — edit_file, create, apply_patch
 *   `target_file`  — str_replace_based_edit_tool
 *   `file_path`    — str_replace_editor (some variants)
 *   `filename`     — fallback
 */
function extractMdPath(args: unknown): string | null {
    const parsed = parseArgs(args);
    if (!parsed) return null;
    const candidate =
        parsed.path ??
        parsed.target_file ??
        parsed.file_path ??
        parsed.filename;
    return typeof candidate === 'string' && candidate.endsWith('.md') ? candidate : null;
}

/**
 * Scans all assistant turns (newest first) for note-writing tool calls that target
 * a .md file. Returns the first matching path found, or null if none exists.
 *
 * Prefers `turn.timeline` (most complete, chronological) over `turn.toolCalls`.
 * All assistant turns are examined so that a .md file written in an earlier turn
 * still auto-opens the scratchpad when a completed task is loaded.
 */
export function extractLastWrittenNotePath(turns: ClientConversationTurn[]): string | null {
    for (let i = turns.length - 1; i >= 0; i--) {
        const turn = turns[i];
        if (turn.role !== 'assistant') continue;

        // Prefer timeline (has both in-flight and completed tool calls in order)
        const timelineCalls = turn.timeline
            .filter(item => item.toolCall != null)
            .map(item => item.toolCall!);
        const calls = timelineCalls.length > 0 ? timelineCalls : (turn.toolCalls ?? []);

        for (const tc of calls) {
            // toolName may be on `toolName` or `name` depending on serialisation path.
            // Normalize provider-specific names (e.g. Claude Code's PascalCase
            // Write/Edit/MultiEdit) to canonical create/edit before matching.
            const name: string = normalizeToolName(tc.toolName || (tc as any).name || '');
            if (!FILE_WRITE_TOOLS.has(name)) continue;
            const mdPath = extractMdPath(tc.args);
            if (mdPath) return mdPath;
        }
    }
    return null;
}
