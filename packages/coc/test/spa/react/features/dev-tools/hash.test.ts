/**
 * Unit tests for the hash generator's pure logic.
 *
 * Runs in the node environment: jsdom does not reliably expose
 * `crypto.subtle`, while Node's WebCrypto always does. Digests are checked
 * against the published vectors for the empty string and "abc".
 */
import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';

import {
    HASH_ALGORITHMS,
    bytesToHex,
    hashAll,
    hashText,
    type SubtleLike,
} from '../../../../../src/server/spa/client/react/features/dev-tools/logic/hash';

const subtle = webcrypto.subtle as unknown as SubtleLike;

function unwrap(result: { ok: true; value: string } | { ok: false; error: string }): string {
    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
    return result.value;
}

describe('hashText', () => {
    it('matches the known SHA-256 vectors', async () => {
        expect(unwrap(await hashText('SHA-256', '', subtle))).toBe(
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        );
        expect(unwrap(await hashText('SHA-256', 'abc', subtle))).toBe(
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        );
    });

    it('matches the known SHA-1 and SHA-512 vectors for "abc"', async () => {
        expect(unwrap(await hashText('SHA-1', 'abc', subtle))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
        expect(unwrap(await hashText('SHA-512', 'abc', subtle))).toBe(
            'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a' +
                '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
        );
    });

    it('hashes the UTF-8 bytes, so non-ASCII input is stable', async () => {
        // The UTF-8 encoding of "é" is C3 A9 — same digest as those raw bytes.
        expect(unwrap(await hashText('SHA-256', 'é', subtle))).toBe(
            bytesToHex(new Uint8Array(await subtle.digest('SHA-256', Uint8Array.from([0xc3, 0xa9])))),
        );
    });

    it('reports a missing WebCrypto instead of throwing', async () => {
        const result = await hashText('SHA-256', 'abc', null);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('crypto.subtle');
    });

    it('rejects an unsupported algorithm', async () => {
        const result = await hashText('MD5' as never, 'abc', subtle);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('Unsupported algorithm');
    });

    it('turns a digest failure into an error result', async () => {
        const broken: SubtleLike = {
            digest: () => Promise.reject(new Error('boom')),
        };
        const result = await hashText('SHA-256', 'abc', broken);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toBe('boom');
    });
});

describe('hashAll', () => {
    it('returns one result per supported algorithm', async () => {
        const all = await hashAll('abc', subtle);
        expect(Object.keys(all).sort()).toEqual([...HASH_ALGORITHMS].sort());
        expect(unwrap(all['SHA-1'])).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
        expect('MD5' in all).toBe(false);
    });
});

describe('bytesToHex', () => {
    it('zero-pads every byte', () => {
        expect(bytesToHex(Uint8Array.from([0, 1, 15, 16, 255]))).toBe('00010f10ff');
    });
});
