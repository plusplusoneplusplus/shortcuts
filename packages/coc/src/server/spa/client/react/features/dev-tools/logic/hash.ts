/**
 * SHA-1 / SHA-256 / SHA-512 hex digests over the UTF-8 bytes of a string.
 *
 * Hashing goes through WebCrypto (`crypto.subtle.digest`) rather than a
 * hand-rolled implementation. That rules MD5 out: `subtle` does not offer it,
 * and a hand-rolled MD5 would be ~150 lines of bit twiddling for an algorithm
 * nobody should be using — the card says so instead.
 *
 * The `SubtleLike` parameter is injected so tests can run against Node's
 * WebCrypto without depending on what jsdom happens to expose.
 *
 * React-free; a missing WebCrypto comes back as an error, never a throw.
 */

export type HashResult = { ok: true; value: string } | { ok: false; error: string };

export type HashAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512';

export const HASH_ALGORITHMS: readonly HashAlgorithm[] = ['SHA-1', 'SHA-256', 'SHA-512'];

/** The one method of `crypto.subtle` this module needs. */
export interface SubtleLike {
    digest(algorithm: string, data: BufferSource): Promise<ArrayBuffer>;
}

/** The ambient `crypto.subtle`, or `null` in an environment without it. */
export function defaultSubtle(): SubtleLike | null {
    const subtle = (globalThis as { crypto?: { subtle?: SubtleLike } }).crypto?.subtle;
    return subtle ?? null;
}

export function bytesToHex(bytes: Uint8Array): string {
    let out = '';
    for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
    return out;
}

/** Hash `text` and return the lowercase hex digest. */
export async function hashText(
    algorithm: HashAlgorithm,
    text: string,
    subtle: SubtleLike | null = defaultSubtle(),
): Promise<HashResult> {
    if (!HASH_ALGORITHMS.includes(algorithm)) {
        return { ok: false, error: `Unsupported algorithm "${algorithm}"` };
    }
    if (!subtle) {
        return { ok: false, error: 'Web Crypto (crypto.subtle) is unavailable in this browser' };
    }
    try {
        const digest = await subtle.digest(algorithm, new TextEncoder().encode(text));
        return { ok: true, value: bytesToHex(new Uint8Array(digest)) };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Hashing failed' };
    }
}

/** All three digests at once — what the card shows. */
export async function hashAll(
    text: string,
    subtle: SubtleLike | null = defaultSubtle(),
): Promise<Record<HashAlgorithm, HashResult>> {
    const entries = await Promise.all(
        HASH_ALGORITHMS.map(async algorithm => [algorithm, await hashText(algorithm, text, subtle)] as const),
    );
    return Object.fromEntries(entries) as Record<HashAlgorithm, HashResult>;
}
