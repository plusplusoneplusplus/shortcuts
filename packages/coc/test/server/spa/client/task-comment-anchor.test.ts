/**
 * Tests for task-comment-anchor.ts
 *
 * Comprehensive unit and integration tests covering:
 *   - Text utilities (splitIntoLines, getCharOffset, offsetToLineColumn, hashText)
 *   - Matching utilities (findAllOccurrences, levenshteinDistance, calculateSimilarity, normalizeText)
 *   - Context & scoring (extractContext, scoreMatch, findFuzzyMatch)
 *   - Anchor creation (extractTextFromSelection, createAnchorData, createAnchor)
 *   - Relocation strategies (all 5 strategies + edge cases)
 *   - Batch operations (batchRelocateAnchors, needsRelocation)
 *   - Integration scenarios
 */

import { describe, it, expect } from 'vitest';
import {
    // Text utilities
    splitIntoLines,
    getCharOffset,
    offsetToLineColumn,
    hashText,
    // Matching utilities
    findAllOccurrences,
    levenshteinDistance,
    calculateSimilarity,
    normalizeText,
    // Context & scoring
    extractContext,
    scoreMatch,
    findFuzzyMatch,
    // Anchor creation
    extractTextFromSelection,
    createAnchorData,
    createAnchor,
    // Relocation
    relocateAnchor,
    needsRelocation,
    updateAnchor,
    batchRelocateAnchors,
    // Config
    DEFAULT_ANCHOR_CONFIG,
} from '../../../../src/server/spa/client/task-comment-anchor';

import type { CommentAnchor, CommentSelection } from '../../../../src/server/spa/client/task-comments-types';

// ============================================================================
// Test Suite 1: Text Utilities
// ============================================================================

describe('splitIntoLines', () => {
    it('handles \\n line endings', () => {
        expect(splitIntoLines('a\nb\nc')).toEqual(['a', 'b', 'c']);
    });

    it('handles \\r\\n line endings', () => {
        expect(splitIntoLines('a\r\nb\r\nc')).toEqual(['a', 'b', 'c']);
    });

    it('handles mixed line endings', () => {
        expect(splitIntoLines('a\nb\r\nc')).toEqual(['a', 'b', 'c']);
    });

    it('handles empty string', () => {
        expect(splitIntoLines('')).toEqual(['']);
    });

    it('handles no newlines', () => {
        expect(splitIntoLines('hello world')).toEqual(['hello world']);
    });
});

describe('getCharOffset', () => {
    const lines = ['hello', 'world', 'foo'];

    it('converts first line position', () => {
        expect(getCharOffset(lines, 1, 1)).toBe(0);
    });

    it('converts mid-first-line position', () => {
        expect(getCharOffset(lines, 1, 3)).toBe(2);
    });

    it('converts second line start', () => {
        // line 1 has 5 chars + 1 newline = 6 offset, col 1 = offset 6
        expect(getCharOffset(lines, 2, 1)).toBe(6);
    });

    it('converts third line position', () => {
        // line 1: 5+1=6, line 2: 5+1=6 → offset 12, col 2 = offset 13
        expect(getCharOffset(lines, 3, 2)).toBe(13);
    });
});

describe('offsetToLineColumn', () => {
    const content = 'hello\nworld\nfoo';

    it('converts offset 0 to start of document', () => {
        expect(offsetToLineColumn(content, 0)).toEqual({ line: 1, column: 1 });
    });

    it('converts offset to mid-first line', () => {
        expect(offsetToLineColumn(content, 3)).toEqual({ line: 1, column: 4 });
    });

    it('converts offset to start of second line', () => {
        // 'hello\n' = 6 chars, so offset 6 = line 2, col 1
        expect(offsetToLineColumn(content, 6)).toEqual({ line: 2, column: 1 });
    });

    it('converts offset to end of document', () => {
        // 'hello\nworld\nfoo' length = 15, last char at offset 14
        expect(offsetToLineColumn(content, 14)).toEqual({ line: 3, column: 3 });
    });
});

describe('hashText', () => {
    it('generates consistent hash for same input', () => {
        const h1 = hashText('hello world');
        const h2 = hashText('hello world');
        expect(h1).toBe(h2);
    });

    it('generates different hashes for different input', () => {
        expect(hashText('hello')).not.toBe(hashText('world'));
    });

    it('handles empty string', () => {
        const h = hashText('');
        expect(typeof h).toBe('string');
        expect(h.length).toBeGreaterThan(0);
    });

    it('returns a base-36 string', () => {
        const h = hashText('test');
        expect(/^[0-9a-z]+$/.test(h)).toBe(true);
    });
});

// ============================================================================
// Test Suite 2: Matching Utilities
// ============================================================================

describe('findAllOccurrences', () => {
    it('finds single occurrence', () => {
        expect(findAllOccurrences('hello world', 'world')).toEqual([6]);
    });

    it('finds multiple occurrences', () => {
        expect(findAllOccurrences('abcabc', 'abc')).toEqual([0, 3]);
    });

    it('returns empty for no matches', () => {
        expect(findAllOccurrences('hello', 'xyz')).toEqual([]);
    });

    it('handles overlapping matches', () => {
        expect(findAllOccurrences('aaa', 'aa')).toEqual([0, 1]);
    });

    it('returns empty for empty search text', () => {
        expect(findAllOccurrences('hello', '')).toEqual([]);
    });
});

describe('levenshteinDistance', () => {
    it('returns 0 for identical strings', () => {
        expect(levenshteinDistance('abc', 'abc')).toBe(0);
    });

    it('calculates single edit', () => {
        expect(levenshteinDistance('abc', 'abd')).toBe(1);
    });

    it('calculates multiple edits', () => {
        expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    });

    it('handles empty first string', () => {
        expect(levenshteinDistance('', 'abc')).toBe(3);
    });

    it('handles empty second string', () => {
        expect(levenshteinDistance('abc', '')).toBe(3);
    });

    it('handles both empty', () => {
        expect(levenshteinDistance('', '')).toBe(0);
    });
});

describe('calculateSimilarity', () => {
    it('returns 1.0 for identical strings', () => {
        expect(calculateSimilarity('hello', 'hello')).toBe(1);
    });

    it('returns 0.0 for empty vs non-empty', () => {
        expect(calculateSimilarity('', 'hello')).toBe(0);
        expect(calculateSimilarity('hello', '')).toBe(0);
    });

    it('returns value between 0 and 1 for similar strings', () => {
        const sim = calculateSimilarity('hello', 'hallo');
        expect(sim).toBeGreaterThan(0);
        expect(sim).toBeLessThan(1);
    });

    it('returns higher similarity for more similar strings', () => {
        const sim1 = calculateSimilarity('hello', 'helo');   // 1 edit / 5 chars
        const sim2 = calculateSimilarity('hello', 'world');  // many edits
        expect(sim1).toBeGreaterThan(sim2);
    });
});

describe('normalizeText', () => {
    it('trims whitespace', () => {
        expect(normalizeText('  hello  ')).toBe('hello');
    });

    it('normalizes \\r\\n to \\n', () => {
        expect(normalizeText('a\r\nb')).toBe('a\nb');
    });

    it('normalizes standalone \\r to \\n', () => {
        expect(normalizeText('a\rb')).toBe('a\nb');
    });

    it('handles empty string', () => {
        expect(normalizeText('')).toBe('');
    });
});

// ============================================================================
// Test Suite 3: Anchor Creation
// ============================================================================

describe('extractTextFromSelection', () => {
    const content = 'line one\nline two\nline three';

    it('extracts single-line selection', () => {
        expect(extractTextFromSelection(content, 1, 1, 6, 9)).toBe('one');
    });

    it('extracts multi-line selection', () => {
        const text = extractTextFromSelection(content, 1, 2, 6, 9);
        expect(text).toBe('one\nline two');
    });

    it('extracts from line start', () => {
        expect(extractTextFromSelection(content, 2, 2, 1, 5)).toBe('line');
    });

    it('handles selection at document end', () => {
        expect(extractTextFromSelection(content, 3, 3, 6, 11)).toBe('three');
    });

    it('handles empty selection (same column)', () => {
        expect(extractTextFromSelection(content, 1, 1, 3, 3)).toBe('');
    });
});

describe('createAnchor', () => {
    const content = 'aaa\nbbb\nccc\nddd\neee';
    // 'aaa\nbbb\nccc\nddd\neee'
    //  Lines: aaa(0-2), bbb(4-6), ccc(8-10), ddd(12-14), eee(16-18)

    it('creates anchor for single-line selection', () => {
        const sel: CommentSelection = { startLine: 3, startColumn: 1, endLine: 3, endColumn: 4 };
        const anchor = createAnchor(content, sel);
        expect(anchor.selectedText).toBe('ccc');
        expect(anchor.originalLine).toBe(3);
        expect(anchor.textHash).toBe(hashText('ccc'));
    });

    it('creates anchor for multi-line selection', () => {
        const sel: CommentSelection = { startLine: 2, startColumn: 1, endLine: 3, endColumn: 4 };
        const anchor = createAnchor(content, sel);
        expect(anchor.selectedText).toBe('bbb\nccc');
    });

    it('includes context before', () => {
        const sel: CommentSelection = { startLine: 3, startColumn: 1, endLine: 3, endColumn: 4 };
        const anchor = createAnchor(content, sel);
        expect(anchor.contextBefore.length).toBeGreaterThan(0);
    });

    it('includes context after', () => {
        const sel: CommentSelection = { startLine: 3, startColumn: 1, endLine: 3, endColumn: 4 };
        const anchor = createAnchor(content, sel);
        expect(anchor.contextAfter.length).toBeGreaterThan(0);
    });

    it('generates text hash', () => {
        const sel: CommentSelection = { startLine: 1, startColumn: 1, endLine: 1, endColumn: 4 };
        const anchor = createAnchor(content, sel);
        expect(anchor.textHash).toBeTruthy();
    });

    it('handles selection at document start', () => {
        const sel: CommentSelection = { startLine: 1, startColumn: 1, endLine: 1, endColumn: 4 };
        const anchor = createAnchor(content, sel);
        expect(anchor.contextBefore).toBe('');
        expect(anchor.selectedText).toBe('aaa');
    });

    it('handles selection at document end', () => {
        const sel: CommentSelection = { startLine: 5, startColumn: 1, endLine: 5, endColumn: 4 };
        const anchor = createAnchor(content, sel);
        expect(anchor.contextAfter).toBe('');
        expect(anchor.selectedText).toBe('eee');
    });

    it('respects config.contextCharsBefore', () => {
        const longContent = 'x'.repeat(200) + '\ntarget\n' + 'y'.repeat(200);
        const sel: CommentSelection = { startLine: 2, startColumn: 1, endLine: 2, endColumn: 7 };
        const anchor = createAnchor(longContent, sel, { ...DEFAULT_ANCHOR_CONFIG, contextCharsBefore: 10 });
        expect(anchor.contextBefore.length).toBeLessThanOrEqual(10);
    });

    it('respects config.contextCharsAfter', () => {
        const longContent = 'x'.repeat(200) + '\ntarget\n' + 'y'.repeat(200);
        const sel: CommentSelection = { startLine: 2, startColumn: 1, endLine: 2, endColumn: 7 };
        const anchor = createAnchor(longContent, sel, { ...DEFAULT_ANCHOR_CONFIG, contextCharsAfter: 10 });
        expect(anchor.contextAfter.length).toBeLessThanOrEqual(10);
    });

    it('handles empty context gracefully for short content', () => {
        const anchor = createAnchor('hi', { startLine: 1, startColumn: 1, endLine: 1, endColumn: 3 });
        expect(anchor.contextBefore).toBe('');
        expect(anchor.contextAfter).toBe('');
    });
});

// ============================================================================
// Test Suite 4: Relocation Strategies
// ============================================================================

describe('relocateAnchor - Strategy 1: Exact Match', () => {
    it('relocates exact single match with confidence 1.0', () => {
        const content = 'aaa\nbbb\nccc';
        const anchor: CommentAnchor = {
            selectedText: 'bbb',
            contextBefore: 'aaa\n',
            contextAfter: '\nccc',
            originalLine: 2,
            textHash: hashText('bbb'),
        };
        const result = relocateAnchor(content, anchor);
        expect(result.found).toBe(true);
        expect(result.confidence).toBe(1.0);
        expect(result.reason).toBe('exact_match');
        expect(result.selection).toEqual({
            startLine: 2, startColumn: 1, endLine: 2, endColumn: 4,
        });
    });

    it('returns exact_match reason', () => {
        const content = 'unique text here';
        const anchor: CommentAnchor = {
            selectedText: 'unique text',
            contextBefore: '',
            contextAfter: ' here',
            originalLine: 1,
            textHash: hashText('unique text'),
        };
        const result = relocateAnchor(content, anchor);
        expect(result.reason).toBe('exact_match');
    });
});

describe('relocateAnchor - Strategy 2: Context Disambiguation', () => {
    it('disambiguates multiple exact matches by context', () => {
        const content = 'prefix1\nfoo\nbar\nprefix2\nfoo\nbaz';
        const anchor: CommentAnchor = {
            selectedText: 'foo',
            contextBefore: 'prefix2\n',
            contextAfter: '\nbaz',
            originalLine: 5,
            textHash: hashText('foo'),
        };
        const result = relocateAnchor(content, anchor);
        expect(result.found).toBe(true);
        expect(result.reason).toBe('context_match');
        expect(result.selection!.startLine).toBe(5);
    });

    it('chooses best context score', () => {
        // "foo" appears twice; the one near 'prefix2' should win
        const content = 'alpha\nfoo\nbeta\ngamma\nfoo\ndelta';
        const anchor: CommentAnchor = {
            selectedText: 'foo',
            contextBefore: 'gamma\n',
            contextAfter: '\ndelta',
            originalLine: 5,
            textHash: hashText('foo'),
        };
        const result = relocateAnchor(content, anchor);
        expect(result.found).toBe(true);
        expect(result.selection!.startLine).toBe(5);
    });

    it('returns context_match reason', () => {
        const content = 'a\nfoo\nb\nfoo\nc';
        const anchor: CommentAnchor = {
            selectedText: 'foo',
            contextBefore: 'b\n',
            contextAfter: '\nc',
            originalLine: 4,
            textHash: hashText('foo'),
        };
        const result = relocateAnchor(content, anchor);
        expect(result.reason).toBe('context_match');
    });
});

describe('relocateAnchor - Strategy 3: Fuzzy Match', () => {
    it('relocates text with minor edits', () => {
        const original = 'function doSomething() {';
        const modified = 'function doSomethng() {'; // typo: missing 'i'
        const content = 'header\n' + modified + '\nfooter';

        const anchor: CommentAnchor = {
            selectedText: original,
            contextBefore: 'header\n',
            contextAfter: '\nfooter',
            originalLine: 2,
            textHash: hashText(original),
        };
        const result = relocateAnchor(content, anchor);
        expect(result.found).toBe(true);
        expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it('finds match within search radius', () => {
        // Insert 5 lines above; text shifted down
        const prefix = Array.from({ length: 5 }, (_, i) => `new line ${i}`).join('\n');
        const content = prefix + '\nhello world\nfooter';
        const anchor: CommentAnchor = {
            selectedText: 'hello world',
            contextBefore: '',
            contextAfter: '\nfooter',
            originalLine: 1,
            textHash: hashText('hello world'),
        };
        const result = relocateAnchor(content, anchor);
        expect(result.found).toBe(true);
    });

    it('respects minSimilarityThreshold', () => {
        const content = 'completely different text here';
        const anchor: CommentAnchor = {
            selectedText: 'zzzzzzzzzzzzz',
            contextBefore: '',
            contextAfter: '',
            originalLine: 1,
            textHash: hashText('zzzzzzzzzzzzz'),
        };
        const result = relocateAnchor(content, anchor, {
            ...DEFAULT_ANCHOR_CONFIG,
            minSimilarityThreshold: 0.99,
        });
        // Very high threshold should fail to match dissimilar text
        expect(result.reason).not.toBe('fuzzy_match');
    });
});

describe('relocateAnchor - Strategy 4: Context-Only Match', () => {
    it('relocates when text changed but context remains', () => {
        // Original: ...long prefix...OLD TEXT...long suffix...
        // Updated:  ...long prefix...NEW TEXT...long suffix...
        const prefix = 'A'.repeat(40);
        const suffix = 'B'.repeat(40);
        const content = prefix + 'COMPLETELY DIFFERENT' + suffix;

        const anchor: CommentAnchor = {
            selectedText: 'OLD TEXT',
            contextBefore: prefix,
            contextAfter: suffix,
            originalLine: 1,
            textHash: hashText('OLD TEXT'),
        };
        const result = relocateAnchor(content, anchor);
        expect(result.found).toBe(true);
        expect(result.confidence).toBe(0.5);
        expect(result.reason).toBe('context_match');
    });

    it('requires sufficient context length', () => {
        // Context too short (<= 10 chars), strategy 4 should be skipped
        const content = 'AB' + 'NEW' + 'CD';
        const anchor: CommentAnchor = {
            selectedText: 'OLD',
            contextBefore: 'AB',
            contextAfter: 'CD',
            originalLine: 1,
            textHash: hashText('OLD'),
        };
        const result = relocateAnchor(content, anchor);
        // Should NOT match via context-only (context too short)
        // May match via line fallback or not_found
        expect(result.reason).not.toBe('context_match');
    });
});

describe('relocateAnchor - Strategy 5: Line Fallback', () => {
    it('falls back to original line', () => {
        // Content completely rewritten but still has enough lines
        const content = 'xxx\nyyy\nzzz';
        const anchor: CommentAnchor = {
            selectedText: 'original text that no longer exists anywhere',
            contextBefore: 'A'.repeat(5),
            contextAfter: 'B'.repeat(5),
            originalLine: 2,
            textHash: hashText('original text that no longer exists anywhere'),
        };
        const result = relocateAnchor(content, anchor);
        expect(result.found).toBe(true);
        expect(result.confidence).toBe(0.2);
        expect(result.reason).toBe('line_fallback');
        expect(result.selection!.startLine).toBe(2);
    });

    it('fails when line no longer exists', () => {
        const content = 'only one line';
        const anchor: CommentAnchor = {
            selectedText: 'gone',
            contextBefore: 'A'.repeat(5),
            contextAfter: 'B'.repeat(5),
            originalLine: 10,
            textHash: hashText('gone'),
        };
        const result = relocateAnchor(content, anchor);
        expect(result.found).toBe(false);
        expect(result.confidence).toBe(0);
        expect(result.reason).toBe('not_found');
    });
});

describe('relocateAnchor - Edge Cases', () => {
    it('handles empty content', () => {
        const anchor: CommentAnchor = {
            selectedText: 'test',
            contextBefore: '',
            contextAfter: '',
            originalLine: 1,
            textHash: hashText('test'),
        };
        const result = relocateAnchor('', anchor);
        expect(result.found).toBe(false);
        expect(result.reason).toBe('not_found');
    });

    it('handles whitespace-only content', () => {
        const anchor: CommentAnchor = {
            selectedText: 'test',
            contextBefore: '',
            contextAfter: '',
            originalLine: 1,
            textHash: hashText('test'),
        };
        const result = relocateAnchor('   \n  \n  ', anchor);
        expect(result.found).toBe(false);
        expect(result.reason).toBe('not_found');
    });

    it('handles inserted section above anchor', () => {
        const original = 'aaa\nTARGET\nccc';
        // Insert lines above
        const modified = 'new1\nnew2\naaa\nTARGET\nccc';
        const anchor = createAnchor(original, { startLine: 2, startColumn: 1, endLine: 2, endColumn: 7 });
        const result = relocateAnchor(modified, anchor);
        expect(result.found).toBe(true);
        expect(result.selection!.startLine).toBe(4);
    });

    it('handles inserted section below anchor', () => {
        const original = 'aaa\nTARGET\nccc';
        const modified = 'aaa\nTARGET\nnew1\nnew2\nccc';
        const anchor = createAnchor(original, { startLine: 2, startColumn: 1, endLine: 2, endColumn: 7 });
        const result = relocateAnchor(modified, anchor);
        expect(result.found).toBe(true);
        expect(result.selection!.startLine).toBe(2);
    });
});

// ============================================================================
// Test Suite 5: Batch Operations
// ============================================================================

describe('batchRelocateAnchors', () => {
    it('relocates multiple anchors', () => {
        const content = 'aaa\nbbb\nccc';
        const anchors = [
            {
                id: 'a1',
                anchor: createAnchor(content, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 4 }),
                currentSelection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 4 } as CommentSelection,
            },
            {
                id: 'a2',
                anchor: createAnchor(content, { startLine: 2, startColumn: 1, endLine: 2, endColumn: 4 }),
                currentSelection: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 4 } as CommentSelection,
            },
        ];
        const results = batchRelocateAnchors(content, anchors);
        expect(results.size).toBe(2);
        expect(results.get('a1')!.found).toBe(true);
        expect(results.get('a2')!.found).toBe(true);
    });

    it('skips relocation when content unchanged', () => {
        const content = 'aaa\nbbb\nccc';
        const anchor = createAnchor(content, { startLine: 2, startColumn: 1, endLine: 2, endColumn: 4 });
        const anchors = [{
            id: 'a1',
            anchor,
            currentSelection: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 4 } as CommentSelection,
        }];
        const results = batchRelocateAnchors(content, anchors);
        expect(results.get('a1')!.confidence).toBe(1.0);
        expect(results.get('a1')!.reason).toBe('exact_match');
    });

    it('handles mixed results', () => {
        const content = 'aaa\nxxx\nccc';
        const anchor1 = createAnchor('aaa\nbbb\nccc', { startLine: 1, startColumn: 1, endLine: 1, endColumn: 4 });
        const anchor2: CommentAnchor = {
            selectedText: 'nonexistent_long_text_that_will_not_be_found',
            contextBefore: 'Q'.repeat(5),
            contextAfter: 'R'.repeat(5),
            originalLine: 99,
            textHash: hashText('nonexistent_long_text_that_will_not_be_found'),
        };
        const anchors = [
            { id: 'found', anchor: anchor1, currentSelection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 4 } as CommentSelection },
            { id: 'lost', anchor: anchor2, currentSelection: { startLine: 99, startColumn: 1, endLine: 99, endColumn: 10 } as CommentSelection },
        ];
        const results = batchRelocateAnchors(content, anchors);
        expect(results.get('found')!.found).toBe(true);
        expect(results.get('lost')!.found).toBe(false);
    });

    it('returns map keyed by id', () => {
        const content = 'test';
        const anchor = createAnchor(content, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 });
        const anchors = [{
            id: 'myId',
            anchor,
            currentSelection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 } as CommentSelection,
        }];
        const results = batchRelocateAnchors(content, anchors);
        expect(results.has('myId')).toBe(true);
    });
});

describe('needsRelocation', () => {
    it('returns false when text unchanged', () => {
        const content = 'hello world';
        const anchor = createAnchor(content, { startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 });
        const sel: CommentSelection = { startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 };
        expect(needsRelocation(content, anchor, sel)).toBe(false);
    });

    it('returns true when text changed', () => {
        const content = 'hello world';
        const anchor = createAnchor('goodbye world', { startLine: 1, startColumn: 1, endLine: 1, endColumn: 8 });
        const sel: CommentSelection = { startLine: 1, startColumn: 1, endLine: 1, endColumn: 8 };
        expect(needsRelocation(content, anchor, sel)).toBe(true);
    });
});

describe('updateAnchor', () => {
    it('creates new anchor from content and selection', () => {
        const content = 'aaa\nbbb\nccc';
        const sel: CommentSelection = { startLine: 2, startColumn: 1, endLine: 2, endColumn: 4 };
        const anchor = updateAnchor(content, sel);
        expect(anchor.selectedText).toBe('bbb');
    });

    it('preserves originalLine from existing anchor', () => {
        const content = 'aaa\nbbb\nccc';
        const sel: CommentSelection = { startLine: 3, startColumn: 1, endLine: 3, endColumn: 4 };
        const existing: CommentAnchor = {
            selectedText: 'old',
            contextBefore: '',
            contextAfter: '',
            originalLine: 1,
            textHash: hashText('old'),
        };
        const anchor = updateAnchor(content, sel, existing);
        expect(anchor.originalLine).toBe(1); // preserved from existing
        expect(anchor.selectedText).toBe('ccc'); // updated text
    });
});

// ============================================================================
// Test Suite 6: Integration Tests
// ============================================================================

describe('Integration: create → edit → relocate', () => {
    it('creates comment, edits document, relocates successfully', () => {
        const original = 'function hello() {\n  console.log("hi");\n  return true;\n}';
        const sel: CommentSelection = { startLine: 2, startColumn: 3, endLine: 2, endColumn: 20 };
        const anchor = createAnchor(original, sel);

        expect(anchor.selectedText).toBe('console.log("hi")');

        // Add a line above
        const modified = 'function hello() {\n  // added comment\n  console.log("hi");\n  return true;\n}';
        const result = relocateAnchor(modified, anchor);

        expect(result.found).toBe(true);
        expect(result.confidence).toBe(1.0);
        expect(result.selection!.startLine).toBe(3);
    });

    it('creates multiple comments, batch relocates after edits', () => {
        const original = 'const a = 1;\nconst b = 2;\nconst c = 3;';
        const anchor1 = createAnchor(original, { startLine: 1, startColumn: 7, endLine: 1, endColumn: 12 });
        const anchor2 = createAnchor(original, { startLine: 3, startColumn: 7, endLine: 3, endColumn: 12 });

        // Insert line at top
        const modified = '// header\nconst a = 1;\nconst b = 2;\nconst c = 3;';
        const anchors = [
            { id: 'c1', anchor: anchor1, currentSelection: { startLine: 1, startColumn: 7, endLine: 1, endColumn: 12 } as CommentSelection },
            { id: 'c2', anchor: anchor2, currentSelection: { startLine: 3, startColumn: 7, endLine: 3, endColumn: 12 } as CommentSelection },
        ];
        const results = batchRelocateAnchors(modified, anchors);

        expect(results.get('c1')!.found).toBe(true);
        expect(results.get('c2')!.found).toBe(true);
    });

    it('anchor survives line insertions above', () => {
        const original = 'line1\nline2\nTARGET LINE\nline4';
        const anchor = createAnchor(original, { startLine: 3, startColumn: 1, endLine: 3, endColumn: 12 });

        const modified = 'line1\nNEW\nNEW2\nline2\nTARGET LINE\nline4';
        const result = relocateAnchor(modified, anchor);
        expect(result.found).toBe(true);
        expect(result.selection!.startLine).toBe(5);
    });

    it('anchor survives line deletions above', () => {
        const original = 'line1\nline2\nline3\nTARGET LINE\nline5';
        const anchor = createAnchor(original, { startLine: 4, startColumn: 1, endLine: 4, endColumn: 12 });

        const modified = 'line1\nTARGET LINE\nline5';
        const result = relocateAnchor(modified, anchor);
        expect(result.found).toBe(true);
        expect(result.selection!.startLine).toBe(2);
    });

    it('anchor survives minor text edits in selection', () => {
        const original = 'aaa\nconst value = computeResult();\nccc';
        const anchor = createAnchor(original, { startLine: 2, startColumn: 1, endLine: 2, endColumn: 33 });

        // Minor change: computeResult → computeResults
        const modified = 'aaa\nconst value = computeResults();\nccc';
        const result = relocateAnchor(modified, anchor);
        expect(result.found).toBe(true);
        expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it('anchor fails gracefully when section deleted', () => {
        const original = 'header\nTARGET\nfooter';
        const anchor = createAnchor(original, { startLine: 2, startColumn: 1, endLine: 2, endColumn: 7 });

        // Completely different document
        const modified = 'x';
        const result = relocateAnchor(modified, anchor);
        // Either line fallback (if line 2 exists) or not_found
        if (result.found) {
            expect(result.confidence).toBeLessThanOrEqual(0.5);
        } else {
            expect(result.reason).toBe('not_found');
        }
    });
});
