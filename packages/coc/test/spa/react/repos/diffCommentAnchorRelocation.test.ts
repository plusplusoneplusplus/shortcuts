/**
 * Unit tests for diff comment anchor relocation.
 *
 * Tests `relocateDiffAnchor` from the client utilities, which re-matches a
 * comment anchor against a new DiffLine[] after the underlying diff changes.
 *
 * Covers:
 *   - Anchor still valid at same index
 *   - Anchor relocated to a different index when hunk offsets shift
 *   - Anchor orphaned (out of range / not found)
 *   - Comment without anchor returns unchanged diffLineStart
 */

import { describe, it, expect } from 'vitest';
import { relocateDiffAnchor } from '../../../../src/server/spa/client/react/utils/relocateDiffAnchor';
import type { DiffComment } from '../../../../src/server/spa/client/diff-comment-types';
import type { DiffLine } from '../../../../src/server/spa/client/react/repos/UnifiedDiffViewer';

// ============================================================================
// Helpers
// ============================================================================

/** djb2 hash — mirrors relocateDiffAnchor's internal hashText */
function hashText(text: string): string {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) + hash) + text.charCodeAt(i);
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

function makeLines(count: number): DiffLine[] {
    return Array.from({ length: count }, (_, i) => ({
        index: i,
        type: 'context' as const,
        content: `line ${i}`,
        oldLine: i + 1,
        newLine: i + 1,
    }));
}

function makeComment(diffLineStart: number, anchor?: DiffComment['anchor']): DiffComment {
    return {
        id: 'c1',
        context: { repositoryId: 'repo', filePath: 'f.ts', oldRef: 'a', newRef: 'b' },
        selection: {
            diffLineStart,
            diffLineEnd: diffLineStart,
            side: 'context',
            startColumn: 0,
            endColumn: 5,
        },
        selectedText: 'selected',
        comment: 'test comment',
        status: 'open',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        ...(anchor !== undefined ? { anchor } : {}),
    };
}

// ============================================================================
// No anchor → returns unchanged diffLineStart
// ============================================================================

describe('relocateAnchor — no anchor', () => {
    it('returns the same diffLineStart when comment has no anchor', () => {
        const lines = makeLines(10);
        const result = relocateDiffAnchor(makeComment(3), lines);
        expect(result).toBe(3);
    });

    it('returns 0 for a comment at line 0 with no anchor', () => {
        const result = relocateDiffAnchor(makeComment(0), makeLines(5));
        expect(result).toBe(0);
    });
});

// ============================================================================
// Anchor still valid at same index
// ============================================================================

describe('relocateAnchor — anchor valid at same position', () => {
    it('returns the same index when hash matches at original line', () => {
        const content = '+const x = 1;';
        const lines = makeLines(5);
        lines[3] = { ...lines[3], content };
        const comment = makeComment(3, {
            selectedText: 'const x = 1',
            contextBefore: '',
            contextAfter: '',
            originalLine: 3,
            textHash: hashText(content),
        });
        const result = relocateDiffAnchor(comment, lines);
        expect(result).not.toBeNull();
        expect(result).toBe(3);
    });
});

// ============================================================================
// Anchor orphaned (out of range)
// ============================================================================

describe('relocateAnchor — orphaned anchor', () => {
    it('returns null when anchor line is beyond the diff', () => {
        const lines = makeLines(5); // indices 0-4
        const comment = makeComment(10, {
            selectedText: 'nonexistent',
            contextBefore: 'nonexistent before',
            contextAfter: 'nonexistent after',
            originalLine: 10,
            textHash: 'no-match-hash',
        });
        const result = relocateDiffAnchor(comment, lines);
        expect(result).toBeNull();
    });

    it('returns null when anchor hash matches nothing in the diff', () => {
        const lines = makeLines(5);
        const comment = makeComment(2, {
            selectedText: 'completely removed content',
            contextBefore: 'nonexistent',
            contextAfter: 'nonexistent',
            originalLine: 2,
            textHash: 'deadbeef',
        });
        expect(relocateDiffAnchor(comment, lines)).toBeNull();
    });

    it('returns null for empty lines array when anchor is present', () => {
        const comment = makeComment(0, {
            selectedText: 'anything',
            contextBefore: '',
            contextAfter: '',
            originalLine: 0,
            textHash: 'no-match',
        });
        expect(relocateDiffAnchor(comment, [])).toBeNull();
    });
});

// ============================================================================
// Anchor relocated (hunk offset shift)
// ============================================================================

describe('relocateAnchor — hunk offset shift', () => {
    it('relocates to new index when content moved due to insertion', () => {
        const movedContent = '+  return result;';
        // Build lines where the content is now at index 7 (was at index 5)
        const lines: DiffLine[] = [
            ...makeLines(5),
            { index: 5, type: 'added', content: '+inserted1', newLine: 6 },
            { index: 6, type: 'added', content: '+inserted2', newLine: 7 },
            { index: 7, type: 'context', content: movedContent, oldLine: 5, newLine: 8 },
        ];
        const comment = makeComment(5, {
            selectedText: 'return result',
            contextBefore: '',
            contextAfter: '',
            originalLine: 5,
            textHash: hashText(movedContent),
        });
        const result = relocateDiffAnchor(comment, lines);
        expect(result).not.toBeNull();
        expect(result).toBe(7);
    });

    it('uses substring match when hash differs but selectedText still present', () => {
        const lines: DiffLine[] = [
            { index: 0, type: 'context', content: '+other line', oldLine: 1, newLine: 1 },
            { index: 1, type: 'context', content: '+the return value here', oldLine: 2, newLine: 2 },
            { index: 2, type: 'context', content: '+more content', oldLine: 3, newLine: 3 },
        ];
        const comment = makeComment(0, {
            selectedText: 'return value',
            contextBefore: '',
            contextAfter: '',
            originalLine: 0,
            textHash: 'stale-hash',
        });
        const result = relocateDiffAnchor(comment, lines);
        expect(result).not.toBeNull();
        expect(result).toBe(1); // first line containing selectedText
    });

    it('uses context match (contextBefore + contextAfter) when hash and text differ', () => {
        const lines: DiffLine[] = [
            { index: 0, type: 'context', content: '+setup', oldLine: 1, newLine: 1 },
            { index: 1, type: 'context', content: '+function begin', oldLine: 2, newLine: 2 },
            { index: 2, type: 'context', content: '+the target', oldLine: 3, newLine: 3 },
            { index: 3, type: 'context', content: '+function end', oldLine: 4, newLine: 4 },
            { index: 4, type: 'context', content: '+teardown', oldLine: 5, newLine: 5 },
        ];
        const comment = makeComment(2, {
            selectedText: 'CHANGED TARGET',
            contextBefore: 'function begin',
            contextAfter: 'function end',
            originalLine: 2,
            textHash: 'stale-hash',
        });
        const result = relocateDiffAnchor(comment, lines);
        expect(result).not.toBeNull();
        expect(result).toBe(2);
    });
});
