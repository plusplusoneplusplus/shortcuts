/**
 * JWT decoder — header and payload only.
 *
 * The signature is **never verified**: doing so needs the issuer's key, which
 * this panel has no way to obtain without a network call. The card states that
 * plainly, and this module only ever reports the signature segment's presence.
 *
 * base64url decoding reuses `encoders.base64ToBytes`, which already accepts the
 * URL-safe alphabet and unpadded input. `exp` / `iat` / `nbf` are resolved
 * against an injected `nowMs` so expiry is deterministic under test.
 *
 * React-free; malformed tokens come back as errors.
 */

import { base64ToBytes } from './encoders';
import { formatRelative } from './timestamp';

export type JwtResult = { ok: true; value: DecodedJwt } | { ok: false; error: string };

export interface JwtClaimTime {
    /** `exp`, `iat` or `nbf`. */
    name: string;
    /** The raw numeric claim, in epoch seconds. */
    epochSeconds: number;
    iso: string;
    local: string;
    relative: string;
}

export interface DecodedJwt {
    header: unknown;
    payload: unknown;
    /** Pretty-printed with two-space indent, ready to render. */
    headerJson: string;
    payloadJson: string;
    /** The third segment, untouched — presence only, never checked. */
    signature: string;
    algorithm: string | null;
    times: JwtClaimTime[];
    /** `true`/`false` from `exp`, or `null` when the token carries no `exp`. */
    expired: boolean | null;
    /** `true` when `nbf` is in the future. */
    notYetValid: boolean;
}

const TIME_CLAIMS = ['exp', 'iat', 'nbf'] as const;

function decodeSegment(segment: string, label: string): { ok: true; value: unknown } | { ok: false; error: string } {
    const bytes = base64ToBytes(segment);
    if (!bytes.ok) return { ok: false, error: `${label} is not valid base64url: ${bytes.error}` };
    let text: string;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.value);
    } catch {
        return { ok: false, error: `${label} does not decode to UTF-8 text` };
    }
    try {
        return { ok: true, value: JSON.parse(text) };
    } catch {
        return { ok: false, error: `${label} is not valid JSON` };
    }
}

function claimTime(name: string, value: number, nowMs: number): JwtClaimTime {
    const date = new Date(value * 1000);
    return {
        name,
        epochSeconds: value,
        iso: Number.isNaN(date.getTime()) ? 'out of range' : date.toISOString(),
        local: Number.isNaN(date.getTime()) ? 'out of range' : date.toLocaleString(),
        relative: Number.isNaN(date.getTime()) ? '' : formatRelative(value * 1000, nowMs),
    };
}

/** Split, decode and describe a JWT. The signature is never verified. */
export function decodeJwt(token: string, nowMs: number): JwtResult {
    const trimmed = token.trim();
    if (!trimmed) return { ok: false, error: 'Paste a JWT' };

    const segments = trimmed.split('.');
    if (segments.length !== 3) {
        return { ok: false, error: `A JWT has 3 dot-separated segments, this has ${segments.length}` };
    }

    const header = decodeSegment(segments[0]!, 'Header');
    if (!header.ok) return header;
    const payload = decodeSegment(segments[1]!, 'Payload');
    if (!payload.ok) return payload;

    const claims = (payload.value ?? {}) as Record<string, unknown>;
    const times: JwtClaimTime[] = [];
    for (const name of TIME_CLAIMS) {
        const raw = claims[name];
        if (typeof raw === 'number' && Number.isFinite(raw)) times.push(claimTime(name, raw, nowMs));
    }

    const exp = typeof claims.exp === 'number' ? claims.exp : null;
    const nbf = typeof claims.nbf === 'number' ? claims.nbf : null;
    const headerRecord = (header.value ?? {}) as Record<string, unknown>;

    return {
        ok: true,
        value: {
            header: header.value,
            payload: payload.value,
            headerJson: JSON.stringify(header.value, null, 2),
            payloadJson: JSON.stringify(payload.value, null, 2),
            signature: segments[2]!,
            algorithm: typeof headerRecord.alg === 'string' ? headerRecord.alg : null,
            times,
            expired: exp === null ? null : exp * 1000 <= nowMs,
            notYetValid: nbf !== null && nbf * 1000 > nowMs,
        },
    };
}
