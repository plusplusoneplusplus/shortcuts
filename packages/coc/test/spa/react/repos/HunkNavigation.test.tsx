/**
 * Tests for hunk navigation: HunkNavButtons, data-hunk-header attribute,
 * and UnifiedDiffViewerHandle (scrollToNextHunk/scrollToPrevHunk/getHunkCount).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React, { createRef } from 'react';
import {
    UnifiedDiffViewer,
    HunkNavButtons,
} from '../../../../src/server/spa/client/react/repos/UnifiedDiffViewer';
import type { UnifiedDiffViewerHandle } from '../../../../src/server/spa/client/react/repos/UnifiedDiffViewer';

const MULTI_HUNK_DIFF = `diff --git a/foo.ts b/foo.ts
index 0000000..1111111 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,3 @@
-old line 1
+new line 1
 context
@@ -10,3 +10,3 @@
-old line 10
+new line 10
 context2
@@ -20,2 +20,2 @@
-old line 20
+new line 20`;

const SINGLE_HUNK_DIFF = `@@ -1,2 +1,2 @@
-old
+new`;

const NO_HUNK_DIFF = `diff --git a/foo.ts b/foo.ts
index 0000000..1111111 100644`;

// ============================================================================
// HunkNavButtons
// ============================================================================

describe('HunkNavButtons', () => {
    it('renders prev and next buttons', () => {
        render(<HunkNavButtons onPrev={() => {}} onNext={() => {}} />);
        expect(screen.getByTestId('prev-hunk-btn')).toBeTruthy();
        expect(screen.getByTestId('next-hunk-btn')).toBeTruthy();
    });

    it('prev button displays ▲', () => {
        render(<HunkNavButtons onPrev={() => {}} onNext={() => {}} />);
        expect(screen.getByTestId('prev-hunk-btn').textContent).toBe('▲');
    });

    it('next button displays ▼', () => {
        render(<HunkNavButtons onPrev={() => {}} onNext={() => {}} />);
        expect(screen.getByTestId('next-hunk-btn').textContent).toBe('▼');
    });

    it('calls onPrev when prev button clicked', async () => {
        const onPrev = vi.fn();
        render(<HunkNavButtons onPrev={onPrev} onNext={() => {}} />);
        await act(async () => {
            fireEvent.click(screen.getByTestId('prev-hunk-btn'));
        });
        expect(onPrev).toHaveBeenCalledOnce();
    });

    it('calls onNext when next button clicked', async () => {
        const onNext = vi.fn();
        render(<HunkNavButtons onPrev={() => {}} onNext={onNext} />);
        await act(async () => {
            fireEvent.click(screen.getByTestId('next-hunk-btn'));
        });
        expect(onNext).toHaveBeenCalledOnce();
    });

    it('has correct titles for accessibility', () => {
        render(<HunkNavButtons onPrev={() => {}} onNext={() => {}} />);
        expect(screen.getByTestId('prev-hunk-btn').getAttribute('title')).toBe('Previous change');
        expect(screen.getByTestId('next-hunk-btn').getAttribute('title')).toBe('Next change');
    });
});

// ============================================================================
// data-hunk-header attribute
// ============================================================================

describe('UnifiedDiffViewer — data-hunk-header attribute', () => {
    it('marks hunk-header lines with data-hunk-header attribute', () => {
        const { container } = render(
            <UnifiedDiffViewer diff={MULTI_HUNK_DIFF} data-testid="diff" />
        );
        const hunkHeaders = container.querySelectorAll('[data-hunk-header]');
        expect(hunkHeaders.length).toBe(3);
    });

    it('data-hunk-header is present even without enableComments', () => {
        const { container } = render(
            <UnifiedDiffViewer diff={SINGLE_HUNK_DIFF} data-testid="diff" />
        );
        const hunkHeaders = container.querySelectorAll('[data-hunk-header]');
        expect(hunkHeaders.length).toBe(1);
    });

    it('no data-hunk-header on non-hunk lines', () => {
        const { container } = render(
            <UnifiedDiffViewer diff={NO_HUNK_DIFF} data-testid="diff" />
        );
        const hunkHeaders = container.querySelectorAll('[data-hunk-header]');
        expect(hunkHeaders.length).toBe(0);
    });
});

// ============================================================================
// UnifiedDiffViewerHandle (via ref)
// ============================================================================

describe('UnifiedDiffViewerHandle', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('getHunkCount returns the number of hunks', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        render(<UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="diff" />);
        expect(ref.current?.getHunkCount()).toBe(3);
    });

    it('getHunkCount returns 0 for no-hunk diff', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        render(<UnifiedDiffViewer ref={ref} diff={NO_HUNK_DIFF} data-testid="diff" />);
        expect(ref.current?.getHunkCount()).toBe(0);
    });

    it('scrollToNextHunk calls scrollIntoView on a hunk element', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(
            <UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="diff" />
        );
        const hunkHeaders = container.querySelectorAll<HTMLElement>('[data-hunk-header]');
        // jsdom doesn't have scrollIntoView; define it before spying
        hunkHeaders.forEach(el => { el.scrollIntoView = vi.fn(); });
        ref.current?.scrollToNextHunk();
        const called = Array.from(hunkHeaders).some(el => (el.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length > 0);
        expect(called).toBe(true);
    });

    it('scrollToPrevHunk calls scrollIntoView on a hunk element', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        const { container } = render(
            <UnifiedDiffViewer ref={ref} diff={MULTI_HUNK_DIFF} data-testid="diff" />
        );
        const hunkHeaders = container.querySelectorAll<HTMLElement>('[data-hunk-header]');
        hunkHeaders.forEach(el => { el.scrollIntoView = vi.fn(); });
        ref.current?.scrollToPrevHunk();
        const called = Array.from(hunkHeaders).some(el => (el.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length > 0);
        expect(called).toBe(true);
    });

    it('scrollToNextHunk is a no-op when diff has no hunks', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        render(<UnifiedDiffViewer ref={ref} diff={NO_HUNK_DIFF} data-testid="diff" />);
        // Should not throw
        expect(() => ref.current?.scrollToNextHunk()).not.toThrow();
    });

    it('scrollToPrevHunk is a no-op when diff has no hunks', () => {
        const ref = createRef<UnifiedDiffViewerHandle>();
        render(<UnifiedDiffViewer ref={ref} diff={NO_HUNK_DIFF} data-testid="diff" />);
        expect(() => ref.current?.scrollToPrevHunk()).not.toThrow();
    });
});

// ============================================================================
// CommitFileContent — nav buttons presence
// ============================================================================

import { CommitFileContent } from '../../../../src/server/spa/client/react/repos/CommitFileContent';

const mockFetchApi = vi.fn();
vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: unknown[]) => mockFetchApi(...args),
}));

describe('CommitFileContent — hunk navigation buttons', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('renders prev and next hunk buttons in the header', async () => {
        mockFetchApi.mockResolvedValue({
            diff: '@@ -1,2 +1,2 @@\n-old\n+new',
        });

        render(<CommitFileContent workspaceId="ws-1" hash="abc" filePath="src/app.ts" />);

        // Wait for diff to load
        await screen.findByTestId('commit-file-diff-content');

        expect(screen.getByTestId('prev-hunk-btn')).toBeTruthy();
        expect(screen.getByTestId('next-hunk-btn')).toBeTruthy();
    });
});
