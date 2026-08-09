/**
 * composerPrChipFold — pure fold logic for the composer's stacked PR chips.
 *
 * A chat that ships several commits ends up with a PR stack taller than the
 * textarea it is docked above. The fix is to fold by **PR state, not recency**: a
 * merged/closed PR needs nothing from the user, while an open one with checks
 * running does. So the settled chips collapse into a single "N earlier PRs" row
 * and the ones you might still act on stay expanded.
 *
 * No React, no I/O — {@link ChatComposerPrChips} stays the thin connected wrapper
 * it already is and this module is unit-tested directly.
 *
 * The four rules, in the order they interact:
 *   1. Only settled chips fold. A `loading` or `error` chip is *pinned* — an error
 *      chip you cannot see is a chip nobody will ever retry — and so are open/draft
 *      PRs.
 *   2. Never chip-less. When nothing is expanded on its own merit (the common
 *      all-merged case), the newest settled chip stays expanded: a chat that
 *      shipped work must still show what it shipped, not just a bare summary row.
 *   3. Never fold fewer than two. The fold row costs a row of its own, so folding a
 *      single chip is a net loss — it renders inline instead.
 *   4. Active cap. Open/draft chips fold past {@link DEFAULT_ACTIVE_CAP} too, so a
 *      long-running chat cannot swallow the composer. Newest-first ordering means
 *      the cap keeps the most recent ones.
 */
import { prStatusBadge } from '../../pull-requests/pr-utils';
import { isTerminalPrStatus } from './prTerminalStatus';
import type { PrStatusCardItem } from './PrStatusCard';

/** Open/draft chips shown before even they start folding (rule 4). */
export const DEFAULT_ACTIVE_CAP = 3;

/** Folded PRs whose state dots render in the summary row before the "+N" spill. */
export const FOLD_DOT_LIMIT = 4;

export interface PartitionComposerPrChipsOptions {
    /** Max open/draft chips left expanded. Defaults to {@link DEFAULT_ACTIVE_CAP}. */
    activeCap?: number;
}

export interface ComposerPrChipPartition {
    /** Chips rendered expanded, newest first. */
    head: PrStatusCardItem[];
    /** Chips hidden behind the fold row, newest first. Empty means no fold row. */
    folded: PrStatusCardItem[];
}

/** Stable newest-first ordering: descending `createdAt`, input order otherwise. */
export function sortNewestFirst(items: PrStatusCardItem[]): PrStatusCardItem[] {
    const toMs = (v: string | number | undefined): number => {
        if (v == null) return Number.NEGATIVE_INFINITY;
        if (typeof v === 'number') return v;
        const t = new Date(v).getTime();
        return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
    };
    return items
        .map((item, idx) => ({ item, idx }))
        .sort((a, b) => {
            const diff = toMs(b.item.createdAt) - toMs(a.item.createdAt);
            return diff !== 0 ? diff : a.idx - b.idx;
        })
        .map(({ item }) => item);
}

/**
 * Whether a chip is settled enough to fold (rule 1): its detail loaded AND the PR
 * reached a terminal state. A chip still loading or stuck in `error` is pinned
 * regardless of what its last-known status was.
 */
export function isFoldableComposerPrChip(item: PrStatusCardItem): boolean {
    return item.state === 'ready' && isTerminalPrStatus(item.pr?.status);
}

/**
 * Splits chips into the expanded `head` and the folded remainder, applying all
 * four fold rules. Sorts newest-first internally, so callers may pass any order;
 * both output arrays come back newest-first.
 *
 * Pass only the chips the user has not dismissed — folding hides, dismissing
 * removes, and the two are deliberately orthogonal.
 */
export function partitionComposerPrChips(
    items: PrStatusCardItem[],
    options: PartitionComposerPrChipsOptions = {},
): ComposerPrChipPartition {
    const activeCap = Math.max(0, options.activeCap ?? DEFAULT_ACTIVE_CAP);
    const sorted = sortNewestFirst(items);

    // Three buckets: settled (foldable), pinned (loading/error — never folds, rule
    // 1), and active (ready open/draft — folds only past the cap, rule 4).
    const settled = sorted.filter(isFoldableComposerPrChip);
    const pinned = sorted.filter(item => item.state !== 'ready');
    const active = sorted.filter(item => item.state === 'ready' && !isFoldableComposerPrChip(item));

    const foldKeys = new Set<string>();
    for (const item of active.slice(activeCap)) foldKeys.add(item.key);
    // Rule 2: only when nothing else would render expanded — a pinned error chip
    // already keeps the stack non-empty, so it does not need a settled chip too.
    const keepNewestSettled = active.length === 0 && pinned.length === 0;
    for (const item of settled.slice(keepNewestSettled ? 1 : 0)) foldKeys.add(item.key);

    // Rule 3: a one-chip fold trades a chip row for a fold row — no height saved.
    if (foldKeys.size < 2) return { head: sorted, folded: [] };

    return {
        head: sorted.filter(item => !foldKeys.has(item.key)),
        folded: sorted.filter(item => foldKeys.has(item.key)),
    };
}

/** One status tally in the fold row's breakdown. */
export interface FoldedPrStatusTally {
    /** Raw PR status (e.g. 'merged'). */
    status: string;
    /** Lowercased display label from {@link prStatusBadge} (e.g. 'merged'). */
    label: string;
    count: number;
}

export interface FoldedPrChipsSummary {
    /** How many chips are hidden. */
    count: number;
    /** Per-status tallies, in newest-first order of first appearance. */
    breakdown: FoldedPrStatusTally[];
    /** Rendered breakdown, e.g. `4 merged · 1 closed`. */
    breakdownText: string;
    /** Folded PR numbers, newest first. */
    numbers: number[];
    /** Statuses of the first few folded PRs — the fold row's state dots. */
    dotStatuses: string[];
}

/**
 * Tallies the folded chips so the summary row can say what is down there without
 * being expanded — the whole point of the fold is that you can still tell whether
 * anything hidden needs attention.
 */
export function summarizeFoldedPrChips(folded: PrStatusCardItem[]): FoldedPrChipsSummary {
    const statuses = folded.map(item => item.pr?.status ?? 'unknown');
    const tallies: FoldedPrStatusTally[] = [];
    for (const status of statuses) {
        const existing = tallies.find(tally => tally.status === status);
        if (existing) {
            existing.count += 1;
        } else {
            tallies.push({ status, label: prStatusBadge(status).label.toLowerCase(), count: 1 });
        }
    }
    return {
        count: folded.length,
        breakdown: tallies,
        breakdownText: tallies.map(tally => `${tally.count} ${tally.label}`).join(' · '),
        numbers: folded.map(item => item.pr?.number ?? item.number),
        dotStatuses: statuses.slice(0, FOLD_DOT_LIMIT),
    };
}
