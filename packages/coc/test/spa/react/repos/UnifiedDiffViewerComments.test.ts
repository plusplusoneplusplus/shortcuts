/**
 * Component tests for UnifiedDiffViewer with comments enabled.
 *
 * Tests highlight classes, gutter badges, and rendering behavior when the
 * `comments` prop is provided, using `enableComments` to opt in.
 */

// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { UnifiedDiffViewer } from '../../../../src/server/spa/client/react/repos/UnifiedDiffViewer';
import type { DiffComment } from '../../../../src/server/spa/client/diff-comment-types';

// ============================================================================
// Fixtures
// ============================================================================

// Line indices for SIMPLE_DIFF:
//  0: diff --git ...  (meta)
//  1: index ...       (meta)
//  2: --- a/foo.ts   (meta)
//  3: +++ b/foo.ts   (meta)
//  4: @@ -1,3 +1,4 @@ (hunk-header)
//  5:  context        (context)
//  6: +added line     (added)
//  7: -removed line   (removed)
//  8:  context2       (context)
const DIFF = [
    'diff --git a/foo.ts b/foo.ts',
    'index 0000000..1111111 100644',
    '--- a/foo.ts',
    '+++ b/foo.ts',
    '@@ -1,3 +1,4 @@',
    ' context',
    '+added line',
    '-removed line',
    ' context2',
].join('\n');

function makeComment(overrides: {
    id?: string;
    diffLineStart: number;
    diffLineEnd: number;
    status?: DiffComment['status'];
}): DiffComment {
    return {
        id: overrides.id ?? 'c1',
        context: { repositoryId: 'repo', filePath: 'foo.ts', oldRef: 'HEAD~1', newRef: 'HEAD' },
        selection: {
            diffLineStart: overrides.diffLineStart,
            diffLineEnd: overrides.diffLineEnd,
            side: 'context',
            startColumn: 0,
            endColumn: 5,
        },
        selectedText: 'selected',
        comment: 'A comment body',
        status: overrides.status ?? 'open',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

const h = React.createElement;

// ============================================================================
// No comments / disabled
// ============================================================================

describe('UnifiedDiffViewer — no highlights when comments absent', () => {
    it('renders no comment badges when comments prop is empty', () => {
        const { container } = render(h(UnifiedDiffViewer, { diff: DIFF, enableComments: true, comments: [] }));
        expect(container.querySelectorAll('[data-testid="comment-badge"]')).toHaveLength(0);
    });

    it('renders no highlight classes when comments prop is empty', () => {
        const { container } = render(h(UnifiedDiffViewer, { diff: DIFF, enableComments: true, comments: [] }));
        // No comment-specific highlight classes (fff9c4=open yellow, opacity-80=resolved)
        const allDivs = container.querySelectorAll('[data-diff-line-index]');
        allDivs.forEach(div => {
            expect(div.className).not.toContain('fff9c4');
            expect(div.className).not.toContain('opacity-80');
        });
    });
});

// ============================================================================
// Open comment highlights
// ============================================================================

describe('UnifiedDiffViewer — open comment highlights', () => {
    it('renders yellow highlight class on the commented line (open status)', () => {
        const c = makeComment({ diffLineStart: 6, diffLineEnd: 6, status: 'open' });
        const { container } = render(h(UnifiedDiffViewer, { diff: DIFF, enableComments: true, comments: [c] }));
        const lineDiv = container.querySelector<HTMLElement>('[data-diff-line-index="6"]')!;
        expect(lineDiv).not.toBeNull();
        expect(lineDiv.className).toContain('fff9c4');
    });

    it('renders a gutter badge on the commented line', () => {
        const c = makeComment({ diffLineStart: 6, diffLineEnd: 6 });
        const { container } = render(h(UnifiedDiffViewer, { diff: DIFF, enableComments: true, comments: [c] }));
        const badge = container.querySelector('[data-diff-line-index="6"] [data-testid="comment-badge"]');
        expect(badge).not.toBeNull();
        expect(badge!.textContent).toBe('1');
    });

    it('badge text shows correct count for multiple comments on one line', () => {
        const c1 = makeComment({ id: 'c1', diffLineStart: 5, diffLineEnd: 7 });
        const c2 = makeComment({ id: 'c2', diffLineStart: 6, diffLineEnd: 6 });
        const { container } = render(h(UnifiedDiffViewer, { diff: DIFF, enableComments: true, comments: [c1, c2] }));
        const badge = container.querySelector('[data-diff-line-index="6"] [data-testid="comment-badge"]');
        expect(badge).not.toBeNull();
        expect(badge!.textContent).toBe('2');
    });
});

// ============================================================================
// Resolved comment highlights
// ============================================================================

describe('UnifiedDiffViewer — resolved comment highlights', () => {
    it('renders green highlight class for resolved comment', () => {
        const c = makeComment({ diffLineStart: 6, diffLineEnd: 6, status: 'resolved' });
        const { container } = render(h(UnifiedDiffViewer, { diff: DIFF, enableComments: true, comments: [c] }));
        const lineDiv = container.querySelector<HTMLElement>('[data-diff-line-index="6"]')!;
        expect(lineDiv.className).toContain('e6ffed');
        expect(lineDiv.className).toContain('opacity-80');
    });

    it('badge has bg-green-500 for resolved comment', () => {
        const c = makeComment({ diffLineStart: 6, diffLineEnd: 6, status: 'resolved' });
        const { container } = render(h(UnifiedDiffViewer, { diff: DIFF, enableComments: true, comments: [c] }));
        const badge = container.querySelector<HTMLElement>('[data-testid="comment-badge"]')!;
        expect(badge.className).toContain('bg-green-500');
    });

    it('open comment takes visual priority over resolved on mixed line', () => {
        const open = makeComment({ id: 'o', diffLineStart: 6, diffLineEnd: 6, status: 'open' });
        const resolved = makeComment({ id: 'r', diffLineStart: 6, diffLineEnd: 6, status: 'resolved' });
        const { container } = render(h(UnifiedDiffViewer, { diff: DIFF, enableComments: true, comments: [open, resolved] }));
        const lineDiv = container.querySelector<HTMLElement>('[data-diff-line-index="6"]')!;
        // Should show yellow (open takes priority)
        expect(lineDiv.className).toContain('fff9c4');
        expect(lineDiv.className).not.toContain('opacity-80');
    });
});

// ============================================================================
// Orphaned comments
// ============================================================================

describe('UnifiedDiffViewer — orphaned comments', () => {
    it('does not render badge for an orphaned comment', () => {
        const orphaned = {
            ...makeComment({ diffLineStart: 6, diffLineEnd: 6 }),
            status: 'orphaned' as any,
        };
        const { container } = render(h(UnifiedDiffViewer, { diff: DIFF, enableComments: true, comments: [orphaned] }));
        const lineDiv = container.querySelector<HTMLElement>('[data-diff-line-index="6"]')!;
        expect(lineDiv.querySelector('[data-testid="comment-badge"]')).toBeNull();
    });
});

// ============================================================================
// enableComments=false guards
// ============================================================================

describe('UnifiedDiffViewer — comments disabled', () => {
    it('does not render badges when enableComments is false even with comments', () => {
        const c = makeComment({ diffLineStart: 6, diffLineEnd: 6 });
        const { container } = render(h(UnifiedDiffViewer, { diff: DIFF, comments: [c] }));
        expect(container.querySelectorAll('[data-testid="comment-badge"]')).toHaveLength(0);
    });

    it('does not attach data-diff-line-index attributes when enableComments is false', () => {
        const { container } = render(h(UnifiedDiffViewer, { diff: DIFF }));
        expect(container.querySelectorAll('[data-diff-line-index]')).toHaveLength(0);
    });
});
