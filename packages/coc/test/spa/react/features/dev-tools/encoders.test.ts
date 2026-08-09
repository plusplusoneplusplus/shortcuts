/**
 * Base64 / URL / HTML encoders — pure logic, no rendering.
 */
import { describe, expect, it } from 'vitest';
import {
    base64ToBytes,
    bytesToBase64,
    decodeBase64,
    decodeUrl,
    encodeBase64,
    encodeUrl,
    escapeHtml,
    runEncoder,
    unescapeHtml,
} from '../../../../../src/server/spa/client/react/features/dev-tools/logic/encoders';

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
    return result.value;
}

describe('base64', () => {
    it('matches known vectors, padding included', () => {
        expect(unwrap(encodeBase64(''))).toBe('');
        expect(unwrap(encodeBase64('f'))).toBe('Zg==');
        expect(unwrap(encodeBase64('fo'))).toBe('Zm8=');
        expect(unwrap(encodeBase64('foo'))).toBe('Zm9v');
        expect(unwrap(encodeBase64('foobar'))).toBe('Zm9vYmFy');
    });

    it('round-trips non-ASCII text as UTF-8', () => {
        for (const sample of ['héllo wörld', '日本語テキスト', '🎉 emoji 🚀', 'mixed ünïcode 中文']) {
            expect(unwrap(decodeBase64(unwrap(encodeBase64(sample))))).toBe(sample);
        }
    });

    it('round-trips raw bytes including high values', () => {
        const bytes = Uint8Array.from([0, 1, 127, 128, 254, 255]);
        expect(Array.from(unwrap(base64ToBytes(bytesToBase64(bytes))))).toEqual(Array.from(bytes));
    });

    it('accepts the URL-safe alphabet and missing padding', () => {
        expect(unwrap(decodeBase64('Zm9vYmFy'))).toBe('foobar');
        expect(unwrap(decodeBase64('Zg'))).toBe('f');
    });

    it('errors on an invalid character and on truncated input', () => {
        const bad = decodeBase64('not*base64');
        expect(bad.ok).toBe(false);
        expect(bad.ok === false && bad.error).toContain('not a valid base64 character');
        expect(base64ToBytes('A').ok).toBe(false);
    });

    it('errors when the decoded bytes are not valid UTF-8', () => {
        expect(decodeBase64(bytesToBase64(Uint8Array.from([0xff, 0xfe]))).ok).toBe(false);
    });
});

describe('url component', () => {
    it('round-trips reserved characters and unicode', () => {
        for (const sample of ['a b&c=d?e#f', 'héllo/wörld', '100%']) {
            expect(unwrap(decodeUrl(unwrap(encodeUrl(sample))))).toBe(sample);
        }
        expect(unwrap(encodeUrl('a b&c'))).toBe('a%20b%26c');
    });

    it('errors on a malformed percent-escape', () => {
        const result = decodeUrl('%E0%A4%A');
        expect(result.ok).toBe(false);
        expect(result.ok === false && result.error).toContain('Malformed');
    });
});

describe('html entities', () => {
    it('escapes the five markup characters', () => {
        expect(unwrap(escapeHtml(`<a href="x">&'</a>`))).toBe(
            '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
        );
    });

    it('round-trips through unescape', () => {
        const sample = `<script>alert("1 & 2")</script>`;
        expect(unwrap(unescapeHtml(unwrap(escapeHtml(sample))))).toBe(sample);
    });

    it('unescapes numeric entities, decimal and hex', () => {
        expect(unwrap(unescapeHtml('&#65;&#x42;&#x1F389;'))).toBe('AB🎉');
    });

    it('leaves an unknown entity untouched', () => {
        expect(unwrap(unescapeHtml('&notreal; &amp;'))).toBe('&notreal; &');
    });
});

describe('runEncoder', () => {
    it('dispatches to each mode', () => {
        expect(unwrap(runEncoder('base64-encode', 'foo'))).toBe('Zm9v');
        expect(unwrap(runEncoder('base64-decode', 'Zm9v'))).toBe('foo');
        expect(unwrap(runEncoder('url-encode', 'a b'))).toBe('a%20b');
        expect(unwrap(runEncoder('url-decode', 'a%20b'))).toBe('a b');
        expect(unwrap(runEncoder('html-escape', '<b>'))).toBe('&lt;b&gt;');
        expect(unwrap(runEncoder('html-unescape', '&lt;b&gt;'))).toBe('<b>');
    });
});
