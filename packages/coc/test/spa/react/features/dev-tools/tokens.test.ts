/**
 * UUID / token generation — pure logic, no rendering.
 *
 * Every case feeds an injected counting source instead of `crypto`, so the
 * output is exact rather than "looks random".
 */
import { describe, expect, it } from 'vitest';
import {
    MAX_TOKEN_BYTES,
    MAX_TOKEN_COUNT,
    type RandomSource,
    cryptoRandomSource,
    generateBase64Token,
    generateHexToken,
    generateTokens,
    generateUuidV4,
} from '../../../../../src/server/spa/client/react/features/dev-tools/logic/tokens';

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
    return result.value;
}

/** Fills with 0,1,2,… continuing across calls so repeated values differ. */
function countingSource(start = 0): RandomSource {
    let next = start;
    return bytes => {
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = next++ & 0xff;
    };
}

/** Every byte the same, for checking the version/variant bit surgery. */
function constantSource(value: number): RandomSource {
    return bytes => bytes.fill(value);
}

describe('generateUuidV4', () => {
    it('lays out 8-4-4-4-12 hex from the injected bytes', () => {
        expect(generateUuidV4(countingSource())).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
    });

    it('forces the version-4 and variant-10xx bits regardless of the source', () => {
        const uuid = generateUuidV4(constantSource(0xff));
        expect(uuid).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
        expect(uuid[14]).toBe('4');
        expect('89ab').toContain(uuid[19]);
    });

    it('sets the variant bits on an all-zero source too', () => {
        expect(generateUuidV4(constantSource(0))).toBe('00000000-0000-4000-8000-000000000000');
    });

    it('matches the RFC 4122 shape', () => {
        expect(generateUuidV4(countingSource(7))).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
    });
});

describe('generateHexToken / generateBase64Token', () => {
    it('emits two hex characters per byte', () => {
        expect(generateHexToken(4, countingSource())).toBe('00010203');
        expect(generateHexToken(8, countingSource()).length).toBe(16);
    });

    it('base64s the same bytes', () => {
        expect(generateBase64Token(3, countingSource())).toBe('AAEC');
        expect(generateBase64Token(4, countingSource())).toBe('AAECAw==');
    });
});

describe('generateTokens', () => {
    it('produces the requested count, each drawing fresh bytes', () => {
        const values = unwrap(generateTokens({ kind: 'hex', byteLength: 2, count: 3 }, countingSource()));
        expect(values).toEqual(['0001', '0203', '0405']);
    });

    it('ignores the byte length for UUIDs', () => {
        const values = unwrap(generateTokens({ kind: 'uuid', byteLength: 999, count: 1 }, countingSource()));
        expect(values[0]).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
    });

    it('generates base64 values', () => {
        const values = unwrap(generateTokens({ kind: 'base64', byteLength: 3, count: 2 }, countingSource()));
        expect(values).toEqual(['AAEC', 'AwQF']);
    });

    it('rejects an out-of-range count', () => {
        expect(generateTokens({ kind: 'uuid', byteLength: 16, count: 0 }, countingSource()).ok).toBe(false);
        expect(
            generateTokens({ kind: 'uuid', byteLength: 16, count: MAX_TOKEN_COUNT + 1 }, countingSource()).ok,
        ).toBe(false);
        const bad = generateTokens({ kind: 'uuid', byteLength: 16, count: Number.NaN }, countingSource());
        expect(bad.ok === false && bad.error).toContain('Count must be');
    });

    it('rejects an out-of-range byte length for non-UUID kinds', () => {
        expect(generateTokens({ kind: 'hex', byteLength: 0, count: 1 }, countingSource()).ok).toBe(false);
        const tooLong = generateTokens(
            { kind: 'hex', byteLength: MAX_TOKEN_BYTES + 1, count: 1 },
            countingSource(),
        );
        expect(tooLong.ok === false && tooLong.error).toContain('Length must be');
    });
});

describe('cryptoRandomSource', () => {
    it('fills the buffer from the platform crypto', () => {
        const bytes = new Uint8Array(16);
        cryptoRandomSource(bytes);
        // Sixteen zero bytes from a real CSPRNG is a 1-in-2^128 event.
        expect(bytes.some(byte => byte !== 0)).toBe(true);
    });
});
