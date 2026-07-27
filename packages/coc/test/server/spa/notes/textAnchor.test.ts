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

describe('resolveAnchor — bounded fuzzy on large inputs', () => {
    // Regression guard: an unbounded fuzzy scan over a large document with a long,
    // drifted quote (no exact/hint match, so it falls into the full-document
    // sliding-window LCS) is O(chars × windows × window × quote) — billions of ops
    // that pegged the main thread for seconds and froze the paper reader when
    // PdfAnnotationsLayer re-resolved annotations against a pdf.js text layer.
    // The work budget must keep it fast; here we assert it returns promptly rather
    // than hanging.
    it('resolves a long non-matching quote over a large document without stalling', () => {
        // ~80k chars of text that shares no long run with the quote.
        const bigText = 'lorem ipsum dolor sit amet consectetur '.repeat(2048);
        // Long quote, absent from the text; empty prefix forces the (worst-case)
        // full-document scan rather than the hint-guided one.
        const anchor = { quotedText: 'qwerty '.repeat(40).trim(), prefix: '', suffix: '' };

        const start = Date.now();
        const match = resolveAnchor(bigText, anchor);
        const elapsedMs = Date.now() - start;

        // Bounded: tens of ms in practice; the pre-fix path took many seconds.
        expect(elapsedMs).toBeLessThan(2000);
        expect(['fuzzy', 'orphaned']).toContain(match.confidence);
    });

    it('still fuzzy-matches a drifted quote inside a large document (budget is generous)', () => {
        // Distinct, non-repetitive surrounding text so the prefix's 8-char hints are
        // rare — the hint-guided scan lands on the real region and completes within
        // the budget, exactly like a normal annotation quote in a paper's text.
        const before = Array.from({ length: 150 }, (_, i) => `Sentence ${i} explores a distinct unrelated subject.`).join(' ');
        const after = Array.from({ length: 150 }, (_, i) => `Clause ${i} mentions another separate matter.`).join(' ');
        const quote = 'gradient checkpointing trades compute';
        const doc = `${before} ${quote} for memory ${after}`;
        const from = doc.indexOf(quote);
        const anchor = createTextAnchor(doc, from, from + quote.length);

        // Drift one word inside the quote; the passage still resolves fuzzily.
        const driftedQuote = quote.replace('trades', 'swaps');
        const driftedDoc = `${before} ${driftedQuote} for memory ${after}`;

        const match = resolveAnchor(driftedDoc, anchor);
        expect(match.confidence).toBe('fuzzy');
        // Lands on the drifted passage near the before/quote boundary, not deep in
        // the filler (the window may start a few chars into the trailing prefix).
        expect(match.from).toBeGreaterThan(before.length - 60);
        expect(match.from).toBeLessThan(before.length + quote.length + 40);
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
