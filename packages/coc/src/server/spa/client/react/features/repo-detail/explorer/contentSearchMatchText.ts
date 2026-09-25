/** The three pieces a content-search row renders around the exact server match. */
export interface MatchTextParts {
    before: string;
    hit: string;
    after: string;
}

export interface MatchTextSpan {
    text: string;
    /** UTF-16 offset into `text`, matching JavaScript string indices. */
    startColumn: number;
    /** UTF-16 offset one past the match. */
    endColumn: number;
}

/** Split a line into before / hit / after while safely clamping malformed offsets. */
export function splitMatchText(match: MatchTextSpan): MatchTextParts {
    const start = Math.max(0, Math.min(match.startColumn, match.text.length));
    const end = Math.max(start, Math.min(match.endColumn, match.text.length));
    return {
        before: match.text.slice(0, start),
        hit: match.text.slice(start, end),
        after: match.text.slice(end),
    };
}
