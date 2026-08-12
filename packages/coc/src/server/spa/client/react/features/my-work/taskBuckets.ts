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
 * Whether a task belongs in "Needs you today".
 *
 * SEAM — due dates. `MyWorkTask` has no `due` field yet; a later change adds
 * `@due(...)` parsing and owns that format decision. When it lands, an
 * "overdue or due today" check ORs into the result below and nothing else in
 * this module has to move. Until then age is the only urgency signal there is.
 */
export function needsAttention(task: MyWorkTask, now: Date): boolean {
    // A checked item is done — it is never what you need to look at today.
    if (task.checked) return false;
    // Future: `if (isOverdueOrDueToday(task.due, now)) return true;`
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
