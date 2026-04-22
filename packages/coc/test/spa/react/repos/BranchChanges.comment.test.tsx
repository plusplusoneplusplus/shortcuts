/**
 * Tests for BranchChanges — active comment count badge rendering.
 *
 * Validates that:
 * - A 💬{n} badge is rendered before the status char when the file has open comments.
 * - The badge is absent when the count is 0.
 * - Multiple files with different counts each show their own badge.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { mockViewport } from '../../../spa/helpers/viewport-mock';

// --- Module mocks ---

// Mock computeDiffCommentKey to return predictable values
vi.mock('../../../../src/server/spa/client/diff-comment-utils', () => ({
    computeDiffCommentKey: async (_repo: string, _old: string, _new: string, filePath: string) =>
        `key-${filePath}`,
}));

// Mock useFileCommentCounts so we control what counts are returned
const mockUseFileCommentCounts = vi.fn<[], Map<string, number>>();
vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useFileCommentCounts', () => ({
    useFileCommentCounts: () => mockUseFileCommentCounts(),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: () => Promise.resolve({ files: [] }),
}));

vi.mock('../../../../src/server/spa/client/react/shared', () => ({
    Spinner: () => <span>loading</span>,
    TruncatedPath: ({ path }: { path: string }) => <span>{path}</span>,
}));

import { BranchChanges } from '../../../../src/server/spa/client/react/features/git/branches/BranchChanges';
import type { BranchRangeInfo } from '../../../../src/server/spa/client/react/features/git/branches/BranchChanges';
import userEvent from '@testing-library/user-event';

const RANGE_INFO: BranchRangeInfo = {
    baseRef: 'origin/main',
    headRef: 'feature',
    commitCount: 2,
    additions: 10,
    deletions: 3,
    mergeBase: 'abc123',
    fileCount: 2,
};

const FILES = [
    { path: 'src/a.ts', status: 'modified', additions: 5, deletions: 2 },
    { path: 'src/b.ts', status: 'added',    additions: 5, deletions: 0 },
];

let restoreViewport: () => void;

beforeEach(() => {
    vi.clearAllMocks();
    restoreViewport = mockViewport(1280);
});

afterEach(() => {
    restoreViewport();
});

async function expandFiles() {
    const user = userEvent.setup();
    await user.click(screen.getByTestId('branch-changes-header'));
}

describe('BranchChanges — comment count badges', () => {
    it('renders a 💬{n} badge before the status char when a file has open comments', async () => {
        // src/a.ts has 2 open comments; src/b.ts has none
        mockUseFileCommentCounts.mockReturnValue(new Map([['key-src/a.ts', 2]]));

        render(
            <BranchChanges
                workspaceId="ws-test"
                branchRangeData={RANGE_INFO}
                initialFiles={FILES}
            />
        );

        await expandFiles();

        await waitFor(() => {
            const badge = screen.getByTestId('branch-file-comment-badge-src/a.ts');
            expect(badge.textContent).toContain('💬2');
        });
    });

    it('does not render a badge when the count is 0', async () => {
        mockUseFileCommentCounts.mockReturnValue(new Map()); // no counts

        render(
            <BranchChanges
                workspaceId="ws-test"
                branchRangeData={RANGE_INFO}
                initialFiles={FILES}
            />
        );

        await expandFiles();

        await waitFor(() => screen.getByTestId('branch-file-row-src/a.ts'));

        expect(screen.queryByTestId('branch-file-comment-badge-src/a.ts')).toBeNull();
        expect(screen.queryByTestId('branch-file-comment-badge-src/b.ts')).toBeNull();
    });

    it('shows correct counts for multiple files independently', async () => {
        mockUseFileCommentCounts.mockReturnValue(
            new Map([['key-src/a.ts', 3], ['key-src/b.ts', 1]])
        );

        render(
            <BranchChanges
                workspaceId="ws-test"
                branchRangeData={RANGE_INFO}
                initialFiles={FILES}
            />
        );

        await expandFiles();

        await waitFor(() => {
            expect(screen.getByTestId('branch-file-comment-badge-src/a.ts').textContent).toContain('💬3');
            expect(screen.getByTestId('branch-file-comment-badge-src/b.ts').textContent).toContain('💬1');
        });
    });

    it('badge title has correct singular/plural text', async () => {
        mockUseFileCommentCounts.mockReturnValue(new Map([['key-src/a.ts', 1]]));

        render(
            <BranchChanges
                workspaceId="ws-test"
                branchRangeData={RANGE_INFO}
                initialFiles={FILES}
            />
        );

        await expandFiles();

        await waitFor(() => {
            const badge = screen.getByTestId('branch-file-comment-badge-src/a.ts');
            expect(badge.title).toBe('1 active comment');
        });
    });

    it('badge title is plural when count > 1', async () => {
        mockUseFileCommentCounts.mockReturnValue(new Map([['key-src/a.ts', 5]]));

        render(
            <BranchChanges
                workspaceId="ws-test"
                branchRangeData={RANGE_INFO}
                initialFiles={FILES}
            />
        );

        await expandFiles();

        await waitFor(() => {
            const badge = screen.getByTestId('branch-file-comment-badge-src/a.ts');
            expect(badge.title).toBe('5 active comments');
        });
    });
});
