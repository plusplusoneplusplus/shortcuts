/**
 * My Work timeline — pure parser for `notes/Work/timeline.md`.
 *
 * The file is the Work Radar's "what changed" log: reverse-chronological,
 * critical updates only, one bullet per update, each linking back to its
 * thread note.
 *
 * ```markdown
 * ## 2026-08-09
 * - 06:00 **[contoso-migration]** cutover slipped to the 14th → [thread](threads/contoso-migration.md)
 * ```
 *
 * Every part of a bullet except the text is optional, and **nothing here ever
 * throws**. The file is written by an AI sweep and hand-edited by the user, so
 * the parser's job is to salvage the lines it understands and silently drop the
 * ones it does not: a malformed bullet must not be able to blank the tab it is
 * rendered above.
 *
 * Display order is *file order*. The format's contract is that the newest entry
 * sits at the top, so the first N bullets are the N newest; re-sorting here
 * would only second-guess a writer that already knows the order it wants (and
 * would sink an undated `## Today` block below older dated entries).
 *
 * Pure: no `fs`, no forge, no network — same rule as `my-work-tasks.ts`, so it
 * stays cheap to test.
 */

// ============================================================================
// Types
// ============================================================================

export interface TimelineEntry {
    /** Stable within-snapshot key (derived from the source line number). */
    id: string;
    /** ISO `YYYY-MM-DD` from the enclosing `## <date>` heading, when there is one. */
    date?: string;
    /** `HH:MM` prefix on the bullet, when there is one. */
    time?: string;
    /** Thread label from a leading `**[slug]**`. */
    thread?: string;
    /** The one line of prose, with the time/thread/link syntax removed. */
    text: string;
    /**
     * Where the bullet points, already classified and safety-checked. Resolved
     * here rather than in the client because the client never imports server
     * modules, and duplicating the path check is how one copy of it goes stale.
     */
    link?: TimelineLink;
}

export interface ParsedTimeline {
    /** At most `limit` entries, in file order (newest first by format contract). */
    entries: TimelineEntry[];
    /** How many valid entries the file holds in total — drives "View all". */
    total: number;
}

/** Where a bullet's link points, once it has been checked for safety. */
export type TimelineLink =
    /** An off-machine URL — render as a normal anchor. */
    | { kind: 'external'; url: string }
    /** A note inside the My Work notes tree, as a notes-root-relative path. */
    | { kind: 'note'; path: string };

// ============================================================================
// Constants
// ============================================================================

/** The one file this module reads, relative to the My Work notes root. */
export const TIMELINE_NOTE_PATH = 'Work/timeline.md';

/** Directory the timeline's relative links resolve against. */
const TIMELINE_DIR = 'Work';

/** How many entries the strip shows. Five lines is the whole design budget. */
export const TIMELINE_LIMIT = 5;

// ============================================================================
// Line parsing
// ============================================================================

const HEADING_RE = /^#{1,6}\s+(.*)$/;
const BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?:\s|$)/;
/** `**[slug]**`, or a bold label with no brackets. */
const THREAD_RE = /^\*\*\[?\s*([^\]*]+?)\s*\]?\*\*/;
/** A trailing markdown link, with or without the `→` that usually precedes it. */
const TRAILING_LINK_RE = /(?:→|->)?\s*\[[^\]]*\]\(\s*([^)\s]+)\s*\)\s*$/;

/** A real calendar date, not just four digits and two dashes. */
function asISODate(raw: string): string | undefined {
    const m = ISO_DATE_RE.exec(raw.trim());
    if (!m) return undefined;
    const [, y, mo, d] = m;
    const month = Number(mo);
    const day = Number(d);
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    // Reject the 31sts of short months and Feb 30 — `Date` normalizes them.
    const probe = new Date(Date.UTC(Number(y), month - 1, day));
    if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return undefined;
    return `${y}-${mo}-${d}`;
}

/** Normalize `6:00` to `06:00`; reject anything that is not a clock time. */
function asTime(hh: string, mm: string): string | undefined {
    const h = Number(hh);
    const m = Number(mm);
    if (h > 23 || m > 59) return undefined;
    return `${String(h).padStart(2, '0')}:${mm}`;
}

/**
 * Parse one bullet body into an entry, or null when there is nothing worth
 * showing. Each segment is stripped only when it actually matches, so a bullet
 * that is nothing but a sentence still parses.
 */
function parseBullet(body: string, id: string, date: string | undefined): TimelineEntry | null {
    let rest = body.trim();
    if (!rest) return null;

    let time: string | undefined;
    const timeMatch = TIME_RE.exec(rest);
    if (timeMatch) {
        time = asTime(timeMatch[1], timeMatch[2]);
        // A malformed clock (`99:99`) stays in the text rather than being eaten.
        if (time) rest = rest.slice(timeMatch[0].length).trim();
    }

    let thread: string | undefined;
    const threadMatch = THREAD_RE.exec(rest);
    if (threadMatch) {
        thread = threadMatch[1].trim() || undefined;
        if (thread) rest = rest.slice(threadMatch[0].length).trim();
    }

    let href: string | undefined;
    const linkMatch = TRAILING_LINK_RE.exec(rest);
    if (linkMatch) {
        href = linkMatch[1];
        rest = rest.slice(0, linkMatch.index).trim();
    }

    // Drop a dangling arrow left behind by a link we removed (or one the writer
    // typed with no link after it).
    rest = rest.replace(/\s*(?:→|->)\s*$/, '').replace(/\s*[—–-]\s*$/, '').trim();

    // A bullet with no prose carries no information, however well-formed the
    // rest of it is.
    if (!rest) return null;
    const link = resolveTimelineLink(href);
    return {
        id,
        ...(date ? { date } : {}),
        ...(time ? { time } : {}),
        ...(thread ? { thread } : {}),
        text: rest,
        ...(link ? { link } : {}),
    };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse `timeline.md` into at most `limit` entries plus the total count.
 *
 * Never throws. Empty or missing content (the caller passes `''` for a missing
 * file) yields zero entries, which is what the renderer treats as "draw
 * nothing at all".
 */
export function parseTimeline(content: string, limit: number = TIMELINE_LIMIT): ParsedTimeline {
    const entries: TimelineEntry[] = [];
    if (typeof content !== 'string' || !content.trim()) return { entries, total: 0 };

    let date: string | undefined;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].replace(/\r$/, '');

        const heading = HEADING_RE.exec(line);
        if (heading) {
            // A heading that is not a date (`## Today`, `# Timeline`) is still a
            // section boundary: its bullets are kept, just undated.
            date = asISODate(heading[1]);
            continue;
        }

        const bullet = BULLET_RE.exec(line);
        if (!bullet) continue; // prose, blank lines, front-matter, tables — skipped

        const entry = parseBullet(bullet[1], `tl-${i}`, date);
        if (entry) entries.push(entry);
    }

    const cap = Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : TIMELINE_LIMIT;
    return { entries: entries.slice(0, cap), total: entries.length };
}

/**
 * Classify a bullet's link target.
 *
 * Relative paths resolve against the timeline's own directory (`Work/`) and are
 * refused if they try to climb out of the notes tree or name an absolute path —
 * the strip only ever opens notes, and nothing here reads a file, but a link
 * that escapes the tree has no business being clickable either. Returns null
 * for anything unrecognized, and the caller then renders plain text.
 */
export function resolveTimelineLink(href: string | undefined): TimelineLink | null {
    if (!href) return null;
    const raw = href.trim();
    if (!raw) return null;

    if (/^https?:\/\//i.test(raw)) return { kind: 'external', url: raw };
    // Any other scheme (javascript:, file:, data:) is not something to link to.
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
    // Absolute paths, UNC and Windows drive letters all leave the notes tree.
    if (raw.startsWith('/') || raw.startsWith('\\')) return null;

    const parts = raw.replace(/\\/g, '/').split('/').filter(p => p && p !== '.');
    if (parts.length === 0 || parts.some(p => p === '..')) return null;
    return { kind: 'note', path: `${TIMELINE_DIR}/${parts.join('/')}` };
}
