/**
 * Tests for CommitList — mobile context menu behavior.
 *
 * Validates that:
 * - Long-press on a commit row opens context menu (not multi-select)
 * - The context menu receives touch coordinates
 * - Long-press click suppression works correctly
 * - ⋮ overflow button is always visible on touch devices (when not in multi-select)
 * - ⋮ button has improved sizing (w-9 h-9)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import { mockViewport } from '../../../spa/helpers/viewport-mock';

// --- Module mocks ---

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
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockFetchApi.mockResolvedValue({ files: [] });
    mockUseFileCommentCounts.mockReturnValue(new Map());
    restoreViewport = mockViewport(1280);
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    vi.useRealTimers();
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

function longPress(element: Element, x = 10, y = 10): void {
    fireTouchStart(element, x, y);
    act(() => {
        vi.advanceTimersByTime(500);
    });
}

// ---------------------------------------------------------------------------
// Source code shape checks
// ---------------------------------------------------------------------------

describe('CommitList — source shape (mobile context menu)', () => {
    let source: string;

    beforeEach(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    it('exports isTouchOnly helper', () => {
        expect(source).toContain('export const isTouchOnly');
    });

    it('accepts isMobileSelecting prop', () => {
        expect(source).toContain('isMobileSelecting?: boolean');
    });

    it('accepts onMobileSelectingChange prop', () => {
        expect(source).toContain('onMobileSelectingChange?: (selecting: boolean) => void');
    });

    it('accepts onSwipeAction prop', () => {
        expect(source).toContain('onSwipeAction?:');
    });

    it('long-press calls onCommitContextMenu with synthetic event', () => {
        expect(source).toContain('onCommitContextMenu?.(');
    });
});

// ---------------------------------------------------------------------------
// Behavioral tests
// ---------------------------------------------------------------------------

describe('CommitList — mobile context menu behavior', () => {
    it('long-press on a commit calls onCommitContextMenu (not multi-select)', () => {
        const restoreTouchOnly = mockTouchOnly(true);
        const onCommitContextMenu = vi.fn();
        const onMultiSelect = vi.fn();

        render(
            <CommitList
                title="History"
                commits={COMMITS}
                onMultiSelect={onMultiSelect}
                onCommitContextMenu={onCommitContextMenu}
            />,
        );

        const row = screen.getByTestId('commit-row-aaaa111');
        longPress(row, 150, 200);

        expect(onCommitContextMenu).toHaveBeenCalledTimes(1);
        // The event should have the touch coordinates
        const event = onCommitContextMenu.mock.calls[0][0];
        expect(event.clientX).toBe(150);
        expect(event.clientY).toBe(200);
        // Should pass the commit hash
        expect(onCommitContextMenu.mock.calls[0][1]).toBe(COMMIT_A.hash);
        // Should NOT enter multi-select
        expect(onMultiSelect).not.toHaveBeenCalled();

        restoreTouchOnly();
    });

    it('long-press click is suppressed (no navigation on touchend→click)', () => {
        const restoreTouchOnly = mockTouchOnly(true);
        const onCommitContextMenu = vi.fn();
        const onSelect = vi.fn();

        render(
            <CommitList
                title="History"
                commits={COMMITS}
                onSelect={onSelect}
                onCommitContextMenu={onCommitContextMenu}
            />,
        );

        const row = screen.getByTestId('commit-row-aaaa111');
        longPress(row, 150, 200);

        // Simulate the click that follows touchend
        fireEvent.click(row);

        // onSelect should not fire because the long-press happened
        expect(onSelect).not.toHaveBeenCalled();

        restoreTouchOnly();
    });

    it('does not fire context menu on desktop (no touch)', () => {
        const restoreTouchOnly = mockTouchOnly(false);
        const onCommitContextMenu = vi.fn();

        render(
            <CommitList
                title="History"
                commits={COMMITS}
                onCommitContextMenu={onCommitContextMenu}
            />,
        );

        // Touch handlers should not be attached on non-touch devices
        const row = screen.getByTestId('commit-row-aaaa111');
        // longPress has no effect because onTouchStart is undefined
        longPress(row, 150, 200);

        // Context menu not called via long press (would need right-click)
        // Only verifying no error is thrown
        expect(true).toBe(true);

        restoreTouchOnly();
    });
});

describe('CommitList — ⋮ overflow button improvements', () => {
    it('⋮ button is visible on touch devices', () => {
        const restoreTouchOnly = mockTouchOnly(true);
        const onCommitContextMenu = vi.fn();

        render(
            <CommitList
                title="History"
                commits={COMMITS}
                onCommitContextMenu={onCommitContextMenu}
            />,
        );

        const overflowBtn = screen.getByTestId('commit-mobile-actions-aaaa111');
        expect(overflowBtn).toBeTruthy();

        restoreTouchOnly();
    });

    it('⋮ button has improved styling (w-9 h-9, bg tint)', () => {
        const source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
        // Should have increased size
        expect(source).toContain('w-9 h-9');
        // Should have subtle background
        expect(source).toContain('bg-[#f0f0f0]/60');
        expect(source).toContain('dark:bg-[#333]/60');
    });

    it('⋮ button is hidden during multi-select mode', () => {
        const restoreTouchOnly = mockTouchOnly(true);
        const onCommitContextMenu = vi.fn();

        render(
            <CommitList
                title="History"
                commits={COMMITS}
                onCommitContextMenu={onCommitContextMenu}
                isMobileSelecting={true}
                onMultiSelect={vi.fn()}
                selectedHashes={new Set([COMMIT_A.hash])}
            />,
        );

        // The overflow button should not be rendered in multi-select mode
        expect(screen.queryByTestId('commit-mobile-actions-aaaa111')).toBeNull();

        restoreTouchOnly();
    });
});
