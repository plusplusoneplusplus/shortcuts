/**
 * Unit tests for relocateDiffAnchor utility.
 *
 * Covers all three matching strategies and edge cases.
 */

import { describe, it, expect } from 'vitest';
import { relocateDiffAnchor } from '../../../../src/server/spa/client/react/utils/relocateDiffAnchor';
import type { DiffComment } from '../../../../src/server/spa/client/diff-comment-types';
import type { DiffLine } from '../../../../src/server/spa/client/react/repos/UnifiedDiffViewer';

// ============================================================================
// Helpers
// ============================================================================

/** djb2 hash — mirrors hashText in relocateDiffAnchor */
function hashText(text: string): string {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) + hash) + text.charCodeAt(i);
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

function makeLine(content: string, index: number): DiffLine {
    return { index, type: 'context', content };
}

function makeComment(overrides: Partial<DiffComment> = {}): DiffComment {
    return {
        id: 'c1',
        context: { repositoryId: 'repo', filePath: 'f.ts', oldRef: 'a', newRef: 'b' },
        selection: { diffLineStart: 2, diffLineEnd: 2, side: 'added', startColumn: 0, endColumn: 5 },
        selectedText: 'hello',
        comment: 'test',
        status: 'open',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('relocateDiffAnchor', () => {
    // ── 1. No anchor → unchanged diffLineStart ────────────────────────

    it('returns unchanged diffLineStart when comment has no anchor', () => {
        const comment = makeComment({ selection: { diffLineStart: 5, diffLineEnd: 5, side: 'added', startColumn: 0, endColumn: 3 } });
        const lines = [makeLine('+foo', 0), makeLine('+bar', 1), makeLine('+baz', 2)];
        expect(relocateDiffAnchor(comment, lines)).toBe(5);
    });

    // ── 2. Strategy 1 — exact hash match ─────────────────────────────

    it('returns index of line whose content hash matches textHash', () => {
        const targetContent = '+const x = 42;';
        const comment = makeComment({
            anchor: {
                selectedText: 'const x = 42;',
                contextBefore: '',
                contextAfter: '',
                originalLine: 1,
                textHash: hashText(targetContent),
            },
        });
        const lines = [
            makeLine('+foo', 0),
            makeLine('+bar', 1),
            makeLine(targetContent, 2),
            makeLine('+baz', 3),
        ];
        expect(relocateDiffAnchor(comment, lines)).toBe(2);
    });

    // ── 3. Strategy 2 — substring match ──────────────────────────────

    it('returns first line index where content includes selectedText when hash differs', () => {
        const comment = makeComment({
            anchor: {
                selectedText: 'return value',
                contextBefore: '',
                contextAfter: '',
                originalLine: 3,
                textHash: 'nonexistent-hash',
            },
        });
        const lines = [
            makeLine('+const x = 1;', 0),
            makeLine('+  return value;', 1),
            makeLine('+  return value again', 2),
        ];
        // First match at index 1
        expect(relocateDiffAnchor(comment, lines)).toBe(1);
    });

    // ── 4. Strategy 3 — context match ────────────────────────────────

    it('returns index i when line[i-1] contains contextBefore and line[i+1] contains contextAfter', () => {
        const comment = makeComment({
            anchor: {
                selectedText: 'MOVED LINE',
                contextBefore: 'function start',
                contextAfter: 'function end',
                originalLine: 2,
                textHash: 'no-match',
            },
        });
        const lines = [
            makeLine('+something else', 0),
            makeLine('+function start', 1),
            makeLine('+the target line', 2),
            makeLine('+function end', 3),
            makeLine('+more stuff', 4),
        ];
        expect(relocateDiffAnchor(comment, lines)).toBe(2);
    });

    // ── 5. Returns null when no strategy matches → orphaned ──────────

    it('returns null when no strategy matches (comment should be orphaned)', () => {
        const comment = makeComment({
            anchor: {
                selectedText: 'completely removed content',
                contextBefore: 'nonexistent before',
                contextAfter: 'nonexistent after',
                originalLine: 1,
                textHash: 'no-match',
            },
        });
        const lines = [
            makeLine('+foo', 0),
            makeLine('+bar', 1),
            makeLine('+baz', 2),
        ];
        expect(relocateDiffAnchor(comment, lines)).toBeNull();
    });

    // ── 6. Hash match takes priority over substring ───────────────────

    it('uses hash match (strategy 1) even when substring would match a different line', () => {
        const hashMatchContent = '+hash target line';
        const comment = makeComment({
            anchor: {
                selectedText: 'target',
                contextBefore: '',
                contextAfter: '',
                originalLine: 0,
                textHash: hashText(hashMatchContent),
            },
        });
        const lines = [
            makeLine('+substring target line', 0), // substring matches first
            makeLine(hashMatchContent, 1),           // hash matches second
        ];
        // Strategy 1 (hash) should return 1, not 0
        expect(relocateDiffAnchor(comment, lines)).toBe(1);
    });

    // ── 7. Empty lines array → null ───────────────────────────────────

    it('returns null for empty lines array when anchor present', () => {
        const comment = makeComment({
            anchor: {
                selectedText: 'anything',
                contextBefore: 'before',
                contextAfter: 'after',
                originalLine: 0,
                textHash: 'no-match',
            },
        });
        expect(relocateDiffAnchor(comment, [])).toBeNull();
    });

    // ── 8. Single-line array with hash match ─────────────────────────

    it('handles single-line array with hash match', () => {
        const content = '+the only line';
        const comment = makeComment({
            anchor: {
                selectedText: 'only',
                contextBefore: '',
                contextAfter: '',
                originalLine: 0,
                textHash: hashText(content),
            },
        });
        expect(relocateDiffAnchor(comment, [makeLine(content, 0)])).toBe(0);
    });
});
