/**
 * Unit tests for the JWT decoder's pure logic.
 *
 * The sample token is fixed and the clock is injected, so the expiry verdicts
 * below are stable. The signature is never verified — only its presence and
 * segment count are checked.
 */
import { describe, expect, it } from 'vitest';

import { decodeJwt } from '../../../../../src/server/spa/client/react/features/dev-tools/logic/jwt';

/** { alg: HS256, typ: JWT } . { sub, name, admin, iat, nbf: 1700000000, exp: 1700003600 } . sig */
const SAMPLE =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImFkbWluIjp0cnVlLCJpYXQiOjE3MDAwMDAwMDAsIm5iZiI6MTcwMDAwMDAwMCwiZXhwIjoxNzAwMDAzNjAwfQ.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';

const ISSUED_MS = 1_700_000_000_000;
const EXPIRES_MS = 1_700_003_600_000;

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
    return result.value;
}

function errorOf(result: { ok: true } | { ok: false; error: string }): string {
    if (result.ok) throw new Error('expected an error');
    return result.error;
}

describe('decodeJwt', () => {
    it('decodes the header and payload of a fixed sample', () => {
        const decoded = unwrap(decodeJwt(SAMPLE, ISSUED_MS + 60_000));
        expect(decoded.header).toEqual({ alg: 'HS256', typ: 'JWT' });
        expect(decoded.payload).toEqual({
            sub: '1234567890',
            name: 'Ada Lovelace',
            admin: true,
            iat: 1_700_000_000,
            nbf: 1_700_000_000,
            exp: 1_700_003_600,
        });
        expect(decoded.algorithm).toBe('HS256');
        expect(decoded.headerJson).toBe('{\n  "alg": "HS256",\n  "typ": "JWT"\n}');
        expect(decoded.payloadJson).toContain('"name": "Ada Lovelace"');
    });

    it('keeps the signature segment verbatim without verifying it', () => {
        const decoded = unwrap(decodeJwt(SAMPLE, ISSUED_MS));
        expect(decoded.signature).toBe('dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk');
        // A garbage signature still decodes — the module makes no validity claim.
        expect(unwrap(decodeJwt(`${SAMPLE.split('.').slice(0, 2).join('.')}.zzzz`, ISSUED_MS)).signature).toBe('zzzz');
    });

    it('surfaces exp / iat / nbf as human times against the injected clock', () => {
        const decoded = unwrap(decodeJwt(SAMPLE, ISSUED_MS));
        expect(decoded.times.map(t => t.name)).toEqual(['exp', 'iat', 'nbf']);
        const exp = decoded.times.find(t => t.name === 'exp')!;
        expect(exp.epochSeconds).toBe(1_700_003_600);
        expect(exp.iso).toBe(new Date(EXPIRES_MS).toISOString());
        expect(exp.local).toBe(new Date(EXPIRES_MS).toLocaleString());
        expect(exp.relative).toBe('in 1 hour');
        expect(decoded.times.find(t => t.name === 'iat')!.relative).toBe('now');
    });

    it('flips expired at exp, and reports not-yet-valid before nbf', () => {
        expect(unwrap(decodeJwt(SAMPLE, EXPIRES_MS - 1)).expired).toBe(false);
        expect(unwrap(decodeJwt(SAMPLE, EXPIRES_MS)).expired).toBe(true);
        expect(unwrap(decodeJwt(SAMPLE, EXPIRES_MS + 1)).expired).toBe(true);
        expect(unwrap(decodeJwt(SAMPLE, ISSUED_MS - 1)).notYetValid).toBe(true);
        expect(unwrap(decodeJwt(SAMPLE, ISSUED_MS)).notYetValid).toBe(false);
    });

    it('reports a null expiry when the token carries no exp', () => {
        const segments = SAMPLE.split('.');
        const payload = Buffer.from(JSON.stringify({ sub: 'x' })).toString('base64url');
        const decoded = unwrap(decodeJwt(`${segments[0]}.${payload}.${segments[2]}`, ISSUED_MS));
        expect(decoded.expired).toBeNull();
        expect(decoded.times).toEqual([]);
    });

    it('accepts base64url payloads that need padding', () => {
        const segments = SAMPLE.split('.');
        // {"a":1} is 7 bytes, so its base64 needs one "=" that base64url omits.
        const payload = Buffer.from('{"a":1}').toString('base64url');
        expect(payload.endsWith('=')).toBe(false);
        expect(unwrap(decodeJwt(`${segments[0]}.${payload}.${segments[2]}`, ISSUED_MS)).payload).toEqual({ a: 1 });
    });

    it('rejects malformed tokens with a specific message', () => {
        expect(errorOf(decodeJwt('   ', ISSUED_MS))).toBe('Paste a JWT');
        expect(errorOf(decodeJwt('abc.def', ISSUED_MS))).toContain('3 dot-separated segments');
        expect(errorOf(decodeJwt('a.b.c.d', ISSUED_MS))).toContain('this has 4');
        expect(errorOf(decodeJwt('!!!.eyJhIjoxfQ.sig', ISSUED_MS))).toContain('Header is not valid base64url');
        const notJson = Buffer.from('hello').toString('base64url');
        expect(errorOf(decodeJwt(`${notJson}.${notJson}.sig`, ISSUED_MS))).toBe('Header is not valid JSON');
        const goodHeader = SAMPLE.split('.')[0]!;
        expect(errorOf(decodeJwt(`${goodHeader}.${notJson}.sig`, ISSUED_MS))).toBe('Payload is not valid JSON');
    });
});
