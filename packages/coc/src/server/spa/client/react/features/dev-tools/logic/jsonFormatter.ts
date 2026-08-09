/**
 * JSON pretty-printer, minifier and validator.
 *
 * JSON only — the repo carries no YAML parser and the panel adds no
 * dependencies, so the card is named "JSON formatter" rather than
 * "JSON / YAML".
 *
 * `JSON.parse` messages differ between engines but every one of them carries
 * either a character position or a line/column, so the position is recovered
 * from the message and translated back into line/column against the input.
 *
 * React-free; parse failures come back as errors.
 */

export type JsonResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const MIN_JSON_INDENT = 0;
export const MAX_JSON_INDENT = 8;

/** Turn a 0-based character offset into a human 1-based line/column. */
export function positionToLineColumn(text: string, offset: number): { line: number; column: number } {
    const clamped = Math.max(0, Math.min(offset, text.length));
    const before = text.slice(0, clamped);
    const lastBreak = before.lastIndexOf('\n');
    return { line: before.split('\n').length, column: clamped - lastBreak };
}

/**
 * Rewrite a `JSON.parse` error into `<message> (line L, column C)` when the
 * engine gave us enough to locate it.
 */
function describeParseError(error: unknown, text: string): string {
    const message = error instanceof Error ? error.message : 'Invalid JSON';
    const positionMatch = /at position (\d+)/.exec(message);
    if (positionMatch) {
        const { line, column } = positionToLineColumn(text, Number(positionMatch[1]));
        // V8 ≥ 20 already appends "(line X column Y)"; don't double it up.
        if (/line \d+/.test(message)) return message;
        return `${message} (line ${line}, column ${column})`;
    }
    return message;
}

/** Parse `text`, returning the value or a located error message. */
export function parseJson(text: string): JsonResult<unknown> {
    if (!text.trim()) return { ok: false, error: 'Enter some JSON' };
    try {
        return { ok: true, value: JSON.parse(text) };
    } catch (error) {
        return { ok: false, error: describeParseError(error, text) };
    }
}

/** Pretty-print with `indent` spaces (0 collapses to the minified form). */
export function formatJson(text: string, indent: number): JsonResult<string> {
    if (!Number.isInteger(indent) || indent < MIN_JSON_INDENT || indent > MAX_JSON_INDENT) {
        return { ok: false, error: `Indent must be a whole number from ${MIN_JSON_INDENT} to ${MAX_JSON_INDENT}` };
    }
    const parsed = parseJson(text);
    if (!parsed.ok) return parsed;
    return { ok: true, value: JSON.stringify(parsed.value, null, indent) };
}

/** Re-emit with all insignificant whitespace removed. */
export function minifyJson(text: string): JsonResult<string> {
    const parsed = parseJson(text);
    if (!parsed.ok) return parsed;
    return { ok: true, value: JSON.stringify(parsed.value) };
}

export interface JsonStats {
    bytes: number;
    keys: number;
    depth: number;
}

/** Size, key count and nesting depth, shown under the output as a sanity check. */
export function describeJson(value: unknown, serialized: string): JsonStats {
    let keys = 0;
    const depthOf = (node: unknown): number => {
        if (Array.isArray(node)) {
            return 1 + node.reduce<number>((max, item) => Math.max(max, depthOf(item)), 0);
        }
        if (node !== null && typeof node === 'object') {
            const entries = Object.values(node as Record<string, unknown>);
            keys += entries.length;
            return 1 + entries.reduce<number>((max, item) => Math.max(max, depthOf(item)), 0);
        }
        return 0;
    };
    const depth = depthOf(value);
    return { bytes: new TextEncoder().encode(serialized).length, keys, depth };
}
