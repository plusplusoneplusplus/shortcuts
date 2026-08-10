/**
 * Unit tests for the composer PR chip fold logic — the pure partition behind
 * ChatComposerPrChips' "N earlier PRs" row.
 *
 * The four fold rules and their interactions are the design here, so each gets
 * direct coverage: only settled chips fold, the stack is never left chip-less,
 * a lone foldable chip renders inline instead, and open/draft chips still fold
 * past the active cap. Plus the summary tally the fold row renders.
 */
import { describe, it, expect } from 'vitest';
import {
    partitionComposerPrChips,
    summarizeFoldedPrChips,
    isFoldableComposerPrChip,
    sortNewestFirst,
    DEFAULT_ACTIVE_CAP,
} from '../../../src/server/spa/client/react/features/chat/conversation/composerPrChipFold';
import type { PrStatusCardItem } from '../../../src/server/spa/client/react/features/chat/conversation/PrStatusCard';

/** A `ready` chip whose PR is in `status`. `n` doubles as key, number, and age. */
function ready(n: number, status: string): PrStatusCardItem {
    return {
        key: `gh:${n}`,
        repoId: 'ws1',
        number: n,
        state: 'ready',
        createdAt: `2024-01-${String(n).padStart(2, '0')}T00:00:00Z`,
        pr: {
            number: n,
            title: `PR ${n}`,
            status,
            sourceBranch: 'feat/x',
            targetBranch: 'main',
        },
    };
}

/** A chip still fetching or stuck on an error — never foldable (rule 1). */
function pending(n: number, state: 'loading' | 'error'): PrStatusCardItem {
    return {
        key: `gh:${n}`,
        repoId: 'ws1',
        number: n,
        state,
        createdAt: `2024-01-${String(n).padStart(2, '0')}T00:00:00Z`,
        ...(state === 'error' ? { error: 'boom' } : {}),
    };
}

const keys = (items: PrStatusCardItem[]) => items.map(item => item.key);

describe('partitionComposerPrChips', () => {
    it('returns empty head and folded for no items', () => {
        expect(partitionComposerPrChips([])).toEqual({ head: [], folded: [] });
    });

    it('folds nothing when every chip is open or draft', () => {
        const items = [ready(3, 'open'), ready(2, 'draft'), ready(1, 'open')];
        const { head, folded } = partitionComposerPrChips(items);
        expect(keys(head)).toEqual(['gh:3', 'gh:2', 'gh:1']);
        expect(folded).toEqual([]);
    });

    it('keeps the newest settled chip expanded when nothing is active (rule 2)', () => {
        // The real case: 5 chips, all Merged. The chat must still show what it
        // shipped rather than collapsing to a bare summary row.
        const items = [1, 2, 3, 4, 5].map(n => ready(n, 'merged'));
        const { head, folded } = partitionComposerPrChips(items);
        expect(keys(head)).toEqual(['gh:5']);
        expect(keys(folded)).toEqual(['gh:4', 'gh:3', 'gh:2', 'gh:1']);
    });

    it('folds every settled chip once something active is expanded', () => {
        const items = [ready(5, 'open'), ready(4, 'merged'), ready(3, 'closed'), ready(2, 'merged')];
        const { head, folded } = partitionComposerPrChips(items);
        expect(keys(head)).toEqual(['gh:5']);
        expect(keys(folded)).toEqual(['gh:4', 'gh:3', 'gh:2']);
    });

    it('folds open/draft chips past the active cap, newest first (rule 4)', () => {
        const items = [5, 4, 3, 2, 1].map(n => ready(n, 'open'));
        const { head, folded } = partitionComposerPrChips(items, { activeCap: 3 });
        expect(keys(head)).toEqual(['gh:5', 'gh:4', 'gh:3']);
        expect(keys(folded)).toEqual(['gh:2', 'gh:1']);
    });

    it('defaults the active cap to DEFAULT_ACTIVE_CAP', () => {
        const items = [5, 4, 3, 2, 1].map(n => ready(n, 'open'));
        expect(DEFAULT_ACTIVE_CAP).toBe(3);
        expect(partitionComposerPrChips(items)).toEqual(
            partitionComposerPrChips(items, { activeCap: DEFAULT_ACTIVE_CAP }),
        );
    });

    it('folds active overflow together with settled chips, preserving newest-first order', () => {
        const items = [
            ready(6, 'open'), ready(5, 'open'), ready(4, 'merged'),
            ready(3, 'open'), ready(2, 'closed'), ready(1, 'open'),
        ];
        const { head, folded } = partitionComposerPrChips(items, { activeCap: 2 });
        // Cap keeps the two newest open PRs; #3 and #1 overflow and join the
        // settled #4 and #2 in the fold, still ordered newest first.
        expect(keys(head)).toEqual(['gh:6', 'gh:5']);
        expect(keys(folded)).toEqual(['gh:4', 'gh:3', 'gh:2', 'gh:1']);
    });

    it('renders a single foldable chip inline instead of behind a fold row (rule 3)', () => {
        const items = [ready(2, 'open'), ready(1, 'merged')];
        const { head, folded } = partitionComposerPrChips(items);
        expect(keys(head)).toEqual(['gh:2', 'gh:1']);
        expect(folded).toEqual([]);
    });

    it('renders a lone merged chip inline (nothing to fold at all)', () => {
        const { head, folded } = partitionComposerPrChips([ready(1, 'merged')]);
        expect(keys(head)).toEqual(['gh:1']);
        expect(folded).toEqual([]);
    });

    it('never folds loading or error chips (rule 1)', () => {
        // Even well past the cap: an error chip you cannot see is a chip nobody
        // will ever retry.
        const items = [
            pending(6, 'error'), pending(5, 'loading'), pending(4, 'error'),
            pending(3, 'loading'), pending(2, 'error'),
        ];
        const { head, folded } = partitionComposerPrChips(items, { activeCap: 1 });
        expect(keys(head)).toEqual(['gh:6', 'gh:5', 'gh:4', 'gh:3', 'gh:2']);
        expect(folded).toEqual([]);
    });

    it('folds every settled chip when only a pinned error chip is expanded', () => {
        // A visible error chip already keeps the stack non-empty, so rule 2 does
        // not additionally hold back the newest merged PR.
        const items = [pending(5, 'error'), ready(4, 'merged'), ready(3, 'merged'), ready(2, 'closed')];
        const { head, folded } = partitionComposerPrChips(items);
        expect(keys(head)).toEqual(['gh:5']);
        expect(keys(folded)).toEqual(['gh:4', 'gh:3', 'gh:2']);
    });

    it('treats an unknown or missing PR status as not foldable', () => {
        const noDetail: PrStatusCardItem = { key: 'gh:9', repoId: 'ws1', number: 9, state: 'ready' };
        const items = [noDetail, ready(3, 'merged'), ready(2, 'merged'), ready(1, 'merged')];
        const { head, folded } = partitionComposerPrChips(items);
        expect(keys(head)).toEqual(['gh:9']);
        expect(keys(folded)).toEqual(['gh:3', 'gh:2', 'gh:1']);
    });

    it('sorts unsorted input newest-first before partitioning', () => {
        const items = [ready(2, 'merged'), ready(5, 'open'), ready(1, 'merged'), ready(3, 'merged')];
        const { head, folded } = partitionComposerPrChips(items);
        expect(keys(head)).toEqual(['gh:5']);
        expect(keys(folded)).toEqual(['gh:3', 'gh:2', 'gh:1']);
    });

    it('treats an activeCap of 0 as folding all active chips but still keeps one expanded', () => {
        const items = [ready(3, 'open'), ready(2, 'open')];
        const { head, folded } = partitionComposerPrChips(items, { activeCap: 0 });
        // Both active chips fold; nothing settled remains to hold back, so the
        // stack legitimately collapses to just the fold row.
        expect(head).toEqual([]);
        expect(keys(folded)).toEqual(['gh:3', 'gh:2']);
    });
});

describe('isFoldableComposerPrChip', () => {
    it('is true only for ready chips in a terminal state', () => {
        expect(isFoldableComposerPrChip(ready(1, 'merged'))).toBe(true);
        expect(isFoldableComposerPrChip(ready(1, 'closed'))).toBe(true);
        expect(isFoldableComposerPrChip(ready(1, 'open'))).toBe(false);
        expect(isFoldableComposerPrChip(ready(1, 'draft'))).toBe(false);
        expect(isFoldableComposerPrChip(pending(1, 'loading'))).toBe(false);
        expect(isFoldableComposerPrChip(pending(1, 'error'))).toBe(false);
    });
});

describe('sortNewestFirst', () => {
    it('orders by descending createdAt and keeps input order for ties', () => {
        const a = { ...ready(1, 'open'), key: 'a', createdAt: '2024-01-01T00:00:00Z' };
        const b = { ...ready(1, 'open'), key: 'b', createdAt: '2024-01-01T00:00:00Z' };
        const c = { ...ready(1, 'open'), key: 'c', createdAt: '2024-02-01T00:00:00Z' };
        expect(keys(sortNewestFirst([a, b, c]))).toEqual(['c', 'a', 'b']);
    });

    it('sorts items with a missing or unparseable createdAt last', () => {
        const withDate = { ...ready(1, 'open'), key: 'dated' };
        const missing = { ...ready(1, 'open'), key: 'missing', createdAt: undefined };
        const bad = { ...ready(1, 'open'), key: 'bad', createdAt: 'not-a-date' };
        expect(keys(sortNewestFirst([missing, bad, withDate]))).toEqual(['dated', 'missing', 'bad']);
    });

    it('accepts epoch-number createdAt values', () => {
        const older = { ...ready(1, 'open'), key: 'older', createdAt: 1000 };
        const newer = { ...ready(1, 'open'), key: 'newer', createdAt: 2000 };
        expect(keys(sortNewestFirst([older, newer]))).toEqual(['newer', 'older']);
    });
});

describe('summarizeFoldedPrChips', () => {
    it('tallies a merged-heavy fold into a readable breakdown', () => {
        const folded = [ready(4, 'merged'), ready(3, 'merged'), ready(2, 'merged'), ready(1, 'closed')];
        const summary = summarizeFoldedPrChips(folded);
        expect(summary.count).toBe(4);
        expect(summary.breakdownText).toBe('3 merged · 1 closed');
        expect(summary.breakdown).toEqual([
            { status: 'merged', label: 'merged', count: 3 },
            { status: 'closed', label: 'closed', count: 1 },
        ]);
        expect(summary.numbers).toEqual([4, 3, 2, 1]);
    });

    it('caps the state dots at the first few folded PRs', () => {
        const folded = [6, 5, 4, 3, 2, 1].map(n => ready(n, 'merged'));
        expect(summarizeFoldedPrChips(folded).dotStatuses).toEqual(['merged', 'merged', 'merged', 'merged']);
    });

    it('surfaces an active PR hidden by the cap in the breakdown', () => {
        const summary = summarizeFoldedPrChips([ready(3, 'open'), ready(2, 'merged')]);
        expect(summary.breakdownText).toBe('1 open · 1 merged');
        expect(summary.dotStatuses).toEqual(['open', 'merged']);
    });

    it('falls back to the detection number and an unknown status without a loaded detail', () => {
        const noDetail: PrStatusCardItem = { key: 'gh:9', repoId: 'ws1', number: 9, state: 'ready' };
        const summary = summarizeFoldedPrChips([noDetail]);
        expect(summary.numbers).toEqual([9]);
        expect(summary.breakdownText).toBe('1 unknown');
    });

    it('summarizes an empty fold as nothing', () => {
        expect(summarizeFoldedPrChips([])).toEqual({
            count: 0,
            breakdown: [],
            breakdownText: '',
            numbers: [],
            dotStatuses: [],
        });
    });
});
