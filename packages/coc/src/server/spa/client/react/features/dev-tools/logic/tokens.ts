/**
 * UUID v4 and random-token generation.
 *
 * The randomness is injected rather than reached for directly, so the tests can
 * feed a counting source and assert exact output. The card passes
 * `cryptoRandomSource`, which is `crypto.getRandomValues`.
 *
 * React-free; every entry point returns `{ ok } | { ok: false, error }`.
 */

import { bytesToBase64 } from './encoders';

export type TokenResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Fills the buffer with random bytes in place, like `crypto.getRandomValues`. */
export type RandomSource = (bytes: Uint8Array) => void;

/** The browser source. Kept out of the pure functions so tests stay deterministic. */
export const cryptoRandomSource: RandomSource = bytes => {
    crypto.getRandomValues(bytes);
};

function randomBytes(length: number, random: RandomSource): Uint8Array {
    const bytes = new Uint8Array(length);
    random(bytes);
    return bytes;
}

function toHex(bytes: Uint8Array): string {
    let out = '';
    for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
    return out;
}

/**
 * A RFC 4122 version-4 UUID built from 16 random bytes.
 *
 * Hand-rolled rather than calling `crypto.randomUUID` so the version/variant
 * bits are set over the *injected* source — `randomUUID` takes no seed, and
 * jsdom does not always provide it.
 */
export function generateUuidV4(random: RandomSource): string {
    const bytes = randomBytes(16, random);
    bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10xx
    const hex = toHex(bytes);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Lowercase hex over `byteLength` random bytes — twice as many characters. */
export function generateHexToken(byteLength: number, random: RandomSource): string {
    return toHex(randomBytes(byteLength, random));
}

/** Standard padded base64 over `byteLength` random bytes. */
export function generateBase64Token(byteLength: number, random: RandomSource): string {
    return bytesToBase64(randomBytes(byteLength, random));
}

export type TokenKind = 'uuid' | 'hex' | 'base64';

export const TOKEN_KINDS: readonly { id: TokenKind; label: string }[] = [
    { id: 'uuid', label: 'UUID v4' },
    { id: 'hex', label: 'Hex token' },
    { id: 'base64', label: 'Base64 token' },
];

export const MIN_TOKEN_BYTES = 1;
export const MAX_TOKEN_BYTES = 128;
export const MIN_TOKEN_COUNT = 1;
export const MAX_TOKEN_COUNT = 50;

export interface TokenRequest {
    kind: TokenKind;
    /** Ignored for `uuid`, which is always 16 bytes. */
    byteLength: number;
    count: number;
}

/** Generate `count` values of the requested kind, validating the controls first. */
export function generateTokens(request: TokenRequest, random: RandomSource): TokenResult<string[]> {
    const { kind, byteLength, count } = request;
    if (!Number.isInteger(count) || count < MIN_TOKEN_COUNT || count > MAX_TOKEN_COUNT) {
        return { ok: false, error: `Count must be a whole number from ${MIN_TOKEN_COUNT} to ${MAX_TOKEN_COUNT}` };
    }
    if (kind !== 'uuid') {
        if (!Number.isInteger(byteLength) || byteLength < MIN_TOKEN_BYTES || byteLength > MAX_TOKEN_BYTES) {
            return {
                ok: false,
                error: `Length must be a whole number of bytes from ${MIN_TOKEN_BYTES} to ${MAX_TOKEN_BYTES}`,
            };
        }
    }

    const values: string[] = [];
    for (let i = 0; i < count; i += 1) {
        if (kind === 'uuid') values.push(generateUuidV4(random));
        else if (kind === 'hex') values.push(generateHexToken(byteLength, random));
        else values.push(generateBase64Token(byteLength, random));
    }
    return { ok: true, value: values };
}
