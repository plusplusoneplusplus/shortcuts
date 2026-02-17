/**
 * Tests for the anchor utilities extracted to pipeline-core.
 *
 * Covers all 5 relocation strategies, anchor creation, text extraction,
 * relocation-check detection, and batch relocation.
 */

import { describe, it, expect } from 'vitest';
import {
    extractTextFromSelection,
    createAnchorData,
    relocateAnchorPosition,
    needsRelocationCheck,
    batchRelocateAnchors,
    BaseAnchorData,
    AnchorRelocationResult
} from '../../src/editor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAMPLE_CONTENT = [
    'line one',           // line 1
    'line two',           // line 2
    'line three',         // line 3
    'line four',          // line 4
    'line five'           // line 5
].join('\n');

// Larger document for context-based tests
function makeLargeDoc(uniqueLine: string): string {
    const padding = Array.from({ length: 20 }, (_, i) => `padding line ${i + 1}`);
    return [...padding, uniqueLine, ...padding].join('\n');
}

// ---------------------------------------------------------------------------
// extractTextFromSelection
// ---------------------------------------------------------------------------

describe('extractTextFromSelection', () => {
    it('extracts single-line text', () => {
        const text = extractTextFromSelection(SAMPLE_CONTENT, 2, 2, 6, 9);
        // "line two" → columns 6..8 (1-based, exclusive end) = "two"
        expect(text).toBe('two');
    });

    it('extracts full single line', () => {
        const text = extractTextFromSelection(SAMPLE_CONTENT, 1, 1, 1, 9);
        expect(text).toBe('line one');
    });

    it('extracts multi-line text', () => {
        const text = extractTextFromSelection(SAMPLE_CONTENT, 1, 3, 6, 6);
        // line 1 from col 6 → "one"
        // line 2 full       → "line two"
        // line 3 up to col 5 → "line "
        expect(text).toBe('one\nline two\nline ');
    });

    it('handles column offsets at line boundaries', () => {
        const text = extractTextFromSelection(SAMPLE_CONTENT, 2, 2, 1, 5);
        expect(text).toBe('line');
    });

    it('handles missing lines gracefully', () => {
        const text = extractTextFromSelection(SAMPLE_CONTENT, 10, 10, 1, 5);
        // line 10 doesn't exist → empty string
        expect(text).toBe('');
    });
});

// ---------------------------------------------------------------------------
// createAnchorData
// ---------------------------------------------------------------------------

describe('createAnchorData', () => {
    it('creates anchor with correct selected text', () => {
        const anchor = createAnchorData(SAMPLE_CONTENT, 2, 2, 6, 9);
        expect(anchor.selectedText).toBe('two');
    });

    it('records original line', () => {
        const anchor = createAnchorData(SAMPLE_CONTENT, 3, 3, 1, 11);
        expect(anchor.originalLine).toBe(3);
    });

    it('generates a non-empty text hash', () => {
        const anchor = createAnchorData(SAMPLE_CONTENT, 1, 1, 1, 9);
        expect(anchor.textHash).toBeTruthy();
        expect(typeof anchor.textHash).toBe('string');
    });

    it('captures context strings', () => {
        const doc = makeLargeDoc('>>> TARGET LINE <<<');
        const lineIndex = doc.split('\n').indexOf('>>> TARGET LINE <<<') + 1;
        const anchor = createAnchorData(doc, lineIndex, lineIndex, 1, 20);
        expect(anchor.contextBefore.length).toBeGreaterThan(0);
        expect(anchor.contextAfter.length).toBeGreaterThan(0);
    });

    it('produces identical hashes for identical text', () => {
        const a1 = createAnchorData(SAMPLE_CONTENT, 1, 1, 1, 9);
        const a2 = createAnchorData(SAMPLE_CONTENT, 1, 1, 1, 9);
        expect(a1.textHash).toBe(a2.textHash);
    });
});

// ---------------------------------------------------------------------------
// relocateAnchorPosition — 5 strategies
// ---------------------------------------------------------------------------

describe('relocateAnchorPosition', () => {
    // Strategy 1: Exact text match (single occurrence)
    describe('strategy 1: exact match', () => {
        it('finds unique text with confidence 1.0', () => {
            const anchor = createAnchorData(SAMPLE_CONTENT, 3, 3, 1, 11);
            // Content unchanged
            const result = relocateAnchorPosition(SAMPLE_CONTENT, anchor);
            expect(result.found).toBe(true);
            expect(result.confidence).toBe(1.0);
            expect(result.reason).toBe('exact_match');
            expect(result.startLine).toBe(3);
        });

        it('finds text that moved to a different line', () => {
            const anchor = createAnchorData(SAMPLE_CONTENT, 3, 3, 1, 11);
            // Insert a blank line before line 3
            const newContent = SAMPLE_CONTENT.replace('line three', 'NEW LINE\nline three');
            const result = relocateAnchorPosition(newContent, anchor);
            expect(result.found).toBe(true);
            expect(result.confidence).toBe(1.0);
            expect(result.reason).toBe('exact_match');
            expect(result.startLine).toBe(4); // shifted down
        });
    });

    // Strategy 2: Context-disambiguated exact match (multiple occurrences)
    describe('strategy 2: context-disambiguated match', () => {
        it('disambiguates duplicate text using context', () => {
            // Document with repeated "DUPLICATE" text in different contexts
            const doc = [
                'aaa bbb ccc',
                'DUPLICATE',
                'ddd eee fff',
                '---',
                'xxx yyy zzz',
                'DUPLICATE',
                'mmm nnn ooo'
            ].join('\n');

            // Anchor created at the first occurrence (line 2)
            const anchor = createAnchorData(doc, 2, 2, 1, 10);
            const result = relocateAnchorPosition(doc, anchor);
            expect(result.found).toBe(true);
            expect(result.startLine).toBe(2);
            expect(result.reason).toBe('context_match');
            expect(result.confidence).toBeGreaterThanOrEqual(0.6);
        });
    });

    // Strategy 3: Fuzzy match near original location
    describe('strategy 3: fuzzy match', () => {
        it('finds slightly edited text', () => {
            const original = 'function calculateTotal(items) {';
            const doc = makeLargeDoc(original);
            const lineIdx = doc.split('\n').indexOf(original) + 1;
            const anchor = createAnchorData(doc, lineIdx, lineIdx, 1, original.length + 1);

            // Slightly modify the text
            const modified = doc.replace(original, 'function calculateTotals(items) {');
            const result = relocateAnchorPosition(modified, anchor);
            expect(result.found).toBe(true);
            expect(result.reason).toBe('fuzzy_match');
            expect(result.confidence).toBeGreaterThanOrEqual(0.6);
        });
    });

    // Strategy 4: Context-only match
    describe('strategy 4: context-only match', () => {
        it('locates position when text is replaced but context remains', () => {
            // Build a document with long enough context (>10 chars around selection)
            const beforeCtx = 'This is a sentence with long enough context before the target.';
            const target = 'THE ORIGINAL TARGET TEXT';
            const afterCtx = 'And here is sufficiently long context that follows the target.';
            const doc = `${beforeCtx} ${target} ${afterCtx}`;

            // Create anchor
            const startCol = beforeCtx.length + 2; // +2 for the space
            const endCol = startCol + target.length;
            const anchor = createAnchorData(doc, 1, 1, startCol, endCol);

            // Replace target text entirely while keeping context
            const newDoc = doc.replace(target, 'COMPLETELY DIFFERENT REPLACEMENT');
            const result = relocateAnchorPosition(newDoc, anchor);
            expect(result.found).toBe(true);
            expect(result.reason).toBe('context_match');
            expect(result.confidence).toBe(0.5);
        });
    });

    // Strategy 5: Line fallback
    describe('strategy 5: line fallback', () => {
        it('falls back to original line when nothing else matches', () => {
            const anchor: BaseAnchorData = {
                selectedText: 'text_that_does_not_exist_anywhere_xyz123',
                contextBefore: 'ab',
                contextAfter: 'cd',
                originalLine: 2,
                textHash: 'fakehash'
            };

            const result = relocateAnchorPosition(SAMPLE_CONTENT, anchor);
            expect(result.found).toBe(true);
            expect(result.reason).toBe('line_fallback');
            expect(result.confidence).toBe(0.2);
            expect(result.startLine).toBe(2);
            expect(result.endLine).toBe(2);
            expect(result.startColumn).toBe(1);
        });
    });

    // Not found
    describe('not found', () => {
        it('returns not_found for empty content', () => {
            const anchor = createAnchorData(SAMPLE_CONTENT, 1, 1, 1, 5);
            const result = relocateAnchorPosition('', anchor);
            expect(result.found).toBe(false);
            expect(result.reason).toBe('not_found');
            expect(result.confidence).toBe(0);
        });

        it('returns not_found when original line exceeds content', () => {
            const anchor: BaseAnchorData = {
                selectedText: 'unique_nonexistent_text_abc',
                contextBefore: 'x',
                contextAfter: 'y',
                originalLine: 100,
                textHash: 'fake'
            };
            const result = relocateAnchorPosition('short\ndoc', anchor);
            expect(result.found).toBe(false);
            expect(result.reason).toBe('not_found');
        });
    });
});

// ---------------------------------------------------------------------------
// needsRelocationCheck
// ---------------------------------------------------------------------------

describe('needsRelocationCheck', () => {
    it('returns false when text at position is unchanged', () => {
        const anchor = createAnchorData(SAMPLE_CONTENT, 2, 2, 1, 9);
        const needs = needsRelocationCheck(SAMPLE_CONTENT, anchor, 2, 2, 1, 9);
        expect(needs).toBe(false);
    });

    it('returns true when text at position has changed', () => {
        const anchor = createAnchorData(SAMPLE_CONTENT, 2, 2, 1, 9);
        const newContent = SAMPLE_CONTENT.replace('line two', 'line TWO');
        const needs = needsRelocationCheck(newContent, anchor, 2, 2, 1, 9);
        expect(needs).toBe(true);
    });

    it('returns true when line shifted', () => {
        const anchor = createAnchorData(SAMPLE_CONTENT, 2, 2, 1, 9);
        // Insert a line before → original text at line 2 is now different
        const newContent = 'inserted\n' + SAMPLE_CONTENT;
        const needs = needsRelocationCheck(newContent, anchor, 2, 2, 1, 9);
        expect(needs).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// batchRelocateAnchors
// ---------------------------------------------------------------------------

describe('batchRelocateAnchors', () => {
    it('relocates multiple anchors in one call', () => {
        const anchor1 = createAnchorData(SAMPLE_CONTENT, 1, 1, 1, 9);
        const anchor2 = createAnchorData(SAMPLE_CONTENT, 3, 3, 1, 11);

        const anchors = new Map<string, BaseAnchorData>();
        anchors.set('a1', anchor1);
        anchors.set('a2', anchor2);

        const results = batchRelocateAnchors(SAMPLE_CONTENT, anchors);
        expect(results.size).toBe(2);
        expect(results.get('a1')!.found).toBe(true);
        expect(results.get('a2')!.found).toBe(true);
    });

    it('handles mixed found/not-found results', () => {
        const anchor1 = createAnchorData(SAMPLE_CONTENT, 1, 1, 1, 9);
        const anchor2: BaseAnchorData = {
            selectedText: 'nonexistent_xyz_text',
            contextBefore: '',
            contextAfter: '',
            originalLine: 999,
            textHash: 'fake'
        };

        const anchors = new Map<string, BaseAnchorData>();
        anchors.set('found', anchor1);
        anchors.set('missing', anchor2);

        const results = batchRelocateAnchors(SAMPLE_CONTENT, anchors);
        expect(results.get('found')!.found).toBe(true);
        expect(results.get('missing')!.found).toBe(false);
    });

    it('returns empty map for empty input', () => {
        const results = batchRelocateAnchors(SAMPLE_CONTENT, new Map());
        expect(results.size).toBe(0);
    });
});
