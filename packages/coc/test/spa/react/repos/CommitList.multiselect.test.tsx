/**
 * Tests for CommitList — multi-select behaviour.
 *
 * Validates that:
 * - Ctrl+click toggles a commit into/out of the selection and calls onMultiSelect.
 * - Ctrl+Meta+click (macOS Cmd+click) also toggles selection.
 * - Shift+click selects a range from the anchor commit to the clicked commit.
 * - A reversed Shift+click range (bottom-up) is handled correctly.
 * - Plain click calls onSelect (not onMultiSelect) and doesn't fire multi-select.
 * - selectedHashes prop drives the bg-blue-50 highlight on the correct rows.
 * - Source code shape checks for new props and anchorHash state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import { mockViewport } from '../../../spa/helpers/viewport-mock';

// --- Module mocks (same pattern as CommitList.comment.test.tsx) ---

const mockFetchApi = vi.fn();
vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

const mockUseFileCommentCounts = vi.fn<[string, string | null, string | null], Map<string, number>>();
vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useFileCommentCounts', () => ({
    useFileCommentCounts: (...args: any[]) => mockUseFileCommentCounts(...args),
}));

vi.mock('../../../../src/server/spa/client/comments/diff-comment-utils', () => ({
    computeDiffCommentKey: async (_repo: string, _old: string, _new: string, filePath: string) =>
        `key-${filePath}`,
}));

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    formatRelativeTime: (d: string) => d,
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

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'commits', 'CommitList.tsx',
);

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
const COMMIT_C: GitCommitItem = {
    hash: 'cccc3333cccc3333cccc3333cccc3333cccc3333',
    shortHash: 'cccc333',
    subject: 'Refactor C',
    author: 'Carol',
    date: '2024-01-03T00:00:00Z',
    parentHashes: [],
};

const COMMITS = [COMMIT_A, COMMIT_B, COMMIT_C];

let restoreViewport: () => void;

beforeEach(() => {
    vi.clearAllMocks();
    mockFetchApi.mockResolvedValue({ files: [] });
    mockUseFileCommentCounts.mockReturnValue(new Map());
    restoreViewport = mockViewport(1280);
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    restoreViewport();
});

// ---------------------------------------------------------------------------
// Source code shape checks
// ---------------------------------------------------------------------------

describe('CommitList — source shape (multi-select)', () => {
    let source: string;

    beforeEach(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    it('accepts selectedHashes prop', () => {
        expect(source).toContain('selectedHashes?: ReadonlySet<string>');
    });

    it('accepts onMultiSelect prop', () => {
        expect(source).toContain('onMultiSelect?: (commits: GitCommitItem[]) => void');
    });

    it('tracks anchorHash state', () => {
        expect(source).toContain('anchorHash');
        expect(source).toContain('setAnchorHash');
    });

    it('derives isSelected from selectedHashes when provided', () => {
        expect(source).toContain('selectedHashes.has(commit.hash)');
    });

    it('passes mouse event to handleCommitClick', () => {
        expect(source).toContain('onClick={(e) => handleCommitClick(commit, e)');
    });

    it('checks ctrlKey or metaKey for Ctrl/Cmd toggle', () => {
        expect(source).toContain('e.ctrlKey || e.metaKey');
    });

    it('checks shiftKey for range selection', () => {
        expect(source).toContain('e.shiftKey');
    });

    it('handles Shift+Arrow keyboard range extension', () => {
        expect(source).toContain('e.shiftKey && onMultiSelect');
    });
});

// ---------------------------------------------------------------------------
// Ctrl+click — toggle individual commits
// ---------------------------------------------------------------------------

describe('CommitList — Ctrl+click multi-select', () => {
    it('adds a commit to the selection on Ctrl+click', () => {
        const onMultiSelect = vi.fn();
        const onSelect = vi.fn();

        render(
            <CommitList
                title="History"
                commits={COMMITS}
                selectedHash={COMMIT_A.hash}
                onSelect={onSelect}
                onMultiSelect={onMultiSelect}
            />,
        );

        fireEvent.click(screen.getByTestId(`commit-row-${COMMIT_B.shortHash}`), { ctrlKey: true });

        expect(onMultiSelect).toHaveBeenCalledOnce();
        const selected: GitCommitItem[] = onMultiSelect.mock.calls[0][0];
        expect(selected.map(c => c.hash)).toContain(COMMIT_A.hash);
        expect(selected.map(c => c.hash)).toContain(COMMIT_B.hash);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('also toggles on Meta+click (macOS Cmd)', () => {
        const onMultiSelect = vi.fn();

        render(
            <CommitList
                title="History"
                commits={COMMITS}
                selectedHash={COMMIT_A.hash}
                onMultiSelect={onMultiSelect}
            />,
        );

        fireEvent.click(screen.getByTestId(`commit-row-${COMMIT_B.shortHash}`), { metaKey: true });

        expect(onMultiSelect).toHaveBeenCalledOnce();
    });

    it('deselects a commit on Ctrl+click when already in the selection', () => {
        const onMultiSelect = vi.fn();

        render(
            <CommitList
                title="History"
                commits={COMMITS}
                selectedHashes={new Set([COMMIT_A.hash, COMMIT_B.hash])}
                onMultiSelect={onMultiSelect}
            />,
        );

        fireEvent.click(screen.getByTestId(`commit-row-${COMMIT_B.shortHash}`), { ctrlKey: true });

        expect(onMultiSelect).toHaveBeenCalledOnce();
        const selected: GitCommitItem[] = onMultiSelect.mock.calls[0][0];
        expect(selected.map(c => c.hash)).not.toContain(COMMIT_B.hash);
        expect(selected.map(c => c.hash)).toContain(COMMIT_A.hash);
    });
});

// ---------------------------------------------------------------------------
// Shift+click — range selection
// ---------------------------------------------------------------------------

describe('CommitList — Shift+click range selection', () => {
    it('selects A–C range on Shift+click after plain click on A', () => {
        const onMultiSelect = vi.fn();
        const onSelect = vi.fn();

        render(
            <CommitList
                title="History"
                commits={COMMITS}
                selectedHash={COMMIT_A.hash}
                onSelect={onSelect}
                onMultiSelect={onMultiSelect}
            />,
        );

        // Plain click on A sets the anchor
        fireEvent.click(screen.getByTestId(`commit-row-${COMMIT_A.shortHash}`));
        onSelect.mockClear();
        onMultiSelect.mockClear();

        // Shift+click on C should select A, B, C
        fireEvent.click(screen.getByTestId(`commit-row-${COMMIT_C.shortHash}`), { shiftKey: true });

        expect(onMultiSelect).toHaveBeenCalledOnce();
        const selected: GitCommitItem[] = onMultiSelect.mock.calls[0][0];
        expect(selected).toHaveLength(3);
        expect(selected.map(c => c.hash)).toContain(COMMIT_A.hash);
        expect(selected.map(c => c.hash)).toContain(COMMIT_B.hash);
        expect(selected.map(c => c.hash)).toContain(COMMIT_C.hash);
    });

    it('handles a reversed range (anchor below target)', () => {
        const onMultiSelect = vi.fn();
        const onSelect = vi.fn();

        render(
            <CommitList
                title="History"
                commits={COMMITS}
                selectedHash={COMMIT_C.hash}
                onSelect={onSelect}
                onMultiSelect={onMultiSelect}
            />,
        );

        // Plain click on C sets the anchor
        fireEvent.click(screen.getByTestId(`commit-row-${COMMIT_C.shortHash}`));
        onSelect.mockClear();
        onMultiSelect.mockClear();

        // Shift+click on A should still select A, B, C
        fireEvent.click(screen.getByTestId(`commit-row-${COMMIT_A.shortHash}`), { shiftKey: true });

        expect(onMultiSelect).toHaveBeenCalledOnce();
        const selected: GitCommitItem[] = onMultiSelect.mock.calls[0][0];
        expect(selected).toHaveLength(3);
    });
});

// ---------------------------------------------------------------------------
// Plain click — reverts to single-select
// ---------------------------------------------------------------------------

describe('CommitList — plain click reverts to single-select', () => {
    it('calls onSelect (not onMultiSelect) on a plain click', () => {
        const onMultiSelect = vi.fn();
        const onSelect = vi.fn();

        render(
            <CommitList
                title="History"
                commits={COMMITS}
                selectedHashes={new Set([COMMIT_A.hash, COMMIT_B.hash])}
                onSelect={onSelect}
                onMultiSelect={onMultiSelect}
            />,
        );

        fireEvent.click(screen.getByTestId(`commit-row-${COMMIT_C.shortHash}`));

        expect(onSelect).toHaveBeenCalledWith(COMMIT_C);
        expect(onMultiSelect).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// selectedHashes drives row highlighting
// ---------------------------------------------------------------------------

describe('CommitList — selectedHashes drives highlighting', () => {
    it('highlights rows whose hashes are in selectedHashes', () => {
        render(
            <CommitList
                title="History"
                commits={COMMITS}
                selectedHashes={new Set([COMMIT_A.hash, COMMIT_C.hash])}
            />,
        );

        const rowA = screen.getByTestId(`commit-row-${COMMIT_A.shortHash}`);
        const rowB = screen.getByTestId(`commit-row-${COMMIT_B.shortHash}`);
        const rowC = screen.getByTestId(`commit-row-${COMMIT_C.shortHash}`);

        expect(rowA.className).toContain('bg-blue-50');
        expect(rowB.className).not.toContain('bg-blue-50');
        expect(rowC.className).toContain('bg-blue-50');
    });

    it('falls back to selectedHash highlighting when selectedHashes is absent', () => {
        render(
            <CommitList
                title="History"
                commits={COMMITS}
                selectedHash={COMMIT_B.hash}
            />,
        );

        const rowA = screen.getByTestId(`commit-row-${COMMIT_A.shortHash}`);
        const rowB = screen.getByTestId(`commit-row-${COMMIT_B.shortHash}`);

        expect(rowA.className).not.toContain('bg-blue-50');
        expect(rowB.className).toContain('bg-blue-50');
    });
});
