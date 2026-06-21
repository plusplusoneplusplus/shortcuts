/**
 * Unit tests for the pure aggregate merge-status reducer that drives the chat PR
 * card's collapsed-header indicator.
 *
 * Covers: the "quiet" cases (no ready row / plain open PRs → null), the single-PR
 * detail shape (auto-merge armed/queued/blocked, provider-aware label, terminal
 * lifecycle), and the multi-PR per-state count shape (attention ordering +
 * same-kind aggregation).
 */
import { describe, it, expect } from 'vitest';
import { summarizeMergeStatus } from '../../../src/server/spa/client/react/features/chat/conversation/prMergeStatusSummary';
import type { PrStatusCardItem, PrAutoMergeInfo } from '../../../src/server/spa/client/react/features/chat/conversation/PrStatusCard';

let nextKey = 0;

function readyItem(overrides: Partial<PrStatusCardItem> = {}): PrStatusCardItem {
    const key = overrides.key ?? `o:${nextKey++}`;
    return {
        key,
        repoId: 'ws',
        number: 1,
        state: 'ready',
        pr: { number: 1, title: 'PR', status: 'open', sourceBranch: 'a', targetBranch: 'main' },
        ...overrides,
    };
}

function prItem(status: string, autoMerge?: PrAutoMergeInfo, url?: string): PrStatusCardItem {
    return readyItem({
        pr: { number: 1, title: 'PR', status, sourceBranch: 'a', targetBranch: 'main', url, autoMerge },
    });
}

describe('summarizeMergeStatus — quiet cases', () => {
    it('returns null for an empty list', () => {
        expect(summarizeMergeStatus([])).toBeNull();
    });

    it('returns null when no row is ready yet', () => {
        expect(
            summarizeMergeStatus([
                readyItem({ state: 'loading', pr: undefined }),
                readyItem({ state: 'error', pr: undefined, error: 'x' }),
            ]),
        ).toBeNull();
    });

    it('returns null for plain open PRs with no auto-merge', () => {
        expect(summarizeMergeStatus([prItem('open'), prItem('draft')])).toBeNull();
    });
});

describe('summarizeMergeStatus — single PR', () => {
    it('mirrors an armed auto-merge with the GitHub label', () => {
        const summary = summarizeMergeStatus([
            prItem('open', { enabled: true, state: 'armed', mergeMethod: 'squash', enabledBy: { displayName: 'Carol' } }, 'https://github.com/o/r/pull/1'),
        ]);
        expect(summary).toEqual({
            kind: 'single',
            autoMerge: { label: 'Auto-merge', state: 'armed', mergeMethod: 'squash', enabledBy: 'Carol', blockedReason: undefined },
            lifecycle: undefined,
        });
    });

    it('mirrors a blocked auto-merge with the human reason', () => {
        const summary = summarizeMergeStatus([
            prItem('open', { enabled: true, state: 'blocked', blockedReason: 'pending-review' }, 'https://github.com/o/r/pull/1'),
        ]);
        expect(summary).toMatchObject({ kind: 'single', autoMerge: { state: 'blocked', blockedReason: 'pending review' } });
    });

    it('is provider-aware (ADO → Auto-complete)', () => {
        const summary = summarizeMergeStatus([
            prItem('open', { enabled: true, state: 'armed' }, 'https://dev.azure.com/org/proj/_git/r/pullrequest/1'),
        ]);
        expect(summary).toMatchObject({ kind: 'single', autoMerge: { label: 'Auto-complete', state: 'armed' } });
    });

    it('falls back to terminal lifecycle when there is no active auto-merge', () => {
        expect(summarizeMergeStatus([prItem('merged')])).toEqual({ kind: 'single', autoMerge: undefined, lifecycle: 'merged' });
        expect(summarizeMergeStatus([prItem('closed')])).toEqual({ kind: 'single', autoMerge: undefined, lifecycle: 'closed' });
    });

    it('reports the single auto-merge PR even when other rows are plain open', () => {
        const summary = summarizeMergeStatus([
            prItem('open'),
            prItem('open', { enabled: true, state: 'queued' }, 'https://github.com/o/r/pull/2'),
            prItem('open'),
        ]);
        expect(summary).toMatchObject({ kind: 'single', autoMerge: { state: 'queued' } });
    });
});

describe('summarizeMergeStatus — multi PR', () => {
    it('collapses two or more reportable rows to per-state counts ordered by attention', () => {
        const summary = summarizeMergeStatus([
            prItem('merged'),
            prItem('open', { enabled: true, state: 'armed' }, 'https://github.com/o/r/pull/2'),
            prItem('open', { enabled: true, state: 'blocked', blockedReason: 'conflicts' }, 'https://github.com/o/r/pull/3'),
        ]);
        expect(summary?.kind).toBe('multi');
        const segments = (summary as { kind: 'multi'; segments: Array<{ state: string; count: number; emoji: string }> }).segments;
        expect(segments.map(s => s.state)).toEqual(['blocked', 'armed', 'merged']);
        expect(segments.map(s => s.count)).toEqual([1, 1, 1]);
        expect(segments.map(s => s.emoji)).toEqual(['⛔', '⚡', '🟣']);
        expect(segments.map(s => s.label)).toEqual(['blocked', 'armed', 'merged']);
    });

    it('aggregates the count for repeated states', () => {
        const summary = summarizeMergeStatus([
            prItem('open', { enabled: true, state: 'blocked', blockedReason: 'conflicts' }, 'https://github.com/o/r/pull/1'),
            prItem('open', { enabled: true, state: 'blocked', blockedReason: 'pending-review' }, 'https://github.com/o/r/pull/2'),
            prItem('closed'),
        ]);
        const segments = (summary as { segments: Array<{ state: string; count: number }> }).segments;
        expect(segments).toEqual([
            expect.objectContaining({ state: 'blocked', count: 2 }),
            expect.objectContaining({ state: 'closed', count: 1 }),
        ]);
    });

    it('ignores non-ready and plain-open rows when counting', () => {
        const summary = summarizeMergeStatus([
            readyItem({ state: 'loading', pr: undefined }),
            prItem('open'),
            prItem('merged'),
            prItem('closed'),
        ]);
        const segments = (summary as { segments: Array<{ state: string; count: number }> }).segments;
        expect(segments.map(s => s.state)).toEqual(['merged', 'closed']);
    });
});
