/**
 * Compute a single-line, markdown-stripped preview of a conversation message
 * suitable for display in sidebar rows.
 *
 * Strips: fenced code blocks, inline code spans, image markdown, html tags,
 * and link wrappers (kept as visible text). Collapses all whitespace runs
 * to a single space and truncates to `maxLength` chars (default 120).
 *
 * Returns `undefined` if the cleaned content is empty.
 */
export function computeMessagePreview(content: string | undefined | null, maxLength: number = 120): string | undefined {
    if (!content) return undefined;

    let text = content;

    // Drop fenced code blocks entirely (``` ... ```)
    text = text.replace(/```[\s\S]*?```/g, ' ');
    // Drop inline code spans (`code`)
    text = text.replace(/`[^`\n]*`/g, ' ');
    // Drop image markdown ![alt](url)
    text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
    // Unwrap links [text](url) -> text
    text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    // Strip raw HTML tags
    text = text.replace(/<[^>]+>/g, ' ');
    // Collapse all whitespace (including newlines) to single spaces
    text = text.replace(/\s+/g, ' ').trim();

    if (text.length === 0) return undefined;
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength).trimEnd();
}
