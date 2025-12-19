/**
 * Utilities for working with syntax-highlighted HTML (e.g., highlight.js output).
 *
 * highlight.js can emit tags (typically <span>) that span across newline boundaries.
 * If we naïvely split the HTML string by '\n' and wrap each line in its own element,
 * we can end up with unbalanced tags per line which causes DOM nesting issues
 * (e.g., nested `.code-line` spans and visually "extra" blank lines).
 *
 * This helper splits highlighted HTML into per-line fragments while keeping each
 * fragment tag-balanced by temporarily closing and reopening open <span> tags.
 */

function normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function isOpeningSpanTag(tag: string): boolean {
    return /^<span\b/i.test(tag) && !/^<\/span\b/i.test(tag) && !/\/>\s*$/.test(tag);
}

function isClosingSpanTag(tag: string): boolean {
    return /^<\/span\s*>/i.test(tag);
}

/**
 * Split highlight.js HTML into per-line HTML fragments with balanced tags per line.
 *
 * - Keeps track of currently open <span ...> tags.
 * - On newline boundaries, closes all currently open spans for the current line,
 *   then reopens them at the start of the next line.
 *
 * This ensures each returned line fragment can be safely wrapped in its own element
 * without causing mis-nesting of later wrappers.
 */
export function splitHighlightedHtmlIntoLines(highlightedHtml: string): string[] {
    const html = normalizeLineEndings(highlightedHtml);

    const openSpanStack: string[] = [];
    const lines: string[] = [];

    let current = '';
    let i = 0;

    const closeOpenSpans = (): string => '</span>'.repeat(openSpanStack.length);
    const reopenOpenSpans = (): string => openSpanStack.join('');

    while (i < html.length) {
        const ch = html[i];

        if (ch === '<') {
            const end = html.indexOf('>', i);
            if (end === -1) {
                // Malformed HTML; treat remainder as text
                current += html.slice(i);
                break;
            }

            const tag = html.slice(i, end + 1);

            if (isOpeningSpanTag(tag)) {
                openSpanStack.push(tag);
                current += tag;
            } else if (isClosingSpanTag(tag)) {
                if (openSpanStack.length > 0) {
                    openSpanStack.pop();
                }
                current += tag;
            } else {
                // Other tags: preserve as-is
                current += tag;
            }

            i = end + 1;
            continue;
        }

        if (ch === '\n') {
            // Finish this line with balanced tags
            lines.push(current + closeOpenSpans());
            // Start next line with reopened tags
            current = reopenOpenSpans();
            i += 1;
            continue;
        }

        current += ch;
        i += 1;
    }

    // Final line
    lines.push(current + closeOpenSpans());
    return lines;
}


