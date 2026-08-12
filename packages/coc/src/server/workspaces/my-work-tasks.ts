/**
 * My Work task model — pure parser/serializer for the markdown-backed
 * "Today view".
 *
 * The markdown files stay the single source of truth (no task database).
 * This module parses checkbox lines from `Action Items.md` (flat list plus an
 * optional `## Archive` section) and `Follow Ups.md` (person = `##`/`###`
 * heading), and serializes toggle/edit/add/archive operations as minimal line
 * rewrites that preserve every other line byte-for-byte.
 *
 * `## Synced <date>` headings written by the sync route are read as batch
 * boundaries and stamped onto each item below them as `addedAt` — the item's
 * age, and in `Follow Ups.md` the reason such a heading is never a person.
 *
 * Items may also carry inline metadata — `@due(YYYY-MM-DD)`, `#tag`, and a
 * `[↗](url)` source link. That syntax lives on the line, so the markdown stays
 * the single source of truth; extraction runs on the read path only and the
 * raw line is what sits on disk.
 *
 * Pure: imports only Node built-ins (`crypto`) — no `fs`, no forge, no network.
 * This keeps it out of the forge/sse mock graph.
 */

import { createHash } from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface Task {
    /** Stable within-snapshot addressing token (see IDs note below). */
    id: string;
    /**
     * Display text: the checkbox line with its inline metadata removed. The
     * raw line stays on disk untouched; `rewriteLine` re-attaches the metadata
     * when a patch replaces this text, so a round-trip loses nothing.
     */
    text: string;
    checked: boolean;
    /** Follow-ups only: the person heading the item is grouped under. */
    person?: string;
    /**
     * ISO date (`YYYY-MM-DD`) of the `## Synced <date>` heading the item sits
     * under — the item's age. Absent for items written above any sync heading
     * (hand-added items, the default file contents).
     */
    addedAt?: string;
    /** ISO date from an inline `@due(YYYY-MM-DD)`. */
    due?: string;
    /** Inline `#tag` labels, without the leading `#`. Absent when none. */
    tags?: string[];
    /** URL from an inline `[↗](url)` link back to the item's source. */
    sourceUrl?: string;
}

export interface ParsedTasks {
    actionItems: Task[];
    followUps: Task[];
}

export interface TaskPatch {
    checked?: boolean;
    text?: string;
    /**
     * Set (`YYYY-MM-DD`) or clear (`null`) the line's `@due(...)`, leaving the
     * rest of the line alone. This is how snooze/defer works: pushing the due
     * date out drops the item from the urgent bucket until the date arrives,
     * so the user never has to tick a box they did not actually do.
     */
    due?: string | null;
}

// ============================================================================
// Line primitives
//
// We always split on '\n' and join on '\n'. A CRLF file keeps its trailing
// '\r' attached to each split element, so byte-for-byte content is preserved
// as long as we never change the join separator. New lines we insert carry
// their own '\r' suffix when the file uses CRLF.
// ============================================================================

// indent, checkbox state char, text (`.` excludes line terminators so `\r`
// stays in the trailing group), optional trailing CR.
const CHECKBOX_RE = /^(\s*)- \[([ xX])\] (.*?)(\r?)$/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\r?$/;

function isCRLF(content: string): boolean {
    return content.includes('\r\n');
}

/** Trailing-CR suffix appropriate for freshly inserted lines. */
function newlineSuffix(content: string): string {
    return isCRLF(content) ? '\r' : '';
}

function normalizeText(text: string): string {
    return text.trim().replace(/\s+/g, ' ');
}

// ============================================================================
// Inline metadata
//
// A task line may carry metadata inline, which keeps the markdown file the
// single source of truth — no sidecar database, and a user can hand-write the
// same syntax in the note:
//
//   - [ ] Send revised cutover plan @due(2026-08-14) #contoso [↗](https://…)
//
// Extraction runs on the read path only. The line on disk is never rewritten
// to add or normalize metadata; `Task.text` is just the line minus the tokens,
// so the raw syntax stays out of the UI.
// ============================================================================

/** `@due(YYYY-MM-DD)`. Must start the line or follow whitespace. */
const DUE_RE = /(?:^|\s)@due\(\s*(\d{4}-\d{2}-\d{2})\s*\)(?=\s|$)/g;
/**
 * `#tag` — must start the line or follow whitespace, so the fragment in
 * `https://example.com/x#frag` is not mistaken for a tag. Links are stripped
 * first anyway; this is the second line of defence.
 */
const TAG_RE = /(?:^|\s)#([A-Za-z0-9][A-Za-z0-9._/-]*)(?=\s|$)/g;
/**
 * `[↗](url)` — the source link. The label is pinned to `↗` so an ordinary
 * markdown link a user writes inside an item stays part of the text.
 */
const SOURCE_LINK_RE = /(?:^|\s)\[↗\]\(([^)\s]+)\)(?=\s|$)/g;

export interface LineMetadata {
    due?: string;
    tags?: string[];
    sourceUrl?: string;
}

export interface SplitLine extends LineMetadata {
    /** The line with every metadata token removed. */
    text: string;
    /** The metadata re-rendered in canonical order — '' when there is none. */
    suffix: string;
}

/**
 * Split a checkbox line's text into display text plus its inline metadata.
 *
 * Tokens are recognized anywhere on the line, but `suffix` always renders them
 * in canonical order (due, tags, link). That only matters on the edit path,
 * where the suffix is re-attached after replacement text — reading never
 * rewrites anything.
 */
export function splitMetadata(raw: string): SplitLine {
    let due: string | undefined;
    const tags: string[] = [];
    let sourceUrl: string | undefined;

    let text = raw
        .replace(SOURCE_LINK_RE, (_m, url: string) => {
            sourceUrl ??= url;
            return ' ';
        })
        .replace(DUE_RE, (_m, iso: string) => {
            due ??= iso;
            return ' ';
        })
        .replace(TAG_RE, (_m, tag: string) => {
            if (!tags.includes(tag)) tags.push(tag);
            return ' ';
        });

    // Only collapse whitespace when something was actually removed, so a line
    // with no metadata keeps its exact spacing.
    const found = due !== undefined || tags.length > 0 || sourceUrl !== undefined;
    if (found) text = text.replace(/\s+/g, ' ').trim();

    return {
        text,
        due,
        tags: tags.length > 0 ? tags : undefined,
        sourceUrl,
        suffix: found ? formatMetadata({ due, tags, sourceUrl }) : '',
    };
}

/** Render metadata as the canonical trailing token string (leading space, or ''). */
export function formatMetadata(meta: LineMetadata): string {
    const parts: string[] = [];
    if (meta.due) parts.push(`@due(${meta.due})`);
    for (const tag of meta.tags ?? []) {
        const clean = tag.replace(/^#+/, '').trim();
        if (clean) parts.push(`#${clean}`);
    }
    if (meta.sourceUrl) parts.push(`[↗](${encodeSourceUrl(meta.sourceUrl)})`);
    return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

/**
 * Make a URL safe to sit inside `(...)` on a markdown line: percent-encode the
 * characters that would terminate the link or the line itself. Everything else
 * is left as typed so the URL stays readable in the note.
 */
function encodeSourceUrl(url: string): string {
    return url
        .trim()
        .replace(/\s+/g, '%20')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29');
}

/**
 * Build a full checkbox line for a synced item. The sync route is the only
 * writer of metadata; every other path preserves whatever is already on disk.
 */
export function formatTaskLine(text: string, meta: LineMetadata = {}): string {
    // A newline inside an item would split it into two lines (and a stray one
    // could forge a heading), so collapse vertical whitespace out of the text.
    const body = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    return `- [ ] ${body}${formatMetadata(meta)}`;
}

// ============================================================================
// IDs
//
// The id hashes the RAW line text — metadata included — not the stripped
// display text. Two deliberate consequences:
//
//   1. Lines that differ only in metadata get different ids. Two synced items
//      with identical wording but different source links are different items;
//      hashing the stripped text would collide them and leave `dupIndex` (a
//      file-order counter) as the only thing telling them apart.
//   2. Changing an item's due date changes its id — exactly as editing its
//      text already does. That is safe because an id is a within-snapshot
//      addressing token, not a durable key: the client refetches after every
//      mutation, and read and write both hash the same content, so a PATCH
//      always resolves against the ids the caller was just handed.
//
// It also means files with no metadata keep byte-identical ids to before.
// ============================================================================

function hashId(listKey: string, text: string, dupIndex: number): string {
    return createHash('sha1')
        .update(`${listKey} ${normalizeText(text)} ${dupIndex}`)
        .digest('hex')
        .slice(0, 12);
}

interface ScannedItem {
    lineIndex: number;
    id: string;
    checked: boolean;
    /** Display text — inline metadata stripped. */
    text: string;
    person?: string;
    addedAt?: string;
    due?: string;
    tags?: string[];
    sourceUrl?: string;
}

// ============================================================================
// Sync headings
//
// `POST /api/my-work/sync` writes `## Synced <date>` above each appended batch,
// formatted as `Mon D` (e.g. `Synced Aug 12`) — no year. That heading is the
// only temporal signal on disk, so the scanners carry it down onto every item
// below it as `addedAt`.
// ============================================================================

const SYNC_HEADING_RE = /^synced\s+(.+)$/i;
// `Mon D` / `Month D` with an optional `, YYYY`, or a plain ISO `YYYY-MM-DD`.
const MONTH_DAY_RE = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:\s*,\s*(\d{4}))?$/i;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTHS = [
    'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

const DAY_MS = 86400000;

/** UTC midnight of a date's local calendar day — the comparison basis. */
function utcMidnight(date: Date): number {
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function toISODate(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Parse a heading label such as `Synced Aug 12` into an ISO date.
 *
 * Returns null when the label is not a sync heading or its date is
 * unparseable — in `scanFollowUps` that fallback is load-bearing: anything we
 * cannot read as a date stays a person heading.
 *
 * The written format carries no year, so a bare `Mon D` is resolved against
 * `now`: the current year, rolled back one year when that would land more than
 * a day in the future (a December sync read in January).
 */
function parseSyncHeading(label: string, now: Date): string | null {
    const m = label.trim().match(SYNC_HEADING_RE);
    if (!m) return null;
    const value = m[1].trim();

    const iso = value.match(ISO_DATE_RE);
    if (iso) {
        const ms = Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
        return Number.isNaN(ms) ? null : toISODate(ms);
    }

    const md = value.match(MONTH_DAY_RE);
    if (!md) return null;
    const month = MONTHS.indexOf(md[1].slice(0, 3).toLowerCase());
    const day = Number(md[2]);
    if (month === -1 || day < 1 || day > 31) return null;

    if (md[3]) return toISODate(Date.UTC(Number(md[3]), month, day));

    const today = utcMidnight(now);
    let ms = Date.UTC(now.getFullYear(), month, day);
    if (ms > today + DAY_MS) ms = Date.UTC(now.getFullYear() - 1, month, day);
    return toISODate(ms);
}

// ============================================================================
// Scanning
// ============================================================================

/**
 * Scan the active (non-archive) checkbox items of an Action Items file.
 * Items under a `## Archive` heading are excluded — that section is the
 * completed-item graveyard, not part of the Today view.
 */
function scanActionItems(lines: string[], now: Date = new Date()): ScannedItem[] {
    const items: ScannedItem[] = [];
    const dupCounts = new Map<string, number>();
    let inArchive = false;
    let addedAt: string | undefined;

    for (let i = 0; i < lines.length; i++) {
        const heading = lines[i].match(HEADING_RE);
        if (heading) {
            if (/^archive$/i.test(heading[2].trim())) inArchive = true;
            addedAt = parseSyncHeading(heading[2], now) ?? addedAt;
            continue;
        }
        if (inArchive) continue;

        const m = lines[i].match(CHECKBOX_RE);
        if (!m) continue;

        // `raw` is what the id hashes; `meta.text` is what the UI shows.
        const raw = m[3];
        const meta = splitMetadata(raw);
        const norm = `action ${normalizeText(raw)}`;
        const dupIndex = dupCounts.get(norm) ?? 0;
        dupCounts.set(norm, dupIndex + 1);

        items.push({
            lineIndex: i,
            id: hashId('action', raw, dupIndex),
            checked: m[2] !== ' ',
            text: meta.text,
            addedAt,
            due: meta.due,
            tags: meta.tags,
            sourceUrl: meta.sourceUrl,
        });
    }
    return items;
}

/**
 * Scan checkbox items of a Follow Ups file. Each item is grouped under the
 * most recent heading of level >= 2 (the `# Follow Ups` h1 title is ignored).
 */
function scanFollowUps(lines: string[], now: Date = new Date()): ScannedItem[] {
    const items: ScannedItem[] = [];
    const dupCounts = new Map<string, number>();
    let person: string | undefined;
    let addedAt: string | undefined;

    for (let i = 0; i < lines.length; i++) {
        const heading = lines[i].match(HEADING_RE);
        if (heading) {
            // Headings here are overloaded: sync writes `## Synced <date>` and
            // then `### <person>` under it. A readable sync date is a batch
            // boundary, never a person; anything else stays a person.
            const synced = parseSyncHeading(heading[2], now);
            if (synced) {
                addedAt = synced;
                person = undefined;
                continue;
            }
            // h1 is the file title; h2..h6 are person groupings.
            person = heading[1].length >= 2 ? heading[2].trim() : undefined;
            continue;
        }

        const m = lines[i].match(CHECKBOX_RE);
        if (!m) continue;

        const raw = m[3];
        const meta = splitMetadata(raw);
        const listKey = `followup:${person ?? ''}`;
        const norm = `${listKey} ${normalizeText(raw)}`;
        const dupIndex = dupCounts.get(norm) ?? 0;
        dupCounts.set(norm, dupIndex + 1);

        items.push({
            lineIndex: i,
            id: hashId(listKey, raw, dupIndex),
            checked: m[2] !== ' ',
            text: meta.text,
            person,
            addedAt,
            due: meta.due,
            tags: meta.tags,
            sourceUrl: meta.sourceUrl,
        });
    }
    return items;
}

// ============================================================================
// Parse
// ============================================================================

/** `now` resolves the year of the year-less `## Synced <date>` headings. */
export function parseActionItems(content: string, now: Date = new Date()): Task[] {
    return scanActionItems(content.split('\n'), now).map(
        ({ id, text, checked, addedAt, due, tags, sourceUrl }) => ({
            id,
            text,
            checked,
            addedAt,
            due,
            tags,
            sourceUrl,
        }),
    );
}

export function parseFollowUps(content: string, now: Date = new Date()): Task[] {
    return scanFollowUps(content.split('\n'), now).map(
        ({ id, text, checked, person, addedAt, due, tags, sourceUrl }) => ({
            id,
            text,
            checked,
            person,
            addedAt,
            due,
            tags,
            sourceUrl,
        }),
    );
}

/** Convenience: parse both files into the combined snapshot shape. */
export function parse(
    actionItemsContent: string,
    followUpsContent: string,
    now: Date = new Date(),
): ParsedTasks {
    return {
        actionItems: parseActionItems(actionItemsContent, now),
        followUps: parseFollowUps(followUpsContent, now),
    };
}

// ============================================================================
// Serialize — minimal line rewrites
// ============================================================================

/**
 * Rewrite a single checkbox line's state/text, preserving indent + trailing CR.
 *
 * A toggle leaves the text byte-for-byte alone, so inline metadata survives on
 * its own. A text patch carries only the display text (that is what the caller
 * was handed), so the line's metadata is re-attached after it — otherwise
 * renaming an item would silently drop its due date and source link.
 *
 * The merge is per field, not all-or-nothing: metadata written into the
 * replacement text wins for the fields it mentions, and everything it stays
 * silent about is carried over from the line. So retyping the text of an item
 * that has a tag and a source link keeps both, and adding a `@due(...)` while
 * editing changes only the due date.
 *
 * `patch.due` is the explicit form of that bump — set an ISO date or `null` to
 * clear — and it beats both, since it is the whole point of the call.
 */
function rewriteLine(line: string, patch: TaskPatch): string {
    const m = line.match(CHECKBOX_RE);
    if (!m) return line;
    const [, indent, state, text, cr] = m;
    const nextState = patch.checked === undefined ? state : patch.checked ? 'x' : ' ';
    let nextText = text;
    if (patch.text !== undefined || patch.due !== undefined) {
        const current = splitMetadata(text);
        const incoming = patch.text === undefined ? undefined : splitMetadata(patch.text);
        const meta: LineMetadata = {
            due: incoming?.due ?? current.due,
            tags: incoming?.tags ?? current.tags,
            sourceUrl: incoming?.sourceUrl ?? current.sourceUrl,
        };
        if (patch.due !== undefined) meta.due = patch.due ?? undefined;
        const suffix = formatMetadata(meta);
        // `current.text` keeps its original spacing when the line carried no
        // metadata, so trim before appending or a due-only bump would leave the
        // token dangling behind whatever trailing spaces the line had.
        const body = incoming?.text ?? (suffix ? current.text.replace(/\s+$/, '') : current.text);
        nextText = `${body}${suffix}`;
    }
    return `${indent}- [${nextState}] ${nextText}${cr}`;
}

function applyPatch(
    content: string,
    id: string,
    patch: TaskPatch,
    scan: (lines: string[]) => ScannedItem[],
): string | null {
    const lines = content.split('\n');
    const target = scan(lines).find((it) => it.id === id);
    if (!target) return null;
    lines[target.lineIndex] = rewriteLine(lines[target.lineIndex], patch);
    return lines.join('\n');
}

/** Patch an active action item by id. Returns null if the id is not present. */
export function patchActionItem(content: string, id: string, patch: TaskPatch): string | null {
    return applyPatch(content, id, patch, scanActionItems);
}

/** Patch a follow-up item by id. Returns null if the id is not present. */
export function patchFollowUp(content: string, id: string, patch: TaskPatch): string | null {
    return applyPatch(content, id, patch, scanFollowUps);
}

/** Index just past the last non-empty line at or before `end`. */
function trimEnd(lines: string[], end: number): number {
    let e = end;
    while (e > 0 && lines[e - 1] === '') e--;
    return e;
}

function findArchiveIndex(lines: string[]): number {
    for (let i = 0; i < lines.length; i++) {
        const h = lines[i].match(HEADING_RE);
        if (h && /^archive$/i.test(h[2].trim())) return i;
    }
    return -1;
}

/**
 * Append a new unchecked action item to the active region (before `## Archive`
 * if present, else at end of file). Returns the new content and the item id.
 */
export function addActionItem(content: string, text: string): { content: string; id: string } {
    const lines = content.split('\n');
    const archiveIdx = findArchiveIndex(lines);
    const insertAt = trimEnd(lines, archiveIdx === -1 ? lines.length : archiveIdx);
    const line = `- [ ] ${text}${newlineSuffix(content)}`;
    lines.splice(insertAt, 0, line);
    const nextContent = lines.join('\n');
    const added = scanActionItems(nextContent.split('\n')).find((it) => it.lineIndex === insertAt);
    return { content: nextContent, id: added?.id ?? hashId('action', text, 0) };
}

/**
 * Append a new unchecked follow-up under `person`, creating the person heading
 * at end of file if it does not yet exist. Returns new content and item id.
 */
export function addFollowUp(
    content: string,
    person: string,
    text: string,
): { content: string; id: string } {
    const lines = content.split('\n');
    const suffix = newlineSuffix(content);
    const line = `- [ ] ${text}${suffix}`;

    // Locate the person's heading and the end of its region.
    let headingIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        const h = lines[i].match(HEADING_RE);
        if (h && h[1].length >= 2 && h[2].trim() === person.trim()) {
            headingIdx = i;
            break;
        }
    }

    let insertAt: number;
    if (headingIdx === -1) {
        // New person: append heading + item at end of file.
        const end = trimEnd(lines, lines.length);
        lines.splice(end, 0, `## ${person}${suffix}`, line);
        insertAt = end + 1;
    } else {
        // Existing person: insert at the end of the region before the next heading.
        let regionEnd = lines.length;
        for (let i = headingIdx + 1; i < lines.length; i++) {
            if (HEADING_RE.test(lines[i])) {
                regionEnd = i;
                break;
            }
        }
        insertAt = trimEnd(lines, regionEnd);
        lines.splice(insertAt, 0, line);
    }

    const nextContent = lines.join('\n');
    const added = scanFollowUps(nextContent.split('\n')).find((it) => it.lineIndex === insertAt);
    return { content: nextContent, id: added?.id ?? hashId(`followup:${person.trim()}`, text, 0) };
}

/**
 * Move every checked active action item into a `## Archive` section (created at
 * end of file if absent). Only the moved lines and the archive header change;
 * every other line is preserved byte-for-byte. Returns new content and count.
 */
export function archiveCheckedActionItems(content: string): { content: string; archived: number } {
    const lines = content.split('\n');
    const suffix = newlineSuffix(content);
    const checked = scanActionItems(lines).filter((it) => it.checked);
    if (checked.length === 0) return { content, archived: 0 };

    const moveIdx = new Set(checked.map((it) => it.lineIndex));
    const movedLines = checked.map((it) => lines[it.lineIndex]);

    // Remove moved lines (descending so indices stay valid).
    const removalOrder = [...moveIdx].sort((a, b) => b - a);
    for (const idx of removalOrder) lines.splice(idx, 1);

    // Ensure an archive header, then append the moved lines under it.
    let archiveIdx = findArchiveIndex(lines);
    if (archiveIdx === -1) {
        const end = trimEnd(lines, lines.length);
        lines.splice(end, 0, `## Archive${suffix}`);
        archiveIdx = end;
    }
    // Insert moved lines at the end of the archive region.
    let regionEnd = lines.length;
    for (let i = archiveIdx + 1; i < lines.length; i++) {
        if (HEADING_RE.test(lines[i])) {
            regionEnd = i;
            break;
        }
    }
    const insertAt = trimEnd(lines, regionEnd);
    lines.splice(insertAt, 0, ...movedLines);

    return { content: lines.join('\n'), archived: checked.length };
}
