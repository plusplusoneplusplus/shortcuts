/**
 * Line-reference helpers shared by every file viewer.
 *
 * A file reference may carry a `:line` or `:start-end` suffix; turning that
 * into a range needs the file's line count, so the two live together.
 */

import type { LineRange } from './types';

/** Split file text into display lines, dropping a single trailing newline. */
export function toLines(content: string): string[] {
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines;
}

/**
 * Resolve a `:line` / `:start-end` reference into a clamped 1-based inclusive
 * range, or `null` when no line was referenced (open at top, no highlight).
 */
export function resolveLineRange(
    line: number | undefined,
    endLine: number | undefined,
    total: number,
): LineRange | null {
    if (!line || line < 1 || total < 1) {
        return null;
    }
    const start = Math.min(line, total);
    const end = endLine && endLine >= start ? Math.min(endLine, total) : start;
    return { start, end };
}
