/**
 * Normalize line endings to LF. Used by Ralph parsers and CSV reading.
 */
export function normalizeNewlines(text: string): string {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Extract a JSON object string from text that may contain fenced code blocks
 * or bare JSON. Tries fenced ```json blocks first, then brace-depth matching.
 * Returns null if no JSON object is found.
 */
export function extractJsonObjectString(text: string): string | null {
    const fenced = /```json\s*\n([\s\S]*?)\n```/m.exec(text);
    if (fenced) {
        return fenced[1].trim();
    }

    const start = text.indexOf('{');
    if (start === -1) {
        return null;
    }

    let depth = 0;
    for (let i = start; i < text.length; i++) {
        if (text[i] === '{') {
            depth++;
        } else if (text[i] === '}') {
            depth--;
            if (depth === 0) {
                return text.slice(start, i + 1);
            }
        }
    }

    return null;
}
