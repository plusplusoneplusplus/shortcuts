/**
 * Unit tests for DiffCommentSelection mapping.
 *
 * Tests `buildLineCommentMap` from UnifiedDiffViewer — the function that maps
 * DiffComment selection ranges (diffLineStart..diffLineEnd) to rendered line
 * indices, which is the core of the comment→line selection mapping system.
 *
 * Also tests `getLineHighlightClass` for the visual indication of selection ranges.
 */

import { describe, it, expect } from 'vitest';
import {
    buildLineCommentMap,
    getLineHighlightClass,
} from '../../../../src/server/spa/client/react/repos/UnifiedDiffViewer';
import type { DiffComment } from '../../../../src/server/spa/client/diff-comment-types';

// ============================================================================
// Helpers
// ============================================================================

function makeComment(overrides: {
    id?: string;
    diffLineStart: number;
    diffLineEnd: number;
    status?: DiffComment['status'];
}): DiffComment {
    return {
        id: overrides.id ?? 'c1',
        context: {
            repositoryId: 'repo-1',
            filePath: 'src/foo.ts',
            oldRef: 'HEAD~1',
            newRef: 'HEAD',
        },
        selection: {
            diffLineStart: overrides.diffLineStart,
            diffLineEnd: overrides.diffLineEnd,
            side: 'added',
            startColumn: 0,
            endColumn: 10,
        },
        selectedText: 'selected text',
        comment: 'A comment body',
        status: overrides.status ?? 'open',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    };
}

// ============================================================================
// buildLineCommentMap — single-line selection
// ============================================================================

describe('buildLineCommentMap — single-line selection', () => {
    it('maps a single-line comment to exactly one line index', () => {
        const c = makeComment({ diffLineStart: 3, diffLineEnd: 3 });
        const map = buildLineCommentMap([c]);

        expect(map.get(3)).toEqual([c]);
        expect(map.has(2)).toBe(false);
        expect(map.has(4)).toBe(false);
    });

    it('selection at diffLineStart === diffLineEnd maps to one key', () => {
        const c = makeComment({ diffLineStart: 0, diffLineEnd: 0 });
        const map = buildLineCommentMap([c]);
        expect(map.size).toBe(1);
        expect(map.get(0)).toEqual([c]);
    });
});

// ============================================================================
// buildLineCommentMap — multi-line selection
// ============================================================================

describe('buildLineCommentMap — multi-line selection', () => {
    it('maps a multi-line selection (3..5) to all covered indices', () => {
        const c = makeComment({ diffLineStart: 3, diffLineEnd: 5 });
        const map = buildLineCommentMap([c]);

        expect(map.get(3)).toEqual([c]);
        expect(map.get(4)).toEqual([c]);
        expect(map.get(5)).toEqual([c]);
        expect(map.has(2)).toBe(false);
        expect(map.has(6)).toBe(false);
    });

    it('two overlapping comments both appear at the overlap line', () => {
        const c1 = makeComment({ id: 'c1', diffLineStart: 1, diffLineEnd: 4 });
        const c2 = makeComment({ id: 'c2', diffLineStart: 3, diffLineEnd: 6 });
        const map = buildLineCommentMap([c1, c2]);

        expect(map.get(1)).toEqual([c1]);
        expect(map.get(2)).toEqual([c1]);
        expect(map.get(3)).toEqual([c1, c2]);
        expect(map.get(4)).toEqual([c1, c2]);
        expect(map.get(5)).toEqual([c2]);
        expect(map.get(6)).toEqual([c2]);
    });

    it('captures resolved-comment selection ranges', () => {
        const c = makeComment({ diffLineStart: 10, diffLineEnd: 12, status: 'resolved' });
        const map = buildLineCommentMap([c]);
        expect(map.get(10)).toEqual([c]);
        expect(map.get(12)).toEqual([c]);
    });
});

// ============================================================================
// buildLineCommentMap — empty / edge cases
// ============================================================================

describe('buildLineCommentMap — empty and edge cases', () => {
    it('returns empty map for empty comment array', () => {
        const map = buildLineCommentMap([]);
        expect(map.size).toBe(0);
    });

    it('handles large diffLineStart values without error', () => {
        const c = makeComment({ diffLineStart: 999, diffLineEnd: 1001 });
        const map = buildLineCommentMap([c]);
        expect(map.get(999)).toEqual([c]);
        expect(map.get(1001)).toEqual([c]);
    });
});

// ============================================================================
// getLineHighlightClass — visual selection indication
// ============================================================================

describe('getLineHighlightClass — selection highlight', () => {
    it('returns empty string when no comments cover the line', () => {
        expect(getLineHighlightClass(undefined)).toBe('');
        expect(getLineHighlightClass([])).toBe('');
    });

    it('returns yellow highlight for an open comment (active selection)', () => {
        const c = makeComment({ diffLineStart: 1, diffLineEnd: 1, status: 'open' });
        const cls = getLineHighlightClass([c]);
        expect(cls).toContain('fff9c4'); // yellow highlight color
    });

    it('returns green highlight for a fully-resolved selection', () => {
        const c = makeComment({ diffLineStart: 1, diffLineEnd: 1, status: 'resolved' });
        const cls = getLineHighlightClass([c]);
        expect(cls).toContain('e6ffed'); // green highlight color
    });

    it('open comment takes priority over resolved in mixed selection', () => {
        const open = makeComment({ id: 'o', diffLineStart: 1, diffLineEnd: 1, status: 'open' });
        const resolved = makeComment({ id: 'r', diffLineStart: 1, diffLineEnd: 1, status: 'resolved' });
        // open takes priority
        expect(getLineHighlightClass([resolved, open])).toContain('fff9c4');
    });
});
