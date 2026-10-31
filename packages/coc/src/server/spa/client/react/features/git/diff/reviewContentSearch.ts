import type { ContentSearchModes } from '../../repo-detail/explorer/types';

export type ReviewSearchSide = 'old' | 'new';
export type ReviewSearchSideFilter = 'both' | ReviewSearchSide;

/** Null denotes an absent side (added/deleted files), rather than an empty file. */
export interface ReviewSearchContents {
    old: string | null;
    new: string | null;
}

export interface ReviewContentMatch {
    side: ReviewSearchSide;
    /** One-based source line and UTF-16 columns; endColumn is exclusive. */
    line: number;
    startColumn: number;
    endColumn: number;
    /** Complete source line, without its line terminator. */
    text: string;
}

export type ReviewContentQuery =
    | { error: string; search: null }
    | {
        error: null;
        search: (contents: ReviewSearchContents, side?: ReviewSearchSideFilter) => ReviewContentMatch[];
    };

// Explorer's native matcher uses Unicode word boundaries. JavaScript's \b
// treats only ASCII letters/digits/underscore as word characters.
const WORD = '[\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\u200c\\u200d]';

/** Compile once per query, then reuse for every loaded file in a review. */
export function compileReviewContentQuery(query: string, modes: ContentSearchModes): ReviewContentQuery {
    let pattern: RegExp;
    try {
        let source = modes.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (modes.wholeWord) source = `(?<!${WORD})(?:${source})(?!${WORD})`;
        pattern = new RegExp(source, modes.caseSensitive ? 'gu' : 'giu');
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Invalid regular expression', search: null };
    }

    return {
        error: null,
        search(contents, filter = 'both') {
            const matches: ReviewContentMatch[] = [];
            if (query.length === 0) return matches;
            for (const side of ['old', 'new'] as const) {
                if (filter !== 'both' && filter !== side) continue;
                const content = contents[side];
                if (content === null) continue;
                const lines = content.split(/\r?\n/);
                // A final newline terminates the last source line; it does not
                // create an extra source line for an anchored regex to match.
                if (content.endsWith('\n')) lines.pop();
                for (let index = 0; index < lines.length; index++) {
                    const text = lines[index];
                    // matchAll advances zero-width matches by a Unicode code
                    // point and leaves the reusable pattern's lastIndex alone.
                    for (const match of text.matchAll(pattern)) {
                        matches.push({
                            side,
                            line: index + 1,
                            startColumn: match.index + 1,
                            endColumn: match.index + match[0].length + 1,
                            text,
                        });
                    }
                }
            }
            return matches;
        },
    };
}
