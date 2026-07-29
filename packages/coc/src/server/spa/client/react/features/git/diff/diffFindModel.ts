/**
 * diffFindModel — pure search model for the in-diff Ctrl+F find widget.
 *
 * The diff viewers virtualize any file over VIRTUALIZE_THRESHOLD lines, so the
 * native browser/Electron find-in-page cannot see off-screen matches. This
 * module searches the *full* diff model (every code-content line of every file
 * in the current review), independent of what is currently mounted in the DOM,
 * and returns match ranges the viewer can highlight and scroll into view.
 *
 * Everything here is pure and DOM-free so it can be unit-tested exhaustively and
 * reused by both UnifiedDiffViewer and SideBySideDiffViewer.
 */

import type { DiffLine } from './UnifiedDiffViewer';

/** A single occurrence of the search query inside one diff-content line. */
export interface DiffMatch {
    /** Index into the diff-line model (`DiffLine.index`) of the containing line. */
    lineIndex: number;
    /**
     * Start offset of the match within the line's *content* — i.e. within
     * `line.content.slice(1)` (the diff prefix char `+`/`-`/` ` removed), which
     * is exactly the text the syntax highlighter renders. Offsets therefore line
     * up 1:1 with the decoded characters of the highlighted HTML.
     */
    start: number;
    /** End offset (exclusive) of the match within the line's content. */
    end: number;
}

/**
 * True when a diff line carries searchable code content. Search targets code
 * content only — never line numbers, file paths, hunk headers, or git meta
 * lines (matching the feature's out-of-scope list). Mirrors the `isContent`
 * predicate used by `computeHighlightedHtml`, so match offsets align with the
 * highlighted output.
 */
export function isSearchableLine(line: DiffLine): boolean {
    return (line.type === 'added' || line.type === 'removed' || line.type === 'context')
        && line.content.length > 0;
}

/** The searchable text of a content line (diff prefix char stripped). */
export function lineSearchText(line: DiffLine): string {
    return line.content.slice(1);
}

/**
 * Find every occurrence of `query` across the full diff model, in document
 * order (top-to-bottom, left-to-right within a line). Default matching is
 * case-insensitive plain substring; pass `caseSensitive` to make it exact.
 *
 * Matches are non-overlapping: after a hit the scan resumes past its end, so
 * searching "aa" in "aaaa" yields two matches, not three.
 */
export function computeDiffMatches(
    diffLines: DiffLine[],
    query: string,
    caseSensitive: boolean,
): DiffMatch[] {
    const matches: DiffMatch[] = [];
    if (!query) return matches;
    const needle = caseSensitive ? query : query.toLowerCase();
    if (needle.length === 0) return matches;

    for (const line of diffLines) {
        if (!isSearchableLine(line)) continue;
        const text = lineSearchText(line);
        const haystack = caseSensitive ? text : text.toLowerCase();
        let from = 0;
        for (;;) {
            const idx = haystack.indexOf(needle, from);
            if (idx === -1) break;
            matches.push({ lineIndex: line.index, start: idx, end: idx + needle.length });
            from = idx + needle.length;
        }
    }
    return matches;
}

/**
 * Next match index with wrap-around. Returns 0 when nothing is active yet
 * (`current < 0`), and -1 when there are no matches.
 */
export function nextMatchIndex(current: number, total: number): number {
    if (total <= 0) return -1;
    if (current < 0) return 0;
    return (current + 1) % total;
}

/**
 * Previous match index with wrap-around. Returns the last match when nothing is
 * active yet (`current < 0`) or when already at the first, and -1 when there are
 * no matches.
 */
export function prevMatchIndex(current: number, total: number): number {
    if (total <= 0) return -1;
    if (current <= 0) return total - 1;
    return current - 1;
}

/** A per-line highlight range, carrying whether it is the active match. */
export interface LineMatchRange {
    start: number;
    end: number;
    active: boolean;
}

/**
 * Shared Tailwind class strings for the find-match overlay, reused by both
 * viewers (and injected into hljs HTML by `applyMatchHighlights`) so match
 * highlighting reads correctly in light and dark themes. The active match is
 * emphasized with a distinct, stronger background.
 */
export const MATCH_HIGHLIGHT_CLASS = 'bg-[#ffe066] text-black dark:bg-[#8a6d00] dark:text-white rounded-[2px]';
export const ACTIVE_MATCH_HIGHLIGHT_CLASS = 'bg-[#ff9e2c] text-black dark:bg-[#c2410c] dark:text-white rounded-[2px]';

/**
 * Group matches by their containing line so a row renderer can look up the
 * ranges for a given line in O(1). The match at `activeIndex` (into the flat
 * `matches` array) is flagged `active` so the viewer can emphasize it.
 */
export function groupMatchesByLine(
    matches: DiffMatch[],
    activeIndex: number,
): Map<number, LineMatchRange[]> {
    const map = new Map<number, LineMatchRange[]>();
    matches.forEach((m, i) => {
        const range: LineMatchRange = { start: m.start, end: m.end, active: i === activeIndex };
        const existing = map.get(m.lineIndex);
        if (existing) existing.push(range);
        else map.set(m.lineIndex, [range]);
    });
    return map;
}

/**
 * Overlay match-highlight `<mark>` tags onto an already-highlighted HTML string
 * (the output of `highlightBlock`/`escapeHtml`) without breaking its syntax
 * spans or word-level intra-line diff markup.
 *
 * The HTML is a mix of tag tokens (`<span …>`, `</span>`, `<mark …>`) and text
 * runs that may contain HTML entities (`&lt;`, `&amp;`, …). Each entity and each
 * plain character counts as exactly one source character, which is how the
 * highlighter escapes content — so decoded text offsets align 1:1 with the
 * `start`/`end` offsets produced by `computeDiffMatches`.
 *
 * To keep tag nesting valid, a `<mark>` never spans a tag boundary: it is closed
 * before any tag and reopened after it while still inside the range. Ranges are
 * assumed non-overlapping (as produced by `computeDiffMatches`).
 */
export function applyMatchHighlights(
    html: string,
    ranges: LineMatchRange[],
    matchClass: string,
    activeMatchClass: string,
): string {
    if (ranges.length === 0) return html;
    const sorted = [...ranges].sort((a, b) => a.start - b.start);

    let out = '';
    let offset = 0; // decoded text-character offset into the source content
    let ri = 0; // index into `sorted` of the range we are currently near
    let marking = false; // whether a <mark> is currently open

    const openMark = (active: boolean) => `<mark class="${active ? activeMatchClass : matchClass}">`;
    const closeMark = () => { if (marking) { out += '</mark>'; marking = false; } };

    let i = 0;
    while (i < html.length) {
        const ch = html[i];

        if (ch === '<') {
            // A tag boundary: close any open mark, copy the tag verbatim, then
            // reopen the mark after it if the current offset is still in-range.
            closeMark();
            const gt = html.indexOf('>', i);
            const end = gt === -1 ? html.length - 1 : gt;
            out += html.slice(i, end + 1);
            i = end + 1;
            if (ri < sorted.length && offset >= sorted[ri].start && offset < sorted[ri].end) {
                out += openMark(sorted[ri].active);
                marking = true;
            }
            continue;
        }

        // Retire any ranges that end at or before the current offset.
        while (ri < sorted.length && offset >= sorted[ri].end) {
            closeMark();
            ri++;
        }
        // Open a mark exactly when the current offset reaches a range start.
        if (!marking && ri < sorted.length && offset === sorted[ri].start && offset < sorted[ri].end) {
            out += openMark(sorted[ri].active);
            marking = true;
        }

        // Consume one source character — a whole HTML entity or a single char.
        if (ch === '&') {
            const semi = html.indexOf(';', i);
            if (semi !== -1 && semi - i <= 10) {
                out += html.slice(i, semi + 1);
                i = semi + 1;
            } else {
                out += ch;
                i++;
            }
        } else {
            out += ch;
            i++;
        }
        offset++;

        // Close the mark as soon as we pass this range's end.
        if (marking && ri < sorted.length && offset >= sorted[ri].end) {
            closeMark();
            ri++;
        }
    }

    closeMark();
    return out;
}

/** One rendered segment of a word-diff line, carrying both its intra-line
 * change state and its find-match state so the renderer can style them as a
 * single span. */
export interface IntraMatchSegment {
    text: string;
    /** True when the segment is part of a word-level intra-line change. */
    changed: boolean;
    /** Find-match state: not a match, a match, or the active match. */
    match: 'none' | 'match' | 'active';
}

/**
 * Overlay find-match ranges onto the word-level intra-line diff parts of a line
 * (the React-node render path, not the hljs-HTML path). The concatenated part
 * texts equal the line content (each character = one offset), so the `start`/
 * `end` offsets from `computeDiffMatches` index directly into it. Splits parts
 * at range boundaries and coalesces runs sharing the same (changed, match)
 * state so the renderer emits a minimal number of spans.
 */
export function splitIntraPartsByRanges(
    parts: { text: string; changed: boolean }[],
    ranges: LineMatchRange[],
): IntraMatchSegment[] {
    if (ranges.length === 0) {
        return parts.map(p => ({ text: p.text, changed: p.changed, match: 'none' as const }));
    }
    const matchAt = (off: number): 'none' | 'match' | 'active' => {
        for (const r of ranges) {
            if (off >= r.start && off < r.end) return r.active ? 'active' : 'match';
        }
        return 'none';
    };
    const segs: IntraMatchSegment[] = [];
    let offset = 0;
    for (const part of parts) {
        const len = part.text.length;
        if (len === 0) { continue; }
        let runStart = 0;
        let runState = matchAt(offset);
        for (let k = 1; k < len; k++) {
            const st = matchAt(offset + k);
            if (st !== runState) {
                segs.push({ text: part.text.slice(runStart, k), changed: part.changed, match: runState });
                runStart = k;
                runState = st;
            }
        }
        segs.push({ text: part.text.slice(runStart), changed: part.changed, match: runState });
        offset += len;
    }
    return segs;
}
