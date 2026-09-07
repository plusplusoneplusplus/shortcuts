/**
 * The portable SHA-256 used for canonical origin IDs must agree with Node's
 * `crypto` byte-for-byte: the server hashes with one and the SPA with the other,
 * and persisted origin keys have to keep matching across the two.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { sha256Hex } from '../../src/git/sha256';

function nodeSha256(input: string): string {
    return createHash('sha256').update(input, 'utf8').digest('hex');
}

describe('sha256Hex', () => {
    it('matches the published vector for the empty string', () => {
        expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('matches the published vector for "abc"', () => {
        expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });

    it('matches Node crypto across the padding boundaries', () => {
        // 55/56 straddle the single-block limit; 63/64/65 straddle the block size.
        for (const length of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000]) {
            const input = 'a'.repeat(length);
            expect(sha256Hex(input)).toBe(nodeSha256(input));
        }
    });

    it('matches Node crypto for Unicode input, hashing UTF-8 bytes not code units', () => {
        for (const input of ['é', '日本語', '🚀', 'café/naïve', 'Ω'.repeat(28), '🚀'.repeat(16)]) {
            expect(sha256Hex(input)).toBe(nodeSha256(input));
        }
    });

    it('matches Node crypto for UTF-8 byte lengths around the boundaries', () => {
        // 'é' is two UTF-8 bytes, so these land on 54..66 encoded bytes.
        for (let count = 27; count <= 33; count++) {
            const input = 'é'.repeat(count);
            expect(new TextEncoder().encode(input).length).toBe(count * 2);
            expect(sha256Hex(input)).toBe(nodeSha256(input));
        }
    });

    it('matches Node crypto for realistic remote URLs', () => {
        for (const input of [
            'github.com/owner/repo',
            'https://github.com/owner/repo',
            'git.example.com/team/project',
            'ssh://git@internal.example.com:2222/deep/nested/path/repo',
        ]) {
            expect(sha256Hex(input)).toBe(nodeSha256(input));
        }
    });
});
