/**
 * Tests for the composer English word hint's pure logic.
 */

import { describe, it, expect } from 'vitest';
import {
    buildWordHintDictionary,
    computeWordHint,
    MAX_WORD_HINT_CANDIDATES,
    MIN_WORD_HINT_GAIN,
    MIN_WORD_HINT_PREFIX,
} from '../../../../src/server/spa/client/react/utils/wordHint';
import { ENGLISH_WORDS } from '../../../../src/server/spa/client/react/data/english-words';

// Frequency order: earlier = more common.
const dict = buildWordHintDictionary([
    'the', 'there', 'their', 'then',
    'algorithm', 'algorithms',
    'tomorrow',
    'yesterday',
    'cats',
    'catsup',
    'concert', 'control', 'contact',
].join('\n'));

const hint = (text: string, cursorPos = text.length) => computeWordHint(text, cursorPos, dict);

describe('computeWordHint', () => {
    it('exports the tuning constants', () => {
        expect(MAX_WORD_HINT_CANDIDATES).toBe(2);
        expect(MIN_WORD_HINT_PREFIX).toBe(3);
        expect(MIN_WORD_HINT_GAIN).toBe(2);
    });

    it('returns empty for prefixes shorter than 3 letters', () => {
        expect(hint('to')).toBe('');
        expect(hint('fix to')).toBe('');
    });

    it('returns empty when more than 2 words match', () => {
        expect(hint('con')).toBe('');
        expect(hint('the')).toBe('');
    });

    it('completes a single match', () => {
        expect(hint('see you tomo')).toBe('rrow');
        expect(hint('yest')).toBe('erday');
    });

    it('picks the best-ranked word among 2 matches', () => {
        expect(hint('run the algo')).toBe('rithm');
    });

    it('returns empty when the gain is under 2 letters', () => {
        expect(hint('algorith')).toBe('');
        expect(hint('tomorro')).toBe('');
    });

    it('returns empty when the typed text is already a word', () => {
        expect(hint('cats')).toBe('');
        expect(hint('algorithm')).toBe('');
    });

    it('returns empty when the cursor is not at the end', () => {
        expect(hint('tomo', 2)).toBe('');
    });

    it.each(['/tomo', '@tomo', '#tomo', 'a.tomo', 'snake_tomo', 'x-tomo', 'see `tomo', 'tomo1'])(
        'skips non-prose context %s',
        (text) => { expect(hint(text)).toBe(''); },
    );

    it('allows start, whitespace, paren, and quote before the word', () => {
        expect(hint('tomo')).toBe('rrow');
        expect(hint('say\ntomo')).toBe('rrow');
        expect(hint('(tomo')).toBe('rrow');
        expect(hint('"tomo')).toBe('rrow');
        expect(hint("'tomo")).toBe('rrow');
    });

    it('allows words after a closed backtick span', () => {
        expect(hint('run `x` tomo')).toBe('rrow');
    });

    it('matches the typed casing', () => {
        expect(hint('Tomo')).toBe('rrow');
        expect(hint('TOMO')).toBe('RROW');
        expect(hint('ToMo')).toBe('rrow');
    });
});

describe('bundled English word list', () => {
    const real = buildWordHintDictionary(ENGLISH_WORDS);

    it('loads thousands of lowercase words ranked by frequency', () => {
        expect(real.sorted.length).toBeGreaterThan(9000);
        expect(real.rank.get('the')).toBe(0);
        expect(real.sorted.every(w => /^[a-z]+$/.test(w))).toBe(true);
    });

    it('hints only for narrow prefixes', () => {
        expect(computeWordHint('see you tomo', 12, real)).toBe('rrow');
        expect(computeWordHint('the', 3, real)).toBe('');
        expect(computeWordHint('con', 3, real)).toBe('');
        expect(computeWordHint('Impl', 4, real)).toBe(''); // 7 matches
    });
});
