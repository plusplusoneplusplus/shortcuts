/**
 * Git route validator / result-mapper tests.
 *
 * These encode the error taxonomy the git REST routes rely on: `MISSING_FIELDS`
 * for absent input, 400 `Missing or invalid hash` for malformed hashes, and the
 * 409 dirty/conflict response bodies.
 *
 * Pure functions — no HTTP. Cross-platform compatible.
 */

import { describe, it, expect } from 'vitest';
import {
    collectStrings,
    conflictResponseFor,
    isGitHash,
    optionalTrimmedString,
    pickEnum,
    requireHash,
    requireHashList,
    requireNonBlankString,
    requireString,
} from '../../src/server/git/git-request-validators';

describe('isGitHash', () => {
    it.each([
        ['abcd', true],
        ['ABCDEF12', true],
        ['a'.repeat(40), true],
        ['abc', false],
        ['a'.repeat(41), false],
        ['zzzz', false],
        [1234, false],
    ])('%s → %s', (value, expected) => {
        expect(isGitHash(value)).toBe(expected);
    });
});

describe('requireString', () => {
    it('returns the value untrimmed', () => {
        expect(requireString({ name: ' feature ' }, 'name')).toBe(' feature ');
    });

    it('throws MISSING_FIELDS for absent, empty, and non-string values', () => {
        for (const body of [{}, { name: '' }, { name: 5 }, { name: null }, undefined]) {
            expect(() => requireString(body, 'name')).toThrowError(/Missing required fields: name/);
        }
    });

    it('reports the offending field name in details', () => {
        try {
            requireString({}, 'branch');
            expect.unreachable('should have thrown');
        } catch (err: any) {
            expect(err.statusCode).toBe(400);
            expect(err.code).toBe('MISSING_FIELDS');
            expect(err.details).toEqual({ fields: ['branch'] });
        }
    });
});

describe('requireNonBlankString', () => {
    it('accepts a value with surrounding whitespace and returns it unchanged', () => {
        expect(requireNonBlankString({ title: '  fix: thing  ' }, 'title')).toBe('  fix: thing  ');
    });

    it('rejects whitespace-only values', () => {
        expect(() => requireNonBlankString({ title: '   ' }, 'title')).toThrowError(/Missing required fields: title/);
    });
});

describe('requireHash', () => {
    it('trims and returns a valid hash', () => {
        expect(requireHash({ hash: '  abc123  ' }, 'hash')).toBe('abc123');
    });

    it('throws MISSING_FIELDS when absent', () => {
        expect(() => requireHash({}, 'hash')).toThrowError(/Missing required fields: hash/);
    });

    it('throws 400 "Missing or invalid hash" when malformed', () => {
        expect(() => requireHash({ hash: 'not-a-hash' }, 'hash')).toThrowError('Missing or invalid hash');
    });
});

describe('requireHashList', () => {
    it('trims entries and preserves order', () => {
        expect(requireHashList([' aaaa ', 'BBBB'], 'hashes')).toEqual(['aaaa', 'BBBB']);
    });

    it('throws MISSING_FIELDS when the list has no usable entries', () => {
        expect(() => requireHashList([], 'hashes')).toThrowError(/Missing required fields: hashes/);
        expect(() => requireHashList(['', '   ', 7], 'hashes')).toThrowError(/Missing required fields: hashes/);
    });

    it('throws 400 when any entry is not a hash', () => {
        expect(() => requireHashList(['aaaa', 'nope!'], 'hashes')).toThrowError('Missing or invalid hash');
    });
});

describe('collectStrings', () => {
    it('keeps only trimmed non-empty strings', () => {
        expect(collectStrings([' a ', '', 3, null, 'b'])).toEqual(['a', 'b']);
    });

    it('returns an empty array for non-arrays', () => {
        expect(collectStrings('abc')).toEqual([]);
        expect(collectStrings(undefined)).toEqual([]);
    });
});

describe('optionalTrimmedString', () => {
    it('trims, and returns undefined for blanks and non-strings', () => {
        expect(optionalTrimmedString('  main ')).toBe('main');
        expect(optionalTrimmedString('   ')).toBeUndefined();
        expect(optionalTrimmedString(12)).toBeUndefined();
    });
});

describe('pickEnum', () => {
    const MODES = ['hard', 'soft', 'mixed'] as const;

    it('accepts allow-listed values', () => {
        expect(pickEnum('soft', MODES, 'hard')).toBe('soft');
    });

    it('falls back for unknown, absent, and non-string values', () => {
        expect(pickEnum('nuclear', MODES, 'hard')).toBe('hard');
        expect(pickEnum(undefined, MODES, 'hard')).toBe('hard');
        expect(pickEnum(3, MODES, 'hard')).toBe('hard');
    });
});

describe('conflictResponseFor', () => {
    it('maps a dirty failure to a 409 with dirty: true', () => {
        expect(conflictResponseFor({ success: false, dirty: true, message: 'uncommitted changes' }))
            .toEqual({ status: 409, payload: { error: 'uncommitted changes', dirty: true } });
    });

    it('maps a conflicted failure to a 409 with conflicts: true', () => {
        expect(conflictResponseFor({ success: false, conflicts: true, message: 'conflict in a.ts' }))
            .toEqual({ status: 409, payload: { error: 'conflict in a.ts', conflicts: true } });
    });

    it('prefers dirty over conflicts when both are set', () => {
        const response = conflictResponseFor({ success: false, dirty: true, conflicts: true, message: 'x' });
        expect(response?.payload).toEqual({ error: 'x', dirty: true });
    });

    it('merges branch-specific extras into the payload', () => {
        expect(conflictResponseFor(
            { success: false, conflicts: true, message: 'conflict' },
            { dirty: { stashed: false }, conflicts: { stashed: true, appliedCount: 2 } },
        )).toEqual({ status: 409, payload: { error: 'conflict', conflicts: true, stashed: true, appliedCount: 2 } });
    });

    it('returns undefined for a plain failure so the caller can pick its own status', () => {
        expect(conflictResponseFor({ success: false, message: 'bad ref' })).toBeUndefined();
    });
});
