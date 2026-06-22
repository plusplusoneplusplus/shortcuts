/**
 * Unit tests for the pure header-status reducers that drive the chat PR card's
 * collapsed-header indicators.
 *
 * - summarizeLifecycleStatus: the always-shown PR lifecycle (open/draft/merged/
 *   closed) — single badge vs per-status counts; null only when no row is ready.
 * - summarizeMergeStatus: the auto-merge augmentation (armed/queued/blocked only),
 *   single detail vs per-state counts; null when no ready row has active auto-merge.
 */
import { describe, it, expect } from 'vitest';
import {
    summarizeLifecycleStatus,
    summarizeMergeStatus,
} from '../../../src/server/spa/client/react/features/chat/conversation/prMergeStatusSummary';
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

describe('summarizeLifecycleStatus (always shown)', () => {
    it('returns null when no row is ready yet', () => {
        expect(summarizeLifecycleStatus([])).toBeNull();
        expect(
            summarizeLifecycleStatus([
                readyItem({ state: 'loading', pr: undefined }),
                readyItem({ state: 'error', pr: undefined, error: 'x' }),
            ]),
        ).toBeNull();
    });

    it('single PR: mirrors the lifecycle status badge (including a plain open PR)', () => {
        expect(summarizeLifecycleStatus([prItem('open')])).toEqual({
            kind: 'single', status: 'open', emoji: '🟢', toneClass: 'bg-green-100 text-green-800', label: 'Open',
        });
        expect(summarizeLifecycleStatus([prItem('merged')])).toMatchObject({ kind: 'single', status: 'merged', label: 'Merged' });
        expect(summarizeLifecycleStatus([prItem('draft')])).toMatchObject({ kind: 'single', status: 'draft', label: 'Draft' });
        expect(summarizeLifecycleStatus([prItem('closed')])).toMatchObject({ kind: 'single', status: 'closed', label: 'Closed' });
    });

    it('is shown for an open PR even when auto-merge is armed (lifecycle is independent)', () => {
        const summary = summarizeLifecycleStatus([
            prItem('open', { enabled: true, state: 'armed' }, 'https://github.com/o/r/pull/1'),
        ]);
        expect(summary).toMatchObject({ kind: 'single', status: 'open', label: 'Open' });
    });

    it('multi PR: per-status counts ordered open → draft → merged → closed', () => {
        const summary = summarizeLifecycleStatus([
            prItem('merged'),
            prItem('open'),
            prItem('closed'),
            prItem('open'),
            prItem('draft'),
        ]);
        expect(summary?.kind).toBe('multi');
        const segments = (summary as { segments: Array<{ status: string; count: number; label: string }> }).segments;
        expect(segments.map(s => s.status)).toEqual(['open', 'draft', 'merged', 'closed']);
        expect(segments.map(s => s.count)).toEqual([2, 1, 1, 1]);
        // Count chips use lowercased labels ("2 open", "1 merged").
        expect(segments.map(s => s.label)).toEqual(['open', 'draft', 'merged', 'closed']);
    });

    it('multi PR: ignores non-ready rows', () => {
        const summary = summarizeLifecycleStatus([
            readyItem({ state: 'loading', pr: undefined }),
            prItem('open'),
            prItem('merged'),
        ]);
        const segments = (summary as { segments: Array<{ status: string; count: number }> }).segments;
        expect(segments.map(s => s.status)).toEqual(['open', 'merged']);
    });
});

describe('summarizeMergeStatus (auto-merge only)', () => {
    it('returns null when no ready row has active auto-merge', () => {
        expect(summarizeMergeStatus([])).toBeNull();
        expect(summarizeMergeStatus([prItem('open'), prItem('merged'), prItem('closed')])).toBeNull();
        expect(summarizeMergeStatus([readyItem({ state: 'loading', pr: undefined })])).toBeNull();
    });

    it('single auto-merge PR: mirrors the auto-merge with the GitHub label', () => {
        const summary = summarizeMergeStatus([
            prItem('open', { enabled: true, state: 'armed', mergeMethod: 'squash', enabledBy: { displayName: 'Carol' } }, 'https://github.com/o/r/pull/1'),
        ]);
        expect(summary).toEqual({
            kind: 'single',
            autoMerge: { label: 'Auto-merge', state: 'armed', mergeMethod: 'squash', enabledBy: 'Carol', blockedReason: undefined },
        });
    });

    it('single auto-merge PR: blocked carries the human reason, provider-aware (ADO)', () => {
        const summary = summarizeMergeStatus([
            prItem('open', { enabled: true, state: 'blocked', blockedReason: 'pending-review' }, 'https://dev.azure.com/org/proj/_git/r/pullrequest/1'),
        ]);
        expect(summary).toMatchObject({ kind: 'single', autoMerge: { label: 'Auto-complete', state: 'blocked', blockedReason: 'pending review' } });
    });

    it('reports the single auto-merge PR among other plain/terminal rows', () => {
        const summary = summarizeMergeStatus([
            prItem('open'),
            prItem('merged'),
            prItem('open', { enabled: true, state: 'queued' }, 'https://github.com/o/r/pull/3'),
        ]);
        expect(summary).toMatchObject({ kind: 'single', autoMerge: { state: 'queued' } });
    });

    it('multi auto-merge PRs: per-state counts ordered blocked → queued → armed', () => {
        const summary = summarizeMergeStatus([
            prItem('open', { enabled: true, state: 'armed' }, 'https://github.com/o/r/pull/1'),
            prItem('open', { enabled: true, state: 'blocked', blockedReason: 'conflicts' }, 'https://github.com/o/r/pull/2'),
            prItem('open', { enabled: true, state: 'armed' }, 'https://github.com/o/r/pull/3'),
        ]);
        const segments = (summary as { kind: 'multi'; segments: Array<{ state: string; count: number; emoji: string }> }).segments;
        expect(segments.map(s => s.state)).toEqual(['blocked', 'armed']);
        expect(segments.map(s => s.count)).toEqual([1, 2]);
        expect(segments.map(s => s.emoji)).toEqual(['⛔', '⚡']);
    });

    it('does not count merged/closed lifecycle (that is the lifecycle summary)', () => {
        const summary = summarizeMergeStatus([
            prItem('merged'),
            prItem('closed'),
            prItem('open', { enabled: true, state: 'armed' }, 'https://github.com/o/r/pull/3'),
        ]);
        // Only one active auto-merge → single, lifecycle handled separately.
        expect(summary).toMatchObject({ kind: 'single', autoMerge: { state: 'armed' } });
    });
});
