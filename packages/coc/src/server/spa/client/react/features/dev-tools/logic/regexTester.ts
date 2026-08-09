/**
 * Regex tester logic — compile a pattern, run it over a subject, and return
 * both the match list and the segments the card needs to highlight.
 *
 * React-free; a bad pattern comes back as an error rather than throwing.
 */

export type RegexResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface RegexCapture {
    /** 1-based group number. */
    index: number;
    /** `undefined` when the group did not participate in the match. */
    text?: string;
}

export interface RegexMatch {
    /** Offset of the match in the subject. */
    start: number;
    end: number;
    text: string;
    captures: RegexCapture[];
    /**
     * Named groups, straight from `match.groups`. Kept separate from
     * `captures` because a `RegExpExecArray` gives no index→name mapping and
     * guessing one by comparing values gets it wrong whenever two groups
     * capture the same text.
     */
    named: Record<string, string | undefined>;
}

export interface RegexSegment {
    text: string;
    match: boolean;
}

export interface RegexRun {
    matches: RegexMatch[];
    /** The subject split into alternating plain / matched runs, for highlighting. */
    segments: RegexSegment[];
}

export const REGEX_FLAGS: readonly { flag: string; label: string }[] = [
    { flag: 'g', label: 'global' },
    { flag: 'i', label: 'ignore case' },
    { flag: 'm', label: 'multiline' },
    { flag: 's', label: 'dotall' },
    { flag: 'u', label: 'unicode' },
    { flag: 'y', label: 'sticky' },
];

/** Guard against a runaway pattern eating the browser. */
const MAX_MATCHES = 1000;

/** Compile `pattern` with `flags`, surfacing both syntax errors as text. */
export function compileRegex(pattern: string, flags: string): RegexResult<RegExp> {
    if (!pattern) return { ok: false, error: 'Enter a pattern' };
    try {
        return { ok: true, value: new RegExp(pattern, flags) };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Invalid pattern' };
    }
}

function capturesOf(match: RegExpExecArray): RegexCapture[] {
    return match.slice(1).map((text, i) => ({ index: i + 1, text }));
}

/**
 * Run the pattern over `subject`.
 *
 * The pattern is always executed with `g` so every match is found regardless of
 * what the user typed; a zero-length match advances `lastIndex` by hand, which
 * is what keeps `//` or `a*` from looping forever.
 */
export function runRegex(pattern: string, flags: string, subject: string): RegexResult<RegexRun> {
    const compiled = compileRegex(pattern, flags.includes('g') ? flags : `${flags}g`);
    if (!compiled.ok) return compiled;

    const regex = compiled.value;
    const matches: RegexMatch[] = [];
    let found: RegExpExecArray | null;
    while ((found = regex.exec(subject)) !== null) {
        matches.push({
            start: found.index,
            end: found.index + found[0].length,
            text: found[0],
            captures: capturesOf(found),
            named: { ...(found.groups ?? {}) },
        });
        if (found[0].length === 0) regex.lastIndex += 1;
        if (matches.length >= MAX_MATCHES) break;
    }

    const segments: RegexSegment[] = [];
    let cursor = 0;
    for (const match of matches) {
        // A zero-length match has nothing to highlight, so it only matters for
        // the count.
        if (match.end === match.start) continue;
        if (match.start > cursor) segments.push({ text: subject.slice(cursor, match.start), match: false });
        segments.push({ text: match.text, match: true });
        cursor = match.end;
    }
    if (cursor < subject.length) segments.push({ text: subject.slice(cursor), match: false });

    return { ok: true, value: { matches, segments } };
}
