/**
 * Tests for CommitList — deep-link auto-expansion behaviour.
 *
 * Validates that:
 * - When `initialExpandedHash` is provided the matching commit is expanded and
 *   files are fetched on mount (deep-link scenario).
 * - When `initialExpandedHash` is absent / null, no commit is auto-expanded.
 * - Manual click-to-expand still works after auto-expansion.
 * - Auto-expansion fires only once even if the prop value stays the same across
 *   re-renders.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockViewport } from '../../../spa/helpers/viewport-mock';

// --- Module mocks ---

const mockFetchApi = vi.fn();
vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        git: {
            getDiffCommentTotals: () => Promise.resolve({ totals: {} }),
            getDiffCommentCounts: () => Promise.resolve({ counts: {} }),
            listCommitFiles: (workspaceId: string, hash: string) =>
                mockFetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${hash}/files`),
        },
    }),
}));

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    formatRelativeTime: (d: string) => d,
    copyToClipboard: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitTooltip', () => ({
    CommitTooltip: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/ui', () => ({
    TruncatedPath: ({ path }: { path: string }) => <span>{path}</span>,
}));

// --- Fixtures ---

import { CommitList } from '../../../../src/server/spa/client/react/features/git/commits/CommitList';
import type { GitCommitItem } from '../../../../src/server/spa/client/react/features/git/commits/CommitList';

const COMMIT_A: GitCommitItem = {
    hash: 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111',
    shortHash: 'aaaa111',
    subject: 'Fix bug A',
    author: 'Alice',
    date: '2024-01-01T00:00:00Z',
    parentHashes: [],
};

const COMMIT_B: GitCommitItem = {
    hash: 'bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222',
    shortHash: 'bbbb222',
    subject: 'Add feature B',
    author: 'Bob',
    date: '2024-01-02T00:00:00Z',
    parentHashes: [],
};

const MOCK_FILES = [{ status: 'M', path: 'src/foo.ts' }, { status: 'A', path: 'src/bar.ts' }];

let restoreViewport: () => void;

beforeEach(() => {
    vi.clearAllMocks();
    mockFetchApi.mockResolvedValue({ files: MOCK_FILES });
    restoreViewport = mockViewport(1280);
    // jsdom doesn't implement scrollIntoView
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    restoreViewport();
});

describe('CommitList — deep-link auto-expansion', () => {
    it('auto-expands the commit and fetches its files when initialExpandedHash is provided', async () => {
        render(
            <CommitList
                title="History"
                commits={[COMMIT_A, COMMIT_B]}
                selectedHash={COMMIT_A.hash}
                initialExpandedHash={COMMIT_A.hash}
                workspaceId="ws-test"
            />
        );

        // File list should appear after the API resolves
        await waitFor(() => {
            expect(screen.getByTestId(`commit-files-${COMMIT_A.shortHash}`)).toBeTruthy();
        });

        // Files should be visible (tree view shows basenames + folder)
        expect(screen.getByTestId('file-tree-dir-src')).toBeTruthy();
        expect(screen.getByTestId('commit-file-src/foo.ts')).toBeTruthy();
        expect(screen.getByTestId('commit-file-src/bar.ts')).toBeTruthy();

        // API should have been called with the correct URL
        expect(mockFetchApi).toHaveBeenCalledWith(
            `/workspaces/${encodeURIComponent('ws-test')}/git/commits/${COMMIT_A.hash}/files`
        );
    });

    it('does not auto-expand when initialExpandedHash is not provided', async () => {
        render(
            <CommitList
                title="History"
                commits={[COMMIT_A, COMMIT_B]}
                workspaceId="ws-test"
            />
        );

        // No file-list panel should be rendered for any commit
        expect(screen.queryByTestId(`commit-files-${COMMIT_A.shortHash}`)).toBeNull();
        expect(screen.queryByTestId(`commit-files-${COMMIT_B.shortHash}`)).toBeNull();
        expect(mockFetchApi).not.toHaveBeenCalled();
    });

    it('does not auto-expand when initialExpandedHash is null', async () => {
        render(
            <CommitList
                title="History"
                commits={[COMMIT_A, COMMIT_B]}
                initialExpandedHash={null}
                workspaceId="ws-test"
            />
        );

        expect(screen.queryByTestId(`commit-files-${COMMIT_A.shortHash}`)).toBeNull();
        expect(mockFetchApi).not.toHaveBeenCalled();
    });

    it('auto-expands only once even if the component re-renders with the same initialExpandedHash', async () => {
        const { rerender } = render(
            <CommitList
                title="History"
                commits={[COMMIT_A, COMMIT_B]}
                selectedHash={COMMIT_A.hash}
                initialExpandedHash={COMMIT_A.hash}
                workspaceId="ws-test"
            />
        );

        await waitFor(() => {
            expect(screen.getByTestId(`commit-files-${COMMIT_A.shortHash}`)).toBeTruthy();
        });

        // Re-render with same props
        rerender(
            <CommitList
                title="History"
                commits={[COMMIT_A, COMMIT_B]}
                selectedHash={COMMIT_A.hash}
                initialExpandedHash={COMMIT_A.hash}
                workspaceId="ws-test"
            />
        );

        // fetchApi should have been called exactly once (from the first render)
        expect(mockFetchApi).toHaveBeenCalledTimes(1);
    });

    it('manual click-to-expand still works for a commit that was not auto-expanded', async () => {
        const user = userEvent.setup();

        render(
            <CommitList
                title="History"
                commits={[COMMIT_A, COMMIT_B]}
                selectedHash={COMMIT_A.hash}
                initialExpandedHash={COMMIT_A.hash}
                workspaceId="ws-test"
            />
        );

        // Wait for COMMIT_A to auto-expand
        await waitFor(() => {
            expect(screen.getByTestId(`commit-files-${COMMIT_A.shortHash}`)).toBeTruthy();
        });

        // Click COMMIT_B to expand it
        await act(async () => {
            await user.click(screen.getByTestId(`commit-row-${COMMIT_B.shortHash}`));
        });

        await waitFor(() => {
            expect(screen.getByTestId(`commit-files-${COMMIT_B.shortHash}`)).toBeTruthy();
        });
    });

    it('shows the loading indicator while files are being fetched', async () => {
        let resolve!: (v: any) => void;
        mockFetchApi.mockReturnValueOnce(new Promise(r => { resolve = r; }));

        render(
            <CommitList
                title="History"
                commits={[COMMIT_A]}
                selectedHash={COMMIT_A.hash}
                initialExpandedHash={COMMIT_A.hash}
                workspaceId="ws-test"
            />
        );

        // Loading indicator should be visible before the promise resolves
        expect(screen.getByTestId('commit-files-loading')).toBeTruthy();

        // Resolve and confirm loading indicator disappears
        await act(async () => { resolve({ files: MOCK_FILES }); });
        await waitFor(() => {
            expect(screen.queryByTestId('commit-files-loading')).toBeNull();
        });
    });
});


describe('CommitList — deep-link auto-expansion', () => {
    it('auto-expands the commit and fetches its files when initialExpandedHash is provided', async () => {
        render(
            <CommitList
                title="History"
                commits={[COMMIT_A, COMMIT_B]}
                selectedHash={COMMIT_A.hash}
                initialExpandedHash={COMMIT_A.hash}
                workspaceId="ws-test"
            />
        );

        // File list should appear after the API resolves
        await waitFor(() => {
            expect(screen.getByTestId(`commit-files-${COMMIT_A.shortHash}`)).toBeTruthy();
        });

        // Files should be visible (tree view shows basenames + folder)
        expect(screen.getByTestId('file-tree-dir-src')).toBeTruthy();
        expect(screen.getByTestId('commit-file-src/foo.ts')).toBeTruthy();
        expect(screen.getByTestId('commit-file-src/bar.ts')).toBeTruthy();

        // API should have been called with the correct URL
        expect(mockFetchApi).toHaveBeenCalledWith(
            `/workspaces/${encodeURIComponent('ws-test')}/git/commits/${COMMIT_A.hash}/files`
        );
    });

    it('does not auto-expand when initialExpandedHash is not provided', async () => {
        render(
            <CommitList
                title="History"
                commits={[COMMIT_A, COMMIT_B]}
                workspaceId="ws-test"
            />
        );

        // No file-list panel should be rendered for any commit
        expect(screen.queryByTestId(`commit-files-${COMMIT_A.shortHash}`)).toBeNull();
        expect(screen.queryByTestId(`commit-files-${COMMIT_B.shortHash}`)).toBeNull();
        expect(mockFetchApi).not.toHaveBeenCalled();
    });

    it('does not auto-expand when initialExpandedHash is null', async () => {
        render(
            <CommitList
                title="History"
                commits={[COMMIT_A, COMMIT_B]}
                initialExpandedHash={null}
                workspaceId="ws-test"
            />
        );

        expect(screen.queryByTestId(`commit-files-${COMMIT_A.shortHash}`)).toBeNull();
        expect(mockFetchApi).not.toHaveBeenCalled();
    });

    it('auto-expands only once even if the component re-renders with the same initialExpandedHash', async () => {
        const { rerender } = render(
            <CommitList
                title="History"
                commits={[COMMIT_A, COMMIT_B]}
                selectedHash={COMMIT_A.hash}
                initialExpandedHash={COMMIT_A.hash}
                workspaceId="ws-test"
            />
        );

        await waitFor(() => {
            expect(screen.getByTestId(`commit-files-${COMMIT_A.shortHash}`)).toBeTruthy();
        });

        // Re-render with same props
        rerender(
            <CommitList
                title="History"
                commits={[COMMIT_A, COMMIT_B]}
                selectedHash={COMMIT_A.hash}
                initialExpandedHash={COMMIT_A.hash}
                workspaceId="ws-test"
            />
        );

        // fetchApi should have been called exactly once (from the first render)
        expect(mockFetchApi).toHaveBeenCalledTimes(1);
    });

    it('manual click-to-expand still works for a commit that was not auto-expanded', async () => {
        const user = userEvent.setup();

        render(
            <CommitList
                title="History"
                commits={[COMMIT_A, COMMIT_B]}
                selectedHash={COMMIT_A.hash}
                initialExpandedHash={COMMIT_A.hash}
                workspaceId="ws-test"
            />
        );

        // Wait for COMMIT_A to auto-expand
        await waitFor(() => {
            expect(screen.getByTestId(`commit-files-${COMMIT_A.shortHash}`)).toBeTruthy();
        });

        // Click COMMIT_B to expand it
        await act(async () => {
            await user.click(screen.getByTestId(`commit-row-${COMMIT_B.shortHash}`));
        });

        await waitFor(() => {
            expect(screen.getByTestId(`commit-files-${COMMIT_B.shortHash}`)).toBeTruthy();
        });
    });

    it('shows the loading indicator while files are being fetched', async () => {
        let resolve!: (v: any) => void;
        mockFetchApi.mockReturnValueOnce(new Promise(r => { resolve = r; }));

        render(
            <CommitList
                title="History"
                commits={[COMMIT_A]}
                selectedHash={COMMIT_A.hash}
                initialExpandedHash={COMMIT_A.hash}
                workspaceId="ws-test"
            />
        );

        // Loading indicator should be visible before the promise resolves
        expect(screen.getByTestId('commit-files-loading')).toBeTruthy();

        // Resolve and confirm loading indicator disappears
        await act(async () => { resolve({ files: MOCK_FILES }); });
        await waitFor(() => {
            expect(screen.queryByTestId('commit-files-loading')).toBeNull();
        });
    });
});
