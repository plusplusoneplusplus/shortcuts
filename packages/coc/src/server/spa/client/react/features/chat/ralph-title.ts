/**
 * ralph-title — pure helpers that derive a concise, human-readable display
 * title from a Ralph goal/spec string.
 *
 * No React, no side effects. Shared by `ralph-session-grouping`,
 * `RalphSessionRow`, and `sessionContextDrag` so row rendering, grouping, and
 * drag/drop reuse one parsing implementation instead of duplicating goal-spec
 * parsing logic. No new persistent title state is introduced — titles are
 * derived on the fly from existing goal text.
 */

/** Shown when a goal is missing or yields no usable title. */
export const RALPH_FALLBACK_TITLE = 'Ralph Session';

/** Default maximum rendered length before truncation with an ellipsis. */
const DEFAULT_MAX_LENGTH = 80;

/**
 * Structural section labels emitted by the grill/synthesis goal-spec template.
 * These are headings, not content, so they must never become the title.
 */
const SECTION_LABELS = new Set<string>([
    'goal',
    'goals',
    'acceptance criteria',
    'constraints',
    'tech context',
    'constraints / tech context',
    'out of scope',
    'references to load',
    'references',
    'dependency graph',
    'ready-for-ralph checklist',
    'notes',
    'note',
    'summary',
    'context',
    'objective',
    'objectives',
    'overview',
    'background',
    'problem',
    'approach',
    'definition of done',
    'description',
]);

/** Strip a leading YAML frontmatter block (`---\n...\n---`). */
function stripFrontmatter(text: string): string {
    const match = /^\uFEFF?\s*---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(text);
    return match ? text.slice(match[0].length) : text;
}

/**
 * Strip leading Markdown/structural markers and decision tags from a single
 * line, returning the inner text. Handles headings, blockquotes, list bullets,
 * `[decision]`/`[assumption]`/`[open]` tags, and bold/emphasis/code wrappers.
 */
function stripLeadingMarkers(line: string): string {
    let s = line.trim();
    s = s.replace(/^#{1,6}\s+/, '');
    s = s.replace(/^>\s+/, '');
    s = s.replace(/^([-*+]|\d+[.)])\s+/, '');

    let previous: string;
    do {
        previous = s;
        s = s.replace(/^\[(?:decision|assumption|open)\]\s*/i, '').trim();
    } while (s !== previous);

    s = s
        .replace(/^\*\*([\s\S]*)\*\*$/, '$1')
        .replace(/^\*([\s\S]*)\*$/, '$1')
        .replace(/^`([\s\S]*)`$/, '$1');
    return s.trim();
}

/** True when the (marker-stripped) text is a structural section heading. */
function isSectionLabel(text: string): boolean {
    const normalized = text.replace(/:$/, '').trim().toLowerCase();
    return SECTION_LABELS.has(normalized);
}

/**
 * Extract the first sentence from a line. Falls back to the full line when no
 * clear sentence terminator is found or the candidate is implausibly short
 * (guards against abbreviations like "e.g.").
 */
function firstSentence(text: string): string {
    const match = /^([\s\S]*?[.!?])(\s|$)/.exec(text);
    if (match && match[1].trim().length >= 12) return match[1].trim();
    return text;
}

function truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 1).trimEnd() + '…';
}

/**
 * Derive a concise display title from a Ralph goal/spec string.
 *
 * Returns the first meaningful heading or sentence with frontmatter, section
 * labels, decision tags, and excess whitespace removed. Returns
 * {@link RALPH_FALLBACK_TITLE} when the goal is empty, missing, or yields no
 * usable text.
 */
export function deriveRalphTitle(
    goal: string | null | undefined,
    maxLength: number = DEFAULT_MAX_LENGTH,
): string {
    if (typeof goal !== 'string') return RALPH_FALLBACK_TITLE;

    const body = stripFrontmatter(goal);
    for (const rawLine of body.split(/\r?\n/)) {
        if (!rawLine.trim()) continue;
        const stripped = stripLeadingMarkers(rawLine);
        if (!stripped || isSectionLabel(stripped)) continue;
        const sentence = firstSentence(stripped).replace(/\s+/g, ' ').trim();
        if (!sentence) continue;
        return truncate(sentence, maxLength);
    }
    return RALPH_FALLBACK_TITLE;
}
