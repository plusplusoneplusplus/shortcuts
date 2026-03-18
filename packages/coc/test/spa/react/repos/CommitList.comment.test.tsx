/**
 * Tests for CommitList — active comment count badge rendering in the expanded file list.
 *
 * Validates that:
 * - A 💬{n} badge is rendered before the status char when a file has open comments.
 * - The badge is absent when the count is 0.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockViewport } from '../../../spa/helpers/viewport-mock';

// --- Module mocks ---

vi.mock('../../../../src/server/spa/client/diff-comment-utils', () => ({
    computeDiffCommentKey: async (_repo: string, _old: string, _new: string, filePath: string) =>
        `key-${filePath}`,
}));

const mockUseFileCommentCounts = vi.fn<[string, string | null, string | null], Map<string, number>>();
vi.mock('../../../../src/server/spa/client/react/hooks/useFileCommentCounts', () => ({
    useFileCommentCounts: (...args: any[]) => mockUseFileCommentCounts(...args),
}));

const mockFetchApi = vi.fn();
vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    formatRelativeTime: (d: string) => d,
}));

vi.mock('../../../../src/server/spa/client/react/repos/CommitTooltip', () => ({
    CommitTooltip: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/shared', () => ({
    TruncatedPath: ({ path }: { path: string }) => <span>{path}</span>,
}));

import { CommitList } from '../../../../src/server/spa/client/react/repos/CommitList';
import type { GitCommitItem } from '../../../../src/server/spa/client/react/repos/CommitList';

const COMMIT_A: GitCommitItem = {
    hash: 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111',
    shortHash: 'aaaa111',
    subject: 'Add feature',
    author: 'Alice',
    date: '2024-01-01T00:00:00Z',
    parentHashes: [],
};

const MOCK_FILES = [
    { status: 'M', path: 'src/foo.ts' },
    { status: 'A', path: 'src/bar.ts' },
];

let restoreViewport: () => void;

beforeEach(() => {
    vi.clearAllMocks();
    mockFetchApi.mockResolvedValue({ files: MOCK_FILES });
    restoreViewport = mockViewport(1280);
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    restoreViewport();
});

describe('CommitList — comment count badges', () => {
    it('renders a 💬{n} badge before the status char when a file has open comments', async () => {
        mockUseFileCommentCounts.mockReturnValue(new Map([['key-src/foo.ts', 2]]));

        render(
            <CommitList
                title="History"
                commits={[COMMIT_A]}
                workspaceId="ws-test"
                initialExpandedHash={COMMIT_A.hash}
            />
        );

        await waitFor(() => {
            expect(screen.getByTestId(`commit-files-${COMMIT_A.shortHash}`)).toBeTruthy();
        });

        await waitFor(() => {
            const badge = screen.getByTestId('commit-file-comment-badge-0');
            expect(badge.textContent).toContain('💬2');
        });
    });

    it('does not render a badge when no comments exist', async () => {
        mockUseFileCommentCounts.mockReturnValue(new Map()); // empty counts

        render(
            <CommitList
                title="History"
                commits={[COMMIT_A]}
                workspaceId="ws-test"
                initialExpandedHash={COMMIT_A.hash}
            />
        );

        await waitFor(() => {
            expect(screen.getByTestId(`commit-files-${COMMIT_A.shortHash}`)).toBeTruthy();
        });

        await waitFor(() => screen.getByTestId('commit-file-0'));
        expect(screen.queryByTestId('commit-file-comment-badge-0')).toBeNull();
        expect(screen.queryByTestId('commit-file-comment-badge-1')).toBeNull();
    });

    it('shows correct counts for multiple files in the expanded commit', async () => {
        mockUseFileCommentCounts.mockReturnValue(
            new Map([['key-src/foo.ts', 3], ['key-src/bar.ts', 1]])
        );

        render(
            <CommitList
                title="History"
                commits={[COMMIT_A]}
                workspaceId="ws-test"
                initialExpandedHash={COMMIT_A.hash}
            />
        );

        await waitFor(() => {
            expect(screen.getByTestId(`commit-files-${COMMIT_A.shortHash}`)).toBeTruthy();
        });

        await waitFor(() => {
            expect(screen.getByTestId('commit-file-comment-badge-0').textContent).toContain('💬3');
            expect(screen.getByTestId('commit-file-comment-badge-1').textContent).toContain('💬1');
        });
    });

    it('clears badges when the expanded commit changes', async () => {
        const COMMIT_B: GitCommitItem = {
            hash: 'bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222',
            shortHash: 'bbbb222',
            subject: 'Fix bug',
            author: 'Bob',
            date: '2024-01-02T00:00:00Z',
            parentHashes: [],
        };

        // Use stable pre-created Map references to avoid infinite useEffect loops
        const countsForA = new Map([['key-src/foo.ts', 2]]);
        const emptyMap = new Map<string, number>();

        mockUseFileCommentCounts.mockImplementation((_wsId, _oldRef, newRef) => {
            if (newRef === COMMIT_A.hash) return countsForA;
            return emptyMap;
        });

        const user = userEvent.setup();

        render(
            <CommitList
                title="History"
                commits={[COMMIT_A, COMMIT_B]}
                workspaceId="ws-test"
                initialExpandedHash={COMMIT_A.hash}
            />
        );

        await waitFor(() => screen.getByTestId('commit-file-comment-badge-0'));

        // Collapse COMMIT_A and expand COMMIT_B
        await act(async () => {
            await user.click(screen.getByTestId(`commit-row-${COMMIT_A.shortHash}`));
        });
        await act(async () => {
            await user.click(screen.getByTestId(`commit-row-${COMMIT_B.shortHash}`));
        });

        await waitFor(() => {
            expect(screen.getByTestId(`commit-files-${COMMIT_B.shortHash}`)).toBeTruthy();
        });

        // Badge from COMMIT_A's file should no longer be visible
        expect(screen.queryByTestId('commit-file-comment-badge-0')).toBeNull();
    });
});
