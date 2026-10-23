import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BranchRangeOverview } from '../../../../src/server/spa/client/react/features/git/branches/BranchRangeOverview';
const review = vi.hoisted(() => vi.fn());
vi.mock('../../../../src/server/spa/client/react/features/git/diff/GitFileReview', () => ({ GitFileReview: (props: any) => { review(props); return <div data-testid="range-files" />; } }));
vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitDetail', () => ({ CommitDetail: (props: any) => <div data-testid="commit-scope" data-hash={props.hash} data-owner={props.attachmentDestinationId} /> }));
vi.mock('../../../../src/server/spa/client/react/utils/diffCommentApi', () => ({ listDiffCommentsForRange: () => Promise.resolve([]) }));
const commit = { hash: 'abc123', shortHash: 'abc123', subject: 'Actual range commit', author: 'Author', date: '2026-01-01', parentHashes: [] };
const range = { baseRef: 'origin/main', headRef: 'HEAD', mergeBase: 'base123', commitCount: 1, additions: 1, deletions: 0, fileCount: 1, commits: [commit] };
const files = [{ path: 'src/app.ts', status: 'M', additions: 1, deletions: 0 }];

describe('real branch comparison scope', () => {
    it('uses range commits independently of sidebar search/pagination and returns to combined files', () => {
        render(<BranchRangeOverview workspaceId="ws" attachmentDestinationId="ws" range={range} files={files} commits={[{ ...commit, hash: 'wrong', subject: 'Unrelated history' }]} />);
        expect(screen.queryByRole('option', { name: /Unrelated history/ })).toBeNull();
        fireEvent.change(screen.getByLabelText('Commit scope'), { target: { value: 'abc123' } });
        expect(screen.getByTestId('commit-scope').dataset).toMatchObject({ hash: 'abc123', owner: 'ws' });
        expect(screen.queryByTestId('range-files')).toBeNull();
        fireEvent.change(screen.getByLabelText('Commit scope'), { target: { value: '' } });
        expect(screen.getByTestId('range-files')).toBeTruthy();
        expect(review.mock.calls.at(-1)![0].files).toEqual(files);
    });
    it('uses the resolved comparison base, preserves fallback, and forwards base changes', () => {
        const change = vi.fn();
        render(<BranchRangeOverview workspaceId="ws" range={{ ...range, baseModeFallback: true }} files={files} baseMode="upstream" onBaseModeChange={change} />);
        expect(screen.getByTestId('branch-range-base-fallback').textContent).toContain('origin/main');
        fireEvent.change(screen.getByLabelText('Comparison base'), { target: { value: 'default-branch' } });
        expect(change).toHaveBeenCalledWith('default-branch');
    });
    it('resets commit scope and range identity when HEAD changes with identical file statistics', () => {
        const view = render(<BranchRangeOverview workspaceId="ws" range={range} files={files} />);
        const first = review.mock.calls.at(-1)![0];
        fireEvent.change(screen.getByLabelText('Commit scope'), { target: { value: 'abc123' } });
        view.rerender(<BranchRangeOverview workspaceId="ws" range={{ ...range, commits: [{ ...commit, hash: 'def456' }] }} files={files} />);
        expect((screen.getByLabelText('Commit scope') as HTMLSelectElement).value).toBe('');
        const second = review.mock.calls.at(-1)![0];
        expect(second.comparisonKey).not.toBe(first.comparisonKey);
        expect(second.source.cacheKey).not.toBe(first.source.cacheKey);
        expect(second.source.fileDiffUrl('src/app.ts')).not.toBe(first.source.fileDiffUrl('src/app.ts'));
    });
    it('invalidates reviewed comparison identity when only the resolved base changes', () => {
        const view = render(<BranchRangeOverview workspaceId="ws" range={{ ...range, baseSha: 'base-one', headSha: 'head' }} files={files} />);
        const first = review.mock.calls.at(-1)![0];
        view.rerender(<BranchRangeOverview workspaceId="ws" range={{ ...range, baseSha: 'base-two', headSha: 'head' }} files={files} />);
        const second = review.mock.calls.at(-1)![0];
        expect(second.comparisonKey).not.toBe(first.comparisonKey);
        expect(second.source.fileDiffUrl('src/app.ts')).not.toBe(first.source.fileDiffUrl('src/app.ts'));
    });
    it('gives the header row and its native selects dark-mode text colors', () => {
        render(<BranchRangeOverview workspaceId="ws" range={range} files={files} onBaseModeChange={vi.fn()} />);
        expect(screen.getByTestId('branch-commit-strip-header').className).toContain('dark:text-[#cccccc]');
        for (const label of ['Comparison base', 'Commit scope']) {
            const select = screen.getByLabelText(label);
            expect(select.className).toContain('text-inherit');
            expect(select.className).toContain('dark:[color-scheme:dark]');
        }
    });
    it('keeps missing scope metadata explicit while retaining real file navigation', () => {
        render(<BranchRangeOverview workspaceId="ws" range={{ ...range, commits: undefined }} files={files} />);
        expect((screen.getByRole('option', { name: 'Commit scope unavailable' }) as HTMLOptionElement).disabled).toBe(true);
        expect(screen.getByTestId('range-files')).toBeTruthy();
    });
});
