/**
 * Pure view-layer bucketing for the My Work Today tab.
 *
 * The markdown notes stay the source of truth and users edit them by hand, so
 * nothing here touches file order or the on-disk shape — a snapshot parsed by
 * the server is sorted into urgency buckets for display only. Keeping this
 * module free of React and of the client transport keeps it directly testable.
 */
import type { MyWorkTask } from '@plusplusoneplusplus/coc-client';

/** Items younger than this stay unlabelled — a badge on everything is noise. */
export const AGE_BADGE_MIN_DAYS = 2;

/**
 * How old an unchecked synced item must be to count as "needs you today".
 *
 * A week is the point where an item has survived a full working cycle without
 * being touched, which is the strongest staleness signal available until due
 * dates land.
 */
export const NEEDS_ATTENTION_AGE_DAYS = 7;

/**
 * Whole days between a task's `addedAt` sync date and today, or null when the
 * item carries no date (hand-added, or written above any `## Synced` heading).
 */
export function ageInDays(addedAt: string | undefined, now: Date): number | null {
    if (!addedAt) return null;
    const m = addedAt.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const added = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.floor((today - added) / 86400000);
    return days < 0 ? 0 : days;
}

/** `3d` under two weeks, `2w` beyond — null when too young to be worth a badge. */
export function formatAge(days: number | null): string | null {
    if (days === null || days < AGE_BADGE_MIN_DAYS) return null;
    return days < 14 ? `${days}d` : `${Math.floor(days / 7)}w`;
}

/**
 * Days until a task's `@due(...)` date — negative when overdue, 0 for today,
 * null when the task carries no due date or an unparseable one.
 */
export function daysUntilDue(due: string | undefined, now: Date): number | null {
    if (!due) return null;
    const m = due.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((target - today) / 86400000);
}

const MONTH_NAMES = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Urgency of a due date, for the chip's colour. */
export type DueTone = 'overdue' | 'today' | 'soon' | 'later';

export interface DueLabel {
    text: string;
    tone: DueTone;
}

/**
 * Label a due date for the chip: relative wording near today (where it drives
 * a decision) and a plain `Aug 14` further out (where the exact date is what
 * you want). Returns null when there is nothing to show.
 *
 * The ISO string is split by hand rather than fed to `new Date()`, which would
 * read `2026-08-14` as UTC midnight and render the day before west of GMT.
 */
export function formatDue(due: string | undefined, now: Date): DueLabel | null {
    const days = daysUntilDue(due, now);
    if (days === null) return null;
    if (days < 0) return { text: days === -1 ? 'Yesterday' : `${-days}d late`, tone: 'overdue' };
    if (days === 0) return { text: 'Today', tone: 'today' };
    if (days === 1) return { text: 'Tomorrow', tone: 'soon' };
    const [y, m, d] = due!.split('-').map(Number);
    return { text: `${MONTH_NAMES[m - 1]} ${d}`, tone: days <= 7 ? 'soon' : 'later' };
}

/**
 * Whether a task belongs in "Needs you today".
 *
 * A due date is an explicit statement about when the item matters, so it
 * settles the question on its own — overdue or due today is urgent, and a
 * future date keeps the item out of the bucket no matter how long it has been
 * sitting there. Age only decides for items with no due date.
 */
export function needsAttention(task: MyWorkTask, now: Date): boolean {
    // A checked item is done — it is never what you need to look at today.
    if (task.checked) return false;
    const dueIn = daysUntilDue(task.due, now);
    if (dueIn !== null) return dueIn <= 0;
    const age = ageInDays(task.addedAt, now);
    // Undated items were hand-added (quick-add, or typed straight into the
    // note) rather than synced, so they are the user's own picks. Surfacing
    // them beats burying a just-added item in the collapsed bucket.
    if (age === null) return true;
    return age >= NEEDS_ATTENTION_AGE_DAYS;
}

/** Action items split into the urgent bucket and the collapsed remainder. */
export interface ActionBuckets {
    needsYou: MyWorkTask[];
    everythingElse: MyWorkTask[];
}

/**
 * Split action items into "Needs you today" and "Everything else", preserving
 * file order within each bucket.
 */
export function bucketActionItems(actionItems: MyWorkTask[], now: Date): ActionBuckets {
    const needsYou: MyWorkTask[] = [];
    const everythingElse: MyWorkTask[] = [];
    for (const task of actionItems) {
        (needsAttention(task, now) ? needsYou : everythingElse).push(task);
    }
    return { needsYou, everythingElse };
}

/**
 * Sort key for age-descending order. Undated items rank below every dated one
 * so they settle at the young end of the list rather than the old end.
 */
function ageRank(task: MyWorkTask, now: Date): number {
    return ageInDays(task.addedAt, now) ?? -1;
}

/** Follow-ups under one person heading. */
export interface PersonGroup {
    person: string;
    items: MyWorkTask[];
}

/**
 * Group follow-ups by their `person` heading and order them by age descending
 * — oldest first, both within each group and across groups (a group ranks by
 * its oldest item). Ties keep first-seen file order, since `Array#sort` is
 * stable, so equal-age items still read in the order the note lists them.
 */
export function groupFollowUpsByAge(followUps: MyWorkTask[], now: Date): PersonGroup[] {
    const order: string[] = [];
    const byPerson = new Map<string, MyWorkTask[]>();
    for (const item of followUps) {
        const person = item.person ?? '';
        if (!byPerson.has(person)) {
            byPerson.set(person, []);
            order.push(person);
        }
        byPerson.get(person)!.push(item);
    }
    return order
        .map(person => ({
            person,
            items: [...byPerson.get(person)!].sort((a, b) => ageRank(b, now) - ageRank(a, now)),
        }))
        .sort((a, b) => oldest(b.items, now) - oldest(a.items, now));
}

/** The age rank of the oldest item in a group — the group's own sort key. */
function oldest(items: MyWorkTask[], now: Date): number {
    return items.reduce((max, item) => Math.max(max, ageRank(item, now)), -1);
}

// ============================================================================
// Snooze
//
// Deferring an item is a `@due(...)` bump: the date moves out, `needsAttention`
// stops matching, and the item drops out of the top bucket until the day it is
// actually due. That matters beyond tidiness — without it the only way to clear
// something from the list is ticking its box, and a box ticked for an item you
// did not do writes a false "Completed" line into the weekly summary generated
// from these files.
// ============================================================================

/** ISO `YYYY-MM-DD` for a date's local calendar day. */
export function toISODate(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `now` shifted by whole days, as an ISO date. */
export function isoDaysFromNow(now: Date, days: number): string {
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
    return toISODate(target);
}

export interface SnoozeOption {
    /** Stable key for testids and React keys. */
    key: string;
    label: string;
    /** The ISO date the item's `@due(...)` becomes. */
    due: string;
}

/**
 * The one-click snooze targets. Two are enough: "not today" and "not this
 * week" cover nearly every deferral, and anything more specific is what the
 * date picker is for.
 */
export function snoozeOptions(now: Date): SnoozeOption[] {
    return [
        { key: 'tomorrow', label: 'Tomorrow', due: isoDaysFromNow(now, 1) },
        { key: 'next-week', label: 'Next week', due: isoDaysFromNow(now, 7) },
    ];
}

// ============================================================================
// Triage summary
//
// The header chip reports triage state, not progress. `2/7 done` is a progress
// bar for a list that never empties: it measures the wrong thing and, since new
// items arrive faster than old ones close, only ever trends discouraging.
// `2 overdue · 5 due today · 3 waiting >7d` is three numbers you can act on.
// ============================================================================

/** How long a follow-up must sit before it counts as stalled. */
export const WAITING_LONG_DAYS = 7;

export interface TriageSummary {
    overdue: number;
    dueToday: number;
    /** Unchecked follow-ups older than `WAITING_LONG_DAYS`. */
    waitingLong: number;
}

/**
 * Count the three triage states across the whole snapshot. Checked items are
 * ignored everywhere — a done item is not a state you need to act on.
 *
 * Overdue and due-today span both lists (a dated follow-up is just as overdue
 * as a dated action item); "waiting" is follow-ups only, because waiting on
 * yourself is not a thing.
 */
export function triageSummary(
    actionItems: MyWorkTask[],
    followUps: MyWorkTask[],
    now: Date,
): TriageSummary {
    let overdue = 0;
    let dueToday = 0;
    for (const task of [...actionItems, ...followUps]) {
        if (task.checked) continue;
        const dueIn = daysUntilDue(task.due, now);
        if (dueIn === null) continue;
        if (dueIn < 0) overdue++;
        else if (dueIn === 0) dueToday++;
    }
    const waitingLong = followUps.filter(
        task => !task.checked && (ageInDays(task.addedAt, now) ?? 0) >= WAITING_LONG_DAYS,
    ).length;
    return { overdue, dueToday, waitingLong };
}

/**
 * Render the summary as chip segments. Zero-valued segments are dropped rather
 * than shown as `0 overdue`, so the chip reads as a list of things that are
 * true — an all-clear snapshot produces no segments at all and the chip is
 * simply not rendered.
 */
export function formatTriageSummary(summary: TriageSummary): string[] {
    const segments: string[] = [];
    if (summary.overdue > 0) segments.push(`${summary.overdue} overdue`);
    if (summary.dueToday > 0) segments.push(`${summary.dueToday} due today`);
    if (summary.waitingLong > 0) segments.push(`${summary.waitingLong} waiting >${WAITING_LONG_DAYS}d`);
    return segments;
}
