/**
 * Tool-kind classification + metric extraction helpers used by the
 * "whisper-row" compact rendering variant. Pure, side-effect-free.
 *
 * Visual contract per reference design:
 *   - Each tool call renders as a flat row inside a tool-list:
 *       [kind pill]  [path / summary]  [metric]  [duration]  [chevron]
 *   - The kind pill is color-coded by tool category (read/grep/edit/shell/...).
 *   - The metric is a short result-derived stat (lines, hits, files, +N −M, ...).
 */

import { normalizeToolName } from './toolNormalization';

export type ToolKindClass =
    | 'read'
    | 'grep'
    | 'glob'
    | 'edit'
    | 'write'
    | 'shell'
    | 'sql'
    | 'agent'
    | 'task'
    | 'other';

export interface ToolKindInfo {
    /** Short label rendered inside the kind pill (e.g. "Read", "Grep"). */
    label: string;
    /** CSS class group (read|grep|edit|...) used for color coding. */
    cls: ToolKindClass;
}

/**
 * Maps a raw tool name (from the AI SDK) to a UI kind label + class.
 * Unknown tools fall back to a neutral pill with the original name truncated.
 */
export function getToolKindInfo(toolName: string): ToolKindInfo {
    const canonicalName = normalizeToolName(toolName);
    switch (canonicalName) {
        case 'view':
        case 'read':
            return { label: 'Read', cls: 'read' };
        case 'grep':
            return { label: 'Grep', cls: 'grep' };
        case 'glob':
            return { label: 'Glob', cls: 'glob' };
        case 'edit':
            return { label: 'Edit', cls: 'edit' };
        case 'apply_patch':
            return { label: 'Patch', cls: 'edit' };
        case 'create':
            return { label: 'Write', cls: 'write' };
        case 'bash':
            return { label: 'Bash', cls: 'shell' };
        case 'shell':
            return { label: 'Shell', cls: 'shell' };
        case 'powershell':
            return { label: 'PS', cls: 'shell' };
        case 'sql':
            return { label: 'SQL', cls: 'sql' };
        case 'task':
            return { label: 'Agent', cls: 'agent' };
        case 'read_agent':
            return { label: 'Poll', cls: 'agent' };
        case 'task_complete':
            return { label: 'Done', cls: 'task' };
        case 'skill':
            return { label: 'Skill', cls: 'other' };
        case 'ask_user':
            return { label: 'Ask', cls: 'other' };
        default: {
            const trimmed = canonicalName.length > 8 ? canonicalName.slice(0, 8) : canonicalName;
            return { label: trimmed, cls: 'other' };
        }
    }
}

/**
 * Tailwind class string for the kind pill, keyed off ToolKindClass.
 * Light + dark variants paired with reference design tokens.
 */
export const KIND_PILL_CLASSES: Record<ToolKindClass, string> = {
    read:  'bg-[#ddf4ff] text-[#0969da] dark:bg-[#0969da]/20 dark:text-[#79c0ff]',
    grep:  'bg-[#dafbe1] text-[#15703a] dark:bg-[#15703a]/30 dark:text-[#85e89d]',
    glob:  'bg-[#dafbe1] text-[#15703a] dark:bg-[#15703a]/30 dark:text-[#85e89d]',
    edit:  'bg-[#fff1d6] text-[#9a6700] dark:bg-[#9a6700]/25 dark:text-[#d4a72c]',
    write: 'bg-[#fff1d6] text-[#9a6700] dark:bg-[#9a6700]/25 dark:text-[#d4a72c]',
    shell: 'bg-[#f0e7ff] text-[#6f42c1] dark:bg-[#6f42c1]/25 dark:text-[#b392f0]',
    sql:   'bg-[#f0e7ff] text-[#6f42c1] dark:bg-[#6f42c1]/25 dark:text-[#b392f0]',
    agent: 'bg-[#f0e7ff] text-[#6f42c1] dark:bg-[#6f42c1]/25 dark:text-[#b392f0]',
    task:  'bg-[#dafbe1] text-[#15703a] dark:bg-[#15703a]/30 dark:text-[#85e89d]',
    other: 'bg-[#f5f5f4] text-[#6b7280] dark:bg-[#3c3c3c] dark:text-[#9aa0a6]',
};

/** Counts visible (non-empty) lines in a string of result text. */
function countLines(text: string): number {
    if (!text) return 0;
    let n = 0;
    let inLine = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '\n') {
            if (inLine) n += 1;
            inLine = false;
        } else if (!inLine && ch !== '\r') {
            inLine = true;
        }
    }
    if (inLine) n += 1;
    return n;
}

function formatCount(n: number): string {
    if (n < 1000) return String(n);
    if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`.replace('.0k', 'k');
    return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * Extract a simple metric for the given tool. Best-effort, pure.
 * Returns plain text (no markup); rendering layer wraps add/del segments.
 */
export function getToolMetric(
    toolName: string,
    args: Record<string, any> | null,
    result: string | undefined,
    error: string | undefined,
): { kind: 'plain' | 'diff'; text?: string; insertions?: number; deletions?: number } | null {
    if (error) {
        return { kind: 'plain', text: 'error' };
    }
    const canonicalName = normalizeToolName(toolName);
    const trimmed = (result ?? '').trim();
    switch (canonicalName) {
        case 'view':
        case 'read': {
            if (!trimmed) return null;
            const n = countLines(trimmed);
            return n > 0 ? { kind: 'plain', text: `${formatCount(n)} line${n !== 1 ? 's' : ''}` } : null;
        }
        case 'grep': {
            if (!trimmed) return null;
            const n = countLines(trimmed);
            return n > 0 ? { kind: 'plain', text: `${formatCount(n)} hit${n !== 1 ? 's' : ''}` } : null;
        }
        case 'glob': {
            if (!trimmed) return null;
            const n = countLines(trimmed);
            return n > 0 ? { kind: 'plain', text: `${formatCount(n)} file${n !== 1 ? 's' : ''}` } : null;
        }
        case 'edit': {
            if (!args) return null;
            const oldStr = typeof args.old_str === 'string' ? args.old_str : (typeof args.old_string === 'string' ? args.old_string : '');
            const newStr = typeof args.new_str === 'string' ? args.new_str : (typeof args.new_string === 'string' ? args.new_string : '');
            if (!oldStr && !newStr) return null;
            const oldLines = oldStr ? oldStr.split(/\r?\n/).length : 0;
            const newLines = newStr ? newStr.split(/\r?\n/).length : 0;
            return {
                kind: 'diff',
                insertions: newLines,
                deletions: oldLines,
            };
        }
        case 'create': {
            if (!args) return null;
            const fileText = typeof args.file_text === 'string' ? args.file_text : '';
            if (!fileText) return null;
            const lines = fileText.split(/\r?\n/).length;
            return { kind: 'diff', insertions: lines, deletions: 0 };
        }
        case 'apply_patch': {
            return null;
        }
        case 'bash':
        case 'shell':
        case 'powershell': {
            if (!trimmed) return null;
            const n = countLines(trimmed);
            return n > 0 ? { kind: 'plain', text: `${formatCount(n)} line${n !== 1 ? 's' : ''}` } : null;
        }
        default:
            return null;
    }
}
