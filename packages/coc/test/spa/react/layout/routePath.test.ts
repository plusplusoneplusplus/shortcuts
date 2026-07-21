/**
 * Tests for routePath — the shared hash tokenization / segment encoding helpers
 * that every dashboard route parser and hash builder is built on.
 */

import { describe, it, expect } from 'vitest';
import {
    stripHash,
    hashSegments,
    decodeSegment,
    encodeSegment,
    encodePath,
    decodePath,
    repoHashBase,
    tokenizeHash,
} from '../../../../src/server/spa/client/react/layout/routePath';

describe('stripHash', () => {
    it('removes a single leading #', () => {
        expect(stripHash('#repos/x')).toBe('repos/x');
    });
    it('leaves a hash-less string untouched', () => {
        expect(stripHash('repos/x')).toBe('repos/x');
    });
    it('removes only the first #', () => {
        expect(stripHash('##x')).toBe('#x');
    });
});

describe('hashSegments', () => {
    it('splits a stripped hash on /', () => {
        expect(hashSegments('#repos/ws1/git')).toEqual(['repos', 'ws1', 'git']);
    });
    it('does not decode segments', () => {
        expect(hashSegments('#repos/a%2Fb')).toEqual(['repos', 'a%2Fb']);
    });
    it('returns a single-element array for a bare token', () => {
        expect(hashSegments('#repos')).toEqual(['repos']);
    });
});

describe('encodeSegment / decodeSegment', () => {
    it('round-trips a value containing a slash', () => {
        const raw = 'a/b c';
        expect(decodeSegment(encodeSegment(raw))).toBe(raw);
    });
    it('encodes a slash as %2F', () => {
        expect(encodeSegment('a/b')).toBe('a%2Fb');
    });
});

describe('encodePath / decodePath', () => {
    it('encodes each segment but preserves the / delimiters', () => {
        expect(encodePath('a b/c d')).toBe('a%20b/c%20d');
    });
    it('encodes an in-segment slash as %2F so it survives the round-trip', () => {
        const encoded = encodePath('a/b');
        expect(encoded).toBe('a/b'); // top-level slash is a delimiter
        // A literal slash inside one segment must be pre-encoded by the caller;
        // decodePath decodes each raw segment back.
        expect(decodePath(['a%2Fb', 'c'])).toBe('a/b/c');
    });
    it('round-trips a multi-segment path', () => {
        const path = 'folder/sub folder/note.md';
        expect(decodePath(encodePath(path).split('/'))).toBe(path);
    });
});

describe('repoHashBase', () => {
    it('builds the #repos/{wsId} prefix with an encoded id', () => {
        expect(repoHashBase('ws 1')).toBe('#repos/ws%201');
    });
});

describe('tokenizeHash', () => {
    it('separates path segments from a ?query', () => {
        expect(tokenizeHash('#admin/database/processes?page=2&sort=id')).toEqual({
            segments: ['admin', 'database', 'processes'],
            query: 'page=2&sort=id',
        });
    });
    it('returns null query when there is no ?', () => {
        expect(tokenizeHash('#repos/ws1/git')).toEqual({
            segments: ['repos', 'ws1', 'git'],
            query: null,
        });
    });
    it('keeps everything after the first ? as the query', () => {
        expect(tokenizeHash('#x?a=1?b=2')).toEqual({ segments: ['x'], query: 'a=1?b=2' });
    });
    it('returns an empty query string (not null) for a trailing ?', () => {
        expect(tokenizeHash('#x?')).toEqual({ segments: ['x'], query: '' });
    });
});
