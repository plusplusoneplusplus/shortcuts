import { describe, it, expect } from 'vitest';
import { createTextAnchor, resolveAnchor, resolveAnchors } from
    '../../../../src/server/spa/client/react/features/notes/editor/textAnchor';

describe('createTextAnchor', () => {
    const text = 'The quick brown fox jumps over the lazy dog';

    it('captures quoted text, prefix, and suffix', () => {
        const anchor = createTextAnchor(text, 10, 19);
        expect(anchor.quotedText).toBe('brown fox');
        expect(anchor.prefix).toBe('The quick ');
        expect(anchor.suffix).toBe(' jumps over the lazy dog');
    });

    it('clamps prefix at document start', () => {
        const anchor = createTextAnchor(text, 4, 9, 50);
        expect(anchor.prefix).toBe('The ');
        expect(anchor.prefix.length).toBe(4);
        expect(anchor.quotedText).toBe('quick');
    });

    it('clamps suffix at document end', () => {
        const anchor = createTextAnchor(text, 35, 43, 50);
        expect(anchor.quotedText).toBe('lazy dog');
        expect(anchor.suffix).toBe('');
        expect(anchor.suffix.length).toBeLessThan(50);
    });

    it('respects custom contextLength', () => {
        const anchor = createTextAnchor(text, 10, 19, 10);
        expect(anchor.prefix.length).toBeLessThanOrEqual(10);
        expect(anchor.suffix.length).toBeLessThanOrEqual(10);
        expect(anchor.prefix).toBe('The quick ');
        expect(anchor.suffix).toBe(' jumps ove');
    });

    it('empty selection (from === to)', () => {
        const anchor = createTextAnchor(text, 5, 5);
        expect(anchor.quotedText).toBe('');
    });
});

describe('resolveAnchor', () => {
    it('exact match — unchanged document', () => {
        const text = 'The quick brown fox jumps over the lazy dog';
        const anchor = createTextAnchor(text, 10, 19);
        const match = resolveAnchor(text, anchor);
        expect(match.confidence).toBe('exact');
        expect(match.from).toBe(10);
        expect(match.to).toBe(19);
    });

    it('exact match — text shifted by prepended content', () => {
        const text = 'The quick brown fox jumps over the lazy dog';
        const anchor = createTextAnchor(text, 10, 19);
        const shifted = '12345678901234567890' + text;
        const match = resolveAnchor(shifted, anchor);
        expect(match.confidence).toBe('exact');
        expect(match.from).toBe(30);
        expect(match.to).toBe(39);
        expect(shifted.slice(match.from, match.to)).toBe('brown fox');
    });

    it('exact match — disambiguates duplicates via prefix', () => {
        const text = 'foo bar baz foo bar baz foo bar baz';
        // Three occurrences of "foo". Create anchor for the second one (index 12).
        const anchor = createTextAnchor(text, 12, 15);
        expect(anchor.quotedText).toBe('foo');
        const match = resolveAnchor(text, anchor);
        expect(match.confidence).toBe('exact');
        expect(match.from).toBe(12);
        expect(match.to).toBe(15);
    });

    it('fuzzy match — minor edit inside quoted text', () => {
        const text = 'The quick brown fox jumps over the lazy dog near the river bank';
        const anchor = createTextAnchor(text, 10, 33); // 'brown fox jumps over the'
        // Change 1 char: 'brown' → 'brawn'
        const edited = 'The quick brawn fox jumps over the lazy dog near the river bank';
        const match = resolveAnchor(edited, anchor);
        expect(match.confidence).toBe('fuzzy');
        expect(match.from).toBeGreaterThanOrEqual(8);
        expect(match.to).toBeLessThanOrEqual(36);
    });

    it('fuzzy match — quoted text partially deleted', () => {
        const original = 'XYZXYZ removed_words but the rest of this text segment is preserved exactly as it was before XYZXYZ';
        const anchor = createTextAnchor(original, 7, 91);
        // 'removed_words but ' is stripped — a long contiguous tail remains
        const edited = 'XYZXYZ the rest of this text segment is preserved exactly as it was before XYZXYZ';
        const match = resolveAnchor(edited, anchor);
        expect(match.confidence).toBe('fuzzy');
    });

    it('orphaned — text fully removed', () => {
        const text = 'The quick brown fox jumps over the lazy dog';
        const anchor = createTextAnchor(text, 10, 19);
        const rewritten = 'Nothing relevant remains in this document';
        const match = resolveAnchor(rewritten, anchor);
        expect(match.confidence).toBe('orphaned');
        expect(match.from).toBe(-1);
        expect(match.to).toBe(-1);
    });

    it('orphaned — document completely rewritten', () => {
        const text = 'Alpha beta gamma delta epsilon zeta';
        const anchor = createTextAnchor(text, 6, 16);
        const rewritten = '1234567890 xyz abc!';
        const match = resolveAnchor(rewritten, anchor);
        expect(match.confidence).toBe('orphaned');
        expect(match.from).toBe(-1);
    });
});

describe('resolveAnchors', () => {
    it('resolves multiple non-overlapping anchors', () => {
        const text = 'AAA BBB CCC DDD EEE FFF GGG';
        const a1 = createTextAnchor(text, 0, 3);   // AAA
        const a2 = createTextAnchor(text, 8, 11);  // CCC
        const a3 = createTextAnchor(text, 20, 23); // FFF

        const result = resolveAnchors(text, [
            { threadId: 't1', anchor: a1 },
            { threadId: 't2', anchor: a2 },
            { threadId: 't3', anchor: a3 },
        ]);

        expect(result.size).toBe(3);
        expect(result.get('t1')!.confidence).toBe('exact');
        expect(result.get('t2')!.confidence).toBe('exact');
        expect(result.get('t3')!.confidence).toBe('exact');
    });

    it('handles overlapping anchors — first wins, second orphaned or shifted', () => {
        // Both anchors target the same word
        const text = 'unique_word is here';
        const a1 = createTextAnchor(text, 0, 11); // 'unique_word'
        const a2 = createTextAnchor(text, 0, 11); // same range

        const result = resolveAnchors(text, [
            { threadId: 't1', anchor: a1 },
            { threadId: 't2', anchor: a2 },
        ]);

        expect(result.size).toBe(2);
        const m1 = result.get('t1')!;
        const m2 = result.get('t2')!;
        expect(m1.confidence).toBe('exact');
        expect(m1.from).toBe(0);
        // Second one should be orphaned since it overlaps and can't re-resolve
        expect(m2.confidence).toBe('orphaned');
    });

    it('empty input returns empty map', () => {
        const result = resolveAnchors('some text', []);
        expect(result.size).toBe(0);
    });
});
