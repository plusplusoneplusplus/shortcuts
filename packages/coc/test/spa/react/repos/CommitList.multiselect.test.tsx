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

import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
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

function makeMediaQueryList(query: string, matches: boolean): MediaQueryList {
    return {
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
    };
}

function mockTouchOnly(touchOnly: boolean): () => void {
    const original = window.matchMedia;
    window.matchMedia = (query: string): MediaQueryList => {
        if (query.includes('hover: none')) {
            return makeMediaQueryList(query, touchOnly);
        }
        if (query.includes('prefers-color-scheme')) {
            return makeMediaQueryList(query, false);
        }
        return original(query);
    };
    return () => {
        window.matchMedia = original;
    };
}

function fireTouchStart(element: Element, x = 10, y = 10): void {
    fireEvent.touchStart(element, { touches: [{ clientX: x, clientY: y }] });
}

function fireTouchMove(element: Element, x = 30, y = 10): void {
    fireEvent.touchMove(element, { touches: [{ clientX: x, clientY: y }] });
}

function longPress(element: Element): void {
    fireTouchStart(element);
    act(() => {
        vi.advanceTimersByTime(500);
    });
}

interface ControlledCommitListProps {
    onMultiSelect?: (commits: GitCommitItem[]) => void;
    onSelect?: (commit: GitCommitItem) => void;
    onCommitContextMenu?: (e: React.MouseEvent, commitHash: string) => void;
}

function ControlledCommitList({ onMultiSelect, onSelect, onCommitContextMenu }: ControlledCommitListProps) {
    const [selected, setSelected] = useState<GitCommitItem[]>([]);
    const [isMobileSelecting, setIsMobileSelecting] = useState(false);
    return (
        <CommitList
            title="History"
            commits={COMMITS}
            selectedHashes={new Set(selected.map(c => c.hash))}
            onSelect={onSelect}
            onMultiSelect={(next) => {
                setSelected(next);
                onMultiSelect?.(next);
            }}
            onCommitContextMenu={onCommitContextMenu}
            isMobileSelecting={isMobileSelecting}
            onMobileSelectingChange={setIsMobileSelecting}
        />
    );
}

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

// ---------------------------------------------------------------------------
// Mobile touch multi-select
// ---------------------------------------------------------------------------

describe('CommitList — mobile touch multi-select', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('long-press opens context menu instead of entering multi-select mode', () => {
        const restoreTouch = mockTouchOnly(true);
        const onMultiSelect = vi.fn();
        const onCommitContextMenu = vi.fn();
        try {
            render(<ControlledCommitList onMultiSelect={onMultiSelect} onCommitContextMenu={onCommitContextMenu} />);

            longPress(screen.getByTestId(`commit-row-${COMMIT_A.shortHash}`));

            // Long-press now opens context menu
            expect(onCommitContextMenu).toHaveBeenCalledOnce();
            expect(onCommitContextMenu.mock.calls[0][1]).toBe(COMMIT_A.hash);
            // Should NOT enter multi-select
            expect(onMultiSelect).not.toHaveBeenCalled();
            expect(screen.queryByTestId('commit-mobile-selection-bar')).toBeNull();
        } finally {
            restoreTouch();
        }
    });

    it('toggles additional commits while in multi-select mode (entered externally)', () => {
        const restoreTouch = mockTouchOnly(true);
        const onMultiSelect = vi.fn();
        const onSelect = vi.fn();
        try {
            // Render with isMobileSelecting already true (entered via "Select" menu item)
            const { rerender } = render(
                <CommitList
                    title="History"
                    commits={COMMITS}
                    selectedHashes={new Set([COMMIT_A.hash])}
                    onSelect={onSelect}
                    onMultiSelect={onMultiSelect}
                    isMobileSelecting={true}
                    onMobileSelectingChange={vi.fn()}
                />,
            );

            // Click on B should toggle it into selection
            fireEvent.click(screen.getByTestId(`commit-row-${COMMIT_B.shortHash}`));

            expect(onMultiSelect).toHaveBeenCalled();
            const selected: GitCommitItem[] = onMultiSelect.mock.calls.at(-1)![0];
            expect(selected.map(c => c.hash)).toEqual([COMMIT_A.hash, COMMIT_B.hash]);
            expect(onSelect).not.toHaveBeenCalled();
        } finally {
            restoreTouch();
        }
    });

    it('opens the context menu from the selection bar for the selected commits', () => {
        const restoreTouch = mockTouchOnly(true);
        const onCommitContextMenu = vi.fn();
        try {
            render(
                <CommitList
                    title="History"
                    commits={COMMITS}
                    selectedHashes={new Set([COMMIT_A.hash, COMMIT_B.hash])}
                    onMultiSelect={vi.fn()}
                    onCommitContextMenu={onCommitContextMenu}
                    isMobileSelecting={true}
                    onMobileSelectingChange={vi.fn()}
                />,
            );

            fireEvent.click(screen.getByTestId('commit-mobile-selection-actions'));

            expect(onCommitContextMenu).toHaveBeenCalledOnce();
            expect(onCommitContextMenu.mock.calls[0][1]).toBe(COMMIT_A.hash);
        } finally {
            restoreTouch();
        }
    });

    it('clears mobile selection from the cancel button', () => {
        const restoreTouch = mockTouchOnly(true);
        const onMultiSelect = vi.fn();
        const onMobileSelectingChange = vi.fn();
        try {
            render(
                <CommitList
                    title="History"
                    commits={COMMITS}
                    selectedHashes={new Set([COMMIT_A.hash])}
                    onMultiSelect={onMultiSelect}
                    isMobileSelecting={true}
                    onMobileSelectingChange={onMobileSelectingChange}
                />,
            );

            fireEvent.click(screen.getByTestId('commit-mobile-selection-cancel'));

            expect(onMobileSelectingChange).toHaveBeenCalledWith(false);
            expect(onMultiSelect.mock.calls.at(-1)![0]).toEqual([]);
        } finally {
            restoreTouch();
        }
    });

    it('does not fire context menu when the touch moves like a scroll', () => {
        const restoreTouch = mockTouchOnly(true);
        const onCommitContextMenu = vi.fn();
        try {
            render(<ControlledCommitList onCommitContextMenu={onCommitContextMenu} />);
            const row = screen.getByTestId(`commit-row-${COMMIT_A.shortHash}`);

            fireTouchStart(row, 10, 10);
            fireTouchMove(row, 25, 10);
            act(() => {
                vi.advanceTimersByTime(500);
            });

            expect(onCommitContextMenu).not.toHaveBeenCalled();
        } finally {
            restoreTouch();
        }
    });

    it('opens a single-commit context menu from the touch-only row overflow button', () => {
        const restoreTouch = mockTouchOnly(true);
        const onCommitContextMenu = vi.fn();
        try {
            render(<ControlledCommitList onCommitContextMenu={onCommitContextMenu} />);
            const button = screen.getByTestId(`commit-mobile-actions-${COMMIT_A.shortHash}`);

            fireEvent.touchStart(button, { touches: [{ clientX: 20, clientY: 20 }] });
            fireEvent.touchEnd(button);

            expect(onCommitContextMenu).toHaveBeenCalledOnce();
            expect(onCommitContextMenu.mock.calls[0][1]).toBe(COMMIT_A.hash);
        } finally {
            restoreTouch();
        }
    });

    it('does not render row overflow actions on non-touch viewports', () => {
        const restoreTouch = mockTouchOnly(false);
        try {
            render(<ControlledCommitList onCommitContextMenu={vi.fn()} />);

            expect(screen.queryByTestId(`commit-mobile-actions-${COMMIT_A.shortHash}`)).toBeNull();
        } finally {
            restoreTouch();
        }
    });
});
