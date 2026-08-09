/**
 * Base64, URL-component and HTML-entity encoders/decoders.
 *
 * Base64 is hand-rolled over raw bytes rather than going through `btoa`/`atob`:
 * those only speak Latin-1, so round-tripping non-ASCII through them needs an
 * escape dance that is easy to get subtly wrong. Working on the `TextEncoder`
 * bytes directly is UTF-8 safe by construction, and gives us the base64url
 * variant the JWT decoder needs for free.
 *
 * React-free; every entry point returns `{ ok } | { ok: false, error }`.
 */

export type EncodeResult = { ok: true; value: string } | { ok: false; error: string };

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encode raw bytes as standard (padded, `+/`) base64. */
export function bytesToBase64(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i]!;
        const b1 = bytes[i + 1];
        const b2 = bytes[i + 2];
        out += B64_ALPHABET[b0 >> 2];
        out += B64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
        out += b1 === undefined ? '=' : B64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
        out += b2 === undefined ? '=' : B64_ALPHABET[b2 & 0x3f];
    }
    return out;
}

/**
 * Decode standard *or* URL-safe base64 into raw bytes. Padding is optional;
 * whitespace is ignored.
 */
export function base64ToBytes(text: string): { ok: true; value: Uint8Array } | { ok: false; error: string } {
    const cleaned = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    const bytes: number[] = [];
    let acc = 0;
    let bits = 0;
    for (const ch of cleaned) {
        const index = B64_ALPHABET.indexOf(ch);
        if (index < 0) return { ok: false, error: `"${ch}" is not a valid base64 character` };
        acc = (acc << 6) | index;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((acc >> bits) & 0xff);
        }
    }
    // A trailing group of 6 leftover bits is an incomplete byte, not padding.
    if (bits >= 6) return { ok: false, error: 'Truncated base64 input' };
    return { ok: true, value: Uint8Array.from(bytes) };
}

/** UTF-8 encode `text`, then base64 it. */
export function encodeBase64(text: string): EncodeResult {
    return { ok: true, value: bytesToBase64(new TextEncoder().encode(text)) };
}

/** Base64-decode `text`, then UTF-8 decode the bytes. */
export function decodeBase64(text: string): EncodeResult {
    const bytes = base64ToBytes(text);
    if (!bytes.ok) return bytes;
    try {
        return { ok: true, value: new TextDecoder('utf-8', { fatal: true }).decode(bytes.value) };
    } catch {
        return { ok: false, error: 'Decoded bytes are not valid UTF-8' };
    }
}

/** `encodeURIComponent`, surfaced as a result so the card never throws. */
export function encodeUrl(text: string): EncodeResult {
    try {
        return { ok: true, value: encodeURIComponent(text) };
    } catch {
        return { ok: false, error: 'Input cannot be URL-encoded' };
    }
}

/** `decodeURIComponent`, with the malformed-escape case turned into an error. */
export function decodeUrl(text: string): EncodeResult {
    try {
        return { ok: true, value: decodeURIComponent(text) };
    } catch {
        return { ok: false, error: 'Malformed percent-escape in input' };
    }
}

const HTML_ESCAPES: readonly [string, string][] = [
    ['&', '&amp;'],
    ['<', '&lt;'],
    ['>', '&gt;'],
    ['"', '&quot;'],
    ["'", '&#39;'],
];

/** Escape the five characters that matter inside HTML markup and attributes. */
export function escapeHtml(text: string): EncodeResult {
    let out = text;
    for (const [raw, entity] of HTML_ESCAPES) {
        out = out.split(raw).join(entity);
    }
    return { ok: true, value: out };
}

const NAMED_ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
};

/** Unescape named and numeric (decimal or hex) HTML entities. */
export function unescapeHtml(text: string): EncodeResult {
    const out = text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
        if (body.startsWith('#')) {
            const isHex = body[1] === 'x' || body[1] === 'X';
            const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
            if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
            return String.fromCodePoint(code);
        }
        return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
    });
    return { ok: true, value: out };
}

export type EncoderMode =
    | 'base64-encode'
    | 'base64-decode'
    | 'url-encode'
    | 'url-decode'
    | 'html-escape'
    | 'html-unescape';

export const ENCODER_MODES: readonly { id: EncoderMode; label: string }[] = [
    { id: 'base64-encode', label: 'Base64 encode' },
    { id: 'base64-decode', label: 'Base64 decode' },
    { id: 'url-encode', label: 'URL encode' },
    { id: 'url-decode', label: 'URL decode' },
    { id: 'html-escape', label: 'HTML escape' },
    { id: 'html-unescape', label: 'HTML unescape' },
];

/** Run whichever transform `mode` names. */
export function runEncoder(mode: EncoderMode, text: string): EncodeResult {
    switch (mode) {
        case 'base64-encode':
            return encodeBase64(text);
        case 'base64-decode':
            return decodeBase64(text);
        case 'url-encode':
            return encodeUrl(text);
        case 'url-decode':
            return decodeUrl(text);
        case 'html-escape':
            return escapeHtml(text);
        case 'html-unescape':
            return unescapeHtml(text);
        default:
            return { ok: false, error: 'Unknown mode' };
    }
}
