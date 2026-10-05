import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BranchRangeOverview } from '../../../../src/server/spa/client/react/features/git/branches/BranchRangeOverview';
import type { BranchRangeInfo } from '../../../../src/server/spa/client/react/features/git/branches/BranchChanges';
import { registerCloneBaseUrls, setActiveCloneForRouting } from '../../../../src/server/spa/client/react/repos/cloneRegistry';

vi.mock('../../../../src/server/spa/client/react/features/git/branches/BranchCommitStrip', () => ({
    BranchCommitStrip: () => null,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/branches/BranchAllFilesDiff', () => ({
    BranchAllFilesDiff: () => null,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/diff/diffCommentApi', () => ({
    listDiffCommentsForRange: () => Promise.resolve([]),
}));

const range: BranchRangeInfo = {
    branchName: 'feature', baseRef: 'main', headRef: 'HEAD', mergeBase: 'abc123',
    commitCount: 1, additions: 1, deletions: 0, fileCount: 1,
};

beforeEach(() => {
    registerCloneBaseUrls([
        { workspaceId: 'ws1', cloneKey: 'remote:one:ws1', baseUrl: 'https://one.example' },
        { workspaceId: 'ws1', cloneKey: 'remote:two:ws1', baseUrl: 'https://two.example' },
    ]);
    setActiveCloneForRouting('remote:two:ws1');
});

describe('BranchRangeOverview review opener ownership', () => {
    it('retains the mounted owner and comparison base independently of the active clone', () => {
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        const result = render(<BranchRangeOverview workspaceId="ws1" range={range} />);
        for (const [owner, baseUrl] of [
            ['remote:one:ws1', 'https://one.example'],
            ['remote:two:ws1', 'https://two.example'],
            ['ws1', null],
        ] as const) {
            result.rerender(<BranchRangeOverview workspaceId="ws1" range={range} baseMode="upstream" attachmentDestinationId={owner} />);
            fireEvent.click(screen.getByTestId('branch-range-popout-btn'));
            const url = new URL(String(open.mock.calls.at(-1)![0]), 'https://dashboard.example');
            expect(url.searchParams.get('workspace')).toBe('ws1');
            expect(url.searchParams.get('sourceSelectionId')).toBe(owner);
            expect(url.searchParams.get('cloneBaseUrl')).toBe(baseUrl);
            expect(url.searchParams.get('base')).toBe('upstream');
            expect(url.hash).toBe('#popout/git-review/branch-range');
        }
        result.rerender(<BranchRangeOverview workspaceId="ws1" range={range} />);
        fireEvent.click(screen.getByTestId('branch-range-popout-btn'));
        const url = new URL(String(open.mock.calls.at(-1)![0]), 'https://dashboard.example');
        expect(url.searchParams.get('sourceSelectionId')).toBeNull();
        expect(url.searchParams.get('cloneBaseUrl')).toBe('https://two.example');
        expect(url.searchParams.get('base')).toBeNull();
        open.mockRestore();
    });
});
