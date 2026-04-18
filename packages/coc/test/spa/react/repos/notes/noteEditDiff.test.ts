/**
 * Unit tests for noteEditDiff — word-level LCS diff utility.
 *
 * Covers:
 * - Empty strings (both empty, one empty)
 * - Identical strings (all-equal)
 * - Pure insertion (oldStr is empty)
 * - Pure deletion (newStr is empty)
 * - Word substitution
 * - Partial word-level changes
 * - Merging of adjacent same-type chunks
 * - Whitespace / punctuation handling
 */

import { describe, it, expect } from 'vitest';
import { wordDiff } from '../../../../../src/server/spa/client/react/repos/notes/noteEditDiff';
import type { DiffChunk } from '../../../../../src/server/spa/client/react/repos/notes/noteEditDiff';

// ── Helpers ──────────────────────────────────────────────────────────────────

function types(chunks: DiffChunk[]) {
    return chunks.map(c => c.type);
}

function texts(chunks: DiffChunk[]) {
    return chunks.map(c => c.text);
}

function joinAdds(chunks: DiffChunk[]) {
    return chunks.filter(c => c.type === 'add').map(c => c.text).join('');
}

function joinRemoves(chunks: DiffChunk[]) {
    return chunks.filter(c => c.type === 'remove').map(c => c.text).join('');
}

function joinEquals(chunks: DiffChunk[]) {
    return chunks.filter(c => c.type === 'equal').map(c => c.text).join('');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('wordDiff', () => {
    describe('edge cases — empty strings', () => {
        it('returns [] for two empty strings', () => {
            expect(wordDiff('', '')).toEqual([]);
        });

        it('returns all-add for empty oldStr', () => {
            const chunks = wordDiff('', 'hello world');
            expect(types(chunks).every(t => t === 'add')).toBe(true);
            expect(joinAdds(chunks)).toBe('hello world');
        });

        it('returns all-remove for empty newStr', () => {
            const chunks = wordDiff('hello world', '');
            expect(types(chunks).every(t => t === 'remove')).toBe(true);
            expect(joinRemoves(chunks)).toBe('hello world');
        });
    });

    describe('equal strings', () => {
        it('returns a single equal chunk for identical strings', () => {
            const chunks = wordDiff('foo bar', 'foo bar');
            expect(chunks.length).toBe(1);
            expect(chunks[0].type).toBe('equal');
            expect(chunks[0].text).toBe('foo bar');
        });

        it('single-word identical returns one equal chunk', () => {
            const chunks = wordDiff('hello', 'hello');
            expect(chunks).toEqual([{ type: 'equal', text: 'hello' }]);
        });
    });

    describe('pure insertion', () => {
        it('appended word: marks new word as add, existing as equal', () => {
            const chunks = wordDiff('hello', 'hello world');
            const addText = joinAdds(chunks);
            const equalText = joinEquals(chunks);
            expect(equalText).toBe('hello');
            expect(addText).toContain('world');
        });

        it('prepended word: marks new word as add', () => {
            const chunks = wordDiff('world', 'hello world');
            expect(joinAdds(chunks)).toContain('hello');
            expect(joinEquals(chunks)).toContain('world');
        });
    });

    describe('pure deletion', () => {
        it('deleted trailing word: marks it as remove', () => {
            const chunks = wordDiff('hello world', 'hello');
            expect(joinRemoves(chunks)).toContain('world');
            expect(joinEquals(chunks)).toContain('hello');
        });

        it('deleted leading word: marks it as remove', () => {
            const chunks = wordDiff('hello world', 'world');
            expect(joinRemoves(chunks)).toContain('hello');
            expect(joinEquals(chunks)).toContain('world');
        });
    });

    describe('word substitution', () => {
        it('single word swap: remove old, add new', () => {
            const chunks = wordDiff('foo bar baz', 'foo qux baz');
            expect(joinRemoves(chunks)).toContain('bar');
            expect(joinAdds(chunks)).toContain('qux');
            expect(joinEquals(chunks)).toContain('foo');
            expect(joinEquals(chunks)).toContain('baz');
        });

        it('entire string replaced: all remove + all add', () => {
            const chunks = wordDiff('hello', 'goodbye');
            const removeTypes = chunks.filter(c => c.type === 'remove');
            const addTypes = chunks.filter(c => c.type === 'add');
            expect(removeTypes.length).toBeGreaterThan(0);
            expect(addTypes.length).toBeGreaterThan(0);
            expect(joinRemoves(chunks)).toBe('hello');
            expect(joinAdds(chunks)).toBe('goodbye');
        });
    });

    describe('merging adjacent same-type chunks', () => {
        it('consecutive equal tokens are merged into one chunk', () => {
            const chunks = wordDiff('the quick brown fox', 'the quick brown fox');
            // All equal — should be a single merged chunk
            expect(chunks.length).toBe(1);
            expect(chunks[0].type).toBe('equal');
        });

        it('does not produce two consecutive chunks of the same type', () => {
            const chunks = wordDiff('a b c', 'a x c');
            for (let i = 1; i < chunks.length; i++) {
                expect(chunks[i].type).not.toBe(chunks[i - 1].type);
            }
        });
    });

    describe('multi-word changes', () => {
        it('change in the middle preserves context around it', () => {
            const old = 'The quick brown fox jumps over the lazy dog';
            const next = 'The slow green fox jumps over the lazy dog';
            const chunks = wordDiff(old, next);
            expect(joinRemoves(chunks)).toContain('quick');
            expect(joinRemoves(chunks)).toContain('brown');
            expect(joinAdds(chunks)).toContain('slow');
            expect(joinAdds(chunks)).toContain('green');
            expect(joinEquals(chunks)).toContain('fox');
        });
    });

    describe('reconstruction invariant', () => {
        it('equal + add chunks reconstruct newStr', () => {
            const pairs = [
                ['old text here', 'new text here'],
                ['hello world', 'hello beautiful world'],
                ['foo bar baz', 'foo qux baz'],
                ['', 'something'],
                ['something', ''],
            ] as const;
            for (const [old, next] of pairs) {
                const chunks = wordDiff(old, next);
                const reconstructed = chunks
                    .filter(c => c.type !== 'remove')
                    .map(c => c.text)
                    .join('');
                expect(reconstructed).toBe(next);
            }
        });

        it('equal + remove chunks reconstruct oldStr', () => {
            const pairs = [
                ['old text here', 'new text here'],
                ['hello world', 'hello beautiful world'],
            ] as const;
            for (const [old, next] of pairs) {
                const chunks = wordDiff(old, next);
                const reconstructed = chunks
                    .filter(c => c.type !== 'add')
                    .map(c => c.text)
                    .join('');
                expect(reconstructed).toBe(old);
            }
        });
    });

    describe('punctuation and whitespace', () => {
        it('handles punctuation as separate tokens', () => {
            const chunks = wordDiff('hello, world!', 'hello, earth!');
            expect(joinRemoves(chunks)).toContain('world');
            expect(joinAdds(chunks)).toContain('earth');
        });

        it('handles multiple spaces (whitespace preserved)', () => {
            const chunks = wordDiff('a  b', 'a  b');
            expect(chunks.length).toBe(1);
            expect(chunks[0].type).toBe('equal');
            expect(chunks[0].text).toBe('a  b');
        });
    });
});
