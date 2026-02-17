/**
 * Anchor Integration Tests
 *
 * Verifies that pipeline-core's anchor module works correctly in the
 * CoC SPA context after replacing the inlined task-comment-anchor.ts.
 *
 * Covers:
 *   - createAnchorData produces correct output for sample content
 *   - relocateAnchorPosition handles all 5 strategies
 *   - needsRelocationCheck detects moved content
 *   - Regression: existing comment anchor data relocates with new implementation
 */

import { describe, it, expect } from 'vitest';
import {
    createAnchorData,
    relocateAnchorPosition,
    needsRelocationCheck,
    extractTextFromSelection,
    batchRelocateAnchors,
    DEFAULT_ANCHOR_MATCH_CONFIG,
} from '@plusplusoneplusplus/pipeline-core/editor/anchor';

import type {
    BaseAnchorData,
    AnchorRelocationResult,
} from '@plusplusoneplusplus/pipeline-core/editor/anchor';

import type {
    CommentSelection,
    CommentAnchor,
} from '@plusplusoneplusplus/pipeline-core/editor/types';

// ============================================================================
// createAnchorData
// ============================================================================

describe('createAnchorData (pipeline-core)', () => {
    const content = 'aaa\nbbb\nccc\nddd\neee';

    it('creates anchor for single-line selection', () => {
        const anchor = createAnchorData(content, 3, 3, 1, 4);
        expect(anchor.selectedText).toBe('ccc');
        expect(anchor.originalLine).toBe(3);
        expect(typeof anchor.textHash).toBe('string');
        expect(anchor.textHash.length).toBeGreaterThan(0);
    });

    it('creates anchor for multi-line selection', () => {
        const anchor = createAnchorData(content, 2, 3, 1, 4);
        expect(anchor.selectedText).toBe('bbb\nccc');
    });

    it('includes context before and after', () => {
        const anchor = createAnchorData(content, 3, 3, 1, 4);
        expect(anchor.contextBefore.length).toBeGreaterThan(0);
        expect(anchor.contextAfter.length).toBeGreaterThan(0);
    });

    it('handles selection at document start (no context before)', () => {
        const anchor = createAnchorData(content, 1, 1, 1, 4);
        expect(anchor.contextBefore).toBe('');
        expect(anchor.selectedText).toBe('aaa');
    });

    it('handles selection at document end (no context after)', () => {
        const anchor = createAnchorData(content, 5, 5, 1, 4);
        expect(anchor.contextAfter).toBe('');
        expect(anchor.selectedText).toBe('eee');
    });

    it('produces BaseAnchorData compatible with CommentAnchor', () => {
        const anchor = createAnchorData(content, 2, 2, 1, 4);
        // BaseAnchorData and CommentAnchor have the same shape
        const asCommentAnchor: CommentAnchor = anchor;
        expect(asCommentAnchor.selectedText).toBe('bbb');
        expect(asCommentAnchor.originalLine).toBe(2);
        expect(asCommentAnchor.textHash).toBeTruthy();
    });
});

// ============================================================================
// extractTextFromSelection
// ============================================================================

describe('extractTextFromSelection (pipeline-core)', () => {
    const content = 'line one\nline two\nline three';

    it('extracts single-line text', () => {
        expect(extractTextFromSelection(content, 1, 1, 6, 9)).toBe('one');
    });

    it('extracts multi-line text', () => {
        expect(extractTextFromSelection(content, 1, 2, 6, 9)).toBe('one\nline two');
    });
});

// ============================================================================
// relocateAnchorPosition — all 5 strategies
// ============================================================================

describe('relocateAnchorPosition - Strategy 1: Exact Match', () => {
    it('relocates unique text with confidence 1.0', () => {
        const content = 'aaa\nbbb\nccc';
        const anchor = createAnchorData(content, 2, 2, 1, 4);
        const result = relocateAnchorPosition(content, anchor);

        expect(result.found).toBe(true);
        expect(result.confidence).toBe(1.0);
        expect(result.reason).toBe('exact_match');
        expect(result.startLine).toBe(2);
        expect(result.startColumn).toBe(1);
        expect(result.endLine).toBe(2);
        expect(result.endColumn).toBe(4);
    });

    it('finds text after lines inserted above', () => {
        const original = 'aaa\nTARGET\nccc';
        const anchor = createAnchorData(original, 2, 2, 1, 7);
        const modified = 'new1\nnew2\naaa\nTARGET\nccc';

        const result = relocateAnchorPosition(modified, anchor);
        expect(result.found).toBe(true);
        expect(result.startLine).toBe(4);
    });
});

describe('relocateAnchorPosition - Strategy 2: Context Disambiguation', () => {
    it('disambiguates multiple matches by context', () => {
        const content = 'prefix1\nfoo\nbar\nprefix2\nfoo\nbaz';
        const anchor: BaseAnchorData = {
            selectedText: 'foo',
            contextBefore: 'prefix2\n',
            contextAfter: '\nbaz',
            originalLine: 5,
            textHash: 'x',
        };
        const result = relocateAnchorPosition(content, anchor);
        expect(result.found).toBe(true);
        expect(result.reason).toBe('context_match');
        expect(result.startLine).toBe(5);
    });
});

describe('relocateAnchorPosition - Strategy 3: Fuzzy Match', () => {
    it('relocates text with minor edits', () => {
        const original = 'function doSomething() {';
        const modified = 'function doSomethng() {'; // typo
        const content = 'header\n' + modified + '\nfooter';

        const anchor: BaseAnchorData = {
            selectedText: original,
            contextBefore: 'header\n',
            contextAfter: '\nfooter',
            originalLine: 2,
            textHash: 'x',
        };
        const result = relocateAnchorPosition(content, anchor);
        expect(result.found).toBe(true);
        expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });
});

describe('relocateAnchorPosition - Strategy 4: Context-Only Match', () => {
    it('relocates when text changed but context remains', () => {
        const prefix = 'A'.repeat(40);
        const suffix = 'B'.repeat(40);
        const content = prefix + 'COMPLETELY DIFFERENT' + suffix;

        const anchor: BaseAnchorData = {
            selectedText: 'OLD TEXT',
            contextBefore: prefix,
            contextAfter: suffix,
            originalLine: 1,
            textHash: 'x',
        };
        const result = relocateAnchorPosition(content, anchor);
        expect(result.found).toBe(true);
        expect(result.confidence).toBe(0.5);
        expect(result.reason).toBe('context_match');
    });
});

describe('relocateAnchorPosition - Strategy 5: Line Fallback', () => {
    it('falls back to original line', () => {
        const content = 'xxx\nyyy\nzzz';
        const anchor: BaseAnchorData = {
            selectedText: 'original text that no longer exists anywhere',
            contextBefore: 'A'.repeat(5),
            contextAfter: 'B'.repeat(5),
            originalLine: 2,
            textHash: 'x',
        };
        const result = relocateAnchorPosition(content, anchor);
        expect(result.found).toBe(true);
        expect(result.confidence).toBe(0.2);
        expect(result.reason).toBe('line_fallback');
        expect(result.startLine).toBe(2);
    });

    it('returns not_found when line no longer exists', () => {
        const content = 'only one line';
        const anchor: BaseAnchorData = {
            selectedText: 'gone',
            contextBefore: 'A'.repeat(5),
            contextAfter: 'B'.repeat(5),
            originalLine: 10,
            textHash: 'x',
        };
        const result = relocateAnchorPosition(content, anchor);
        expect(result.found).toBe(false);
        expect(result.reason).toBe('not_found');
    });
});

describe('relocateAnchorPosition - Edge Cases', () => {
    it('handles empty content', () => {
        const anchor: BaseAnchorData = {
            selectedText: 'test',
            contextBefore: '',
            contextAfter: '',
            originalLine: 1,
            textHash: 'x',
        };
        const result = relocateAnchorPosition('', anchor);
        expect(result.found).toBe(false);
        expect(result.reason).toBe('not_found');
    });

    it('handles whitespace-only content', () => {
        const anchor: BaseAnchorData = {
            selectedText: 'test',
            contextBefore: '',
            contextAfter: '',
            originalLine: 1,
            textHash: 'x',
        };
        const result = relocateAnchorPosition('   \n  \n  ', anchor);
        expect(result.found).toBe(false);
        expect(result.reason).toBe('not_found');
    });
});

// ============================================================================
// needsRelocationCheck
// ============================================================================

describe('needsRelocationCheck (pipeline-core)', () => {
    it('returns false when text at position is unchanged', () => {
        const content = 'hello world';
        const anchor = createAnchorData(content, 1, 1, 1, 6);
        expect(needsRelocationCheck(content, anchor, 1, 1, 1, 6)).toBe(false);
    });

    it('returns true when text at position has changed', () => {
        const content = 'hello world';
        const anchor = createAnchorData('goodbye world', 1, 1, 1, 8);
        expect(needsRelocationCheck(content, anchor, 1, 1, 1, 8)).toBe(true);
    });
});

// ============================================================================
// batchRelocateAnchors
// ============================================================================

describe('batchRelocateAnchors (pipeline-core)', () => {
    it('relocates multiple anchors in one pass', () => {
        const content = 'aaa\nbbb\nccc';
        const anchors = new Map<string, BaseAnchorData>();
        anchors.set('a1', createAnchorData(content, 1, 1, 1, 4));
        anchors.set('a2', createAnchorData(content, 2, 2, 1, 4));

        const results = batchRelocateAnchors(content, anchors);
        expect(results.size).toBe(2);
        expect(results.get('a1')!.found).toBe(true);
        expect(results.get('a2')!.found).toBe(true);
    });
});

// ============================================================================
// Regression: existing comment data relocates correctly
// ============================================================================

describe('Regression: existing comment anchor data', () => {
    it('creates anchor, edits document, relocates successfully', () => {
        const original = 'function hello() {\n  console.log("hi");\n  return true;\n}';
        const anchor = createAnchorData(original, 2, 2, 3, 20);
        expect(anchor.selectedText).toBe('console.log("hi")');

        // Add a line above
        const modified = 'function hello() {\n  // added comment\n  console.log("hi");\n  return true;\n}';
        const result = relocateAnchorPosition(modified, anchor);
        expect(result.found).toBe(true);
        expect(result.confidence).toBe(1.0);
        expect(result.startLine).toBe(3);
    });

    it('anchor survives line insertions above', () => {
        const original = 'line1\nline2\nTARGET LINE\nline4';
        const anchor = createAnchorData(original, 3, 3, 1, 12);

        const modified = 'line1\nNEW\nNEW2\nline2\nTARGET LINE\nline4';
        const result = relocateAnchorPosition(modified, anchor);
        expect(result.found).toBe(true);
        expect(result.startLine).toBe(5);
    });

    it('anchor survives line deletions above', () => {
        const original = 'line1\nline2\nline3\nTARGET LINE\nline5';
        const anchor = createAnchorData(original, 4, 4, 1, 12);

        const modified = 'line1\nTARGET LINE\nline5';
        const result = relocateAnchorPosition(modified, anchor);
        expect(result.found).toBe(true);
        expect(result.startLine).toBe(2);
    });

    it('anchor survives minor text edits in selection', () => {
        const original = 'aaa\nconst value = computeResult();\nccc';
        const anchor = createAnchorData(original, 2, 2, 1, 33);

        const modified = 'aaa\nconst value = computeResults();\nccc';
        const result = relocateAnchorPosition(modified, anchor);
        expect(result.found).toBe(true);
        expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it('AnchorRelocationResult uses flat fields (not nested selection)', () => {
        const content = 'aaa\nbbb\nccc';
        const anchor = createAnchorData(content, 2, 2, 1, 4);
        const result = relocateAnchorPosition(content, anchor);

        // pipeline-core returns flat startLine/endLine/startColumn/endColumn
        expect(result.startLine).toBe(2);
        expect(result.endLine).toBe(2);
        expect(result.startColumn).toBe(1);
        expect(result.endColumn).toBe(4);
        // no nested 'selection' property
        expect((result as any).selection).toBeUndefined();
    });
});
