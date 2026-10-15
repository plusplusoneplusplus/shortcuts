import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseBrowserCookies } from '../src/browser-cookie-import';

describe('desktop cookie input', () => {
    const now = 1_800_000_000_123;
    const pairExpiry = now / 1000 + 2_592_000;
    beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('parses header pairs without losing equals signs or empty values', () => {
        expect(parseBrowserCookies('App.Example.com', 'Cookie: session=abc==; empty=')).toEqual([
            { url: 'https://app.example.com/', name: 'session', value: 'abc==', path: '/', secure: true, httpOnly: false, sameSite: 'lax', expirationDate: pairExpiry },
            { url: 'https://app.example.com/', name: 'empty', value: '', path: '/', secure: true, httpOnly: false, sameSite: 'lax', expirationDate: pairExpiry },
        ]);
    });
    it.each(['a=1; b=2', ' Cookie: a=1; b=2 '])('gives the entire pair batch exactly 30 days from each import: %s', input => {
        expect(parseBrowserCookies('example.com', input).map(c => c.expirationDate)).toEqual([pairExpiry, pairExpiry]);
        vi.mocked(Date.now).mockReturnValue(now + 86_400_000);
        expect(parseBrowserCookies('example.com', input).map(c => c.expirationDate)).toEqual([pairExpiry + 86_400, pairExpiry + 86_400]);
    });
    it.each([
        [{}, undefined],
        [{ session: false }, undefined],
        [{ expirationDate: -1 }, undefined],
        [{ expires: -1 }, undefined],
        [{ session: true, expirationDate: pairExpiry }, undefined],
        [{ session: true, expires: 1 }, undefined],
        [{ expirationDate: pairExpiry + 3600 }, pairExpiry + 3600],
        [{ expires: pairExpiry - 3600 }, pairExpiry - 3600],
        [{ session: false, expirationDate: pairExpiry + 0.5 }, pairExpiry + 0.5],
        [{ expirationDate: pairExpiry + 3600, expires: pairExpiry }, pairExpiry + 3600],
    ])('preserves JSON expiry/session semantics for %j', (attributes, expiry) => {
        const cookie = parseBrowserCookies('example.com', JSON.stringify([{ name: 'a', value: 'b', ...attributes }]))[0];
        if (expiry === undefined) expect(cookie).not.toHaveProperty('expirationDate');
        else expect(cookie.expirationDate).toBe(expiry);
    });
    it.each([0, 1, now / 1000, now / 1000 - 1, '1800000001'])('rejects invalid JSON expiry %j without replacing it with pair expiry', expirationDate => {
        expect(() => parseBrowserCookies('example.com', JSON.stringify([{ name: 'a', value: 'b', expirationDate }]))).toThrow('invalid or expired expiry');
    });
    it('preserves literal quotes and backslashes from exported session-cookie JSON', () => {
        const input = String.raw`[
            {"name":"fixture_session","value":"\"fixture\\segment\"","hostOnly":true,"httpOnly":true,"session":true},
            {"name":"fixture_auth_0","value":"fixture-part-0==%2F+/","domain":".example.com","httpOnly":true},
            {"name":"fixture_auth_1","value":"fixture-part-1==","domain":".example.com","httpOnly":true}
        ]`;
        const cookies = parseBrowserCookies('app.example.com', input);
        expect(cookies).toEqual([
            { url: 'https://app.example.com/', name: 'fixture_session', value: '"fixture\\segment"', path: '/', secure: true, httpOnly: true, sameSite: 'lax' },
            { url: 'https://app.example.com/', name: 'fixture_auth_0', value: 'fixture-part-0==%2F+/', domain: '.example.com', path: '/', secure: true, httpOnly: true, sameSite: 'lax' },
            { url: 'https://app.example.com/', name: 'fixture_auth_1', value: 'fixture-part-1==', domain: '.example.com', path: '/', secure: true, httpOnly: true, sameSite: 'lax' },
        ]);
    });
    it.each(['"fixture\\segment"', String.raw`fixture\n\u0041`, String.raw`"fixture\"segment"`, '%22fixture%5Csegment%22', 'fixture==', ''])('preserves the value %j in JSON and header pairs without decoding', value => {
        const json = parseBrowserCookies('app.example.com', JSON.stringify([{ name: 'session', value }]));
        const pairs = parseBrowserCookies('app.example.com', `Cookie: session=${value}`);
        expect(json[0].value).toBe(value);
        expect(json[0]).not.toHaveProperty('expirationDate');
        expect(pairs).toEqual([{ ...json[0], expirationDate: pairExpiry }]);
    });
    it('preserves quoted header values alongside both auth-cookie parts', () => {
        const cookies = parseBrowserCookies('app.example.com', String.raw`Cookie: fixture_session="fixture\segment"; fixture_auth_0=fixture-part-0==%2F+/; fixture_auth_1=fixture-part-1==`);
        expect(cookies.map(({ name, value }) => ({ name, value }))).toEqual([
            { name: 'fixture_session', value: '"fixture\\segment"' },
            { name: 'fixture_auth_0', value: 'fixture-part-0==%2F+/' },
            { name: 'fixture_auth_1', value: 'fixture-part-1==' },
        ]);
    });
    it.each([...Array.from({ length: 32 }, (_, index) => String.fromCharCode(index)), '\x7f'])('rejects control character %j in JSON and pairs, including before trimming', control => {
        for (const value of [`${control}fixture`, `fix${control}ture`, `fixture${control}`]) {
            expect(() => parseBrowserCookies('app.example.com', JSON.stringify([{ name: 'session', value }]))).toThrow('Cookie 1');
            expect(() => parseBrowserCookies('app.example.com', `session=${value}`)).toThrow();
        }
    });
    it.each([';', ',', ' ', '\u0080', '\u2028'])('retains unsupported value-character rejection for %j', character => {
        expect(() => parseBrowserCookies('app.example.com', JSON.stringify([{ name: 'session', value: `"fixture\\${character}segment"` }]))).toThrow('Cookie 1');
    });
    it('applies cookie-size and batch limits to quoted values', () => {
        const value = '"' + '\\'.repeat(4093) + '"';
        expect(parseBrowserCookies('app.example.com', JSON.stringify([{ name: 'a', value }]))[0].value).toBe(value);
        expect(() => parseBrowserCookies('app.example.com', JSON.stringify([{ name: 'a', value: value + '\\' }]))).toThrow('Cookie 1');
        expect(parseBrowserCookies('app.example.com', JSON.stringify(Array(200).fill({ name: 'a', value: '"fixture\\segment"' })))).toHaveLength(200);
        expect(() => parseBrowserCookies('app.example.com', JSON.stringify(Array(201).fill({ name: 'a', value: '"fixture\\segment"' })))).toThrow('1 to 200');
    });
    it.each([
        { domain: 'other.test' },
        { domain: '.example.com', hostOnly: true },
        { partitionKey: {} },
        { partitioned: true },
        { secure: false, sameSite: 'none' },
    ])('rejects the whole quoted-cookie batch with unsupported attributes %j', attributes => {
        expect(() => parseBrowserCookies('app.example.com', JSON.stringify([
            { name: 'fixture_auth_0', value: 'fixture-part-0==' },
            { name: 'fixture_session', value: '"fixture\\segment"', ...attributes },
        ]))).toThrow('Cookie 2');
    });
    it('preserves JSON attributes and parent domains, and host-only cookies omit domain', () => {
        const expirationDate = Date.now() / 1000 + 3600;
        const cookies = parseBrowserCookies('app.example.com', JSON.stringify([
            { name: 'sso', value: 'token', domain: '.example.com', path: '/app', secure: true, httpOnly: true, sameSite: 'none', expirationDate },
            { name: '__Host-session', value: 'token', domain: 'app.example.com', hostOnly: true, path: '/', secure: true },
        ]));
        expect(cookies[0]).toMatchObject({ domain: '.example.com', path: '/app', httpOnly: true, sameSite: 'no_restriction', expirationDate });
        expect(cookies[1]).not.toHaveProperty('domain');
    });
    it('accepts session-cookie exports and rejects an entire JSON batch before any writes', () => {
        expect(parseBrowserCookies('localhost', '[{"name":"a","value":"b","expires":-1,"secure":false,"sameSite":"Lax"}]')[0]).not.toHaveProperty('expirationDate');
        expect(() => parseBrowserCookies('app.example.com', '[{"name":"a","value":"b"},{"name":"bad name","value":"secret"}]')).toThrow('Cookie 2');
    });
    it.each(['https://app.example.com', 'app.example.com/path', 'app.example.com:443', 'user@app.example.com', 'app.example.com?x', '', '127.1', 'bad..domain'])('rejects invalid domain %s', domain => {
        expect(() => parseBrowserCookies(domain, 'a=b')).toThrow();
    });
    it.each([
        '', '{oops', '{}', '[]', 'a', 'a=b; invalid', 'a=b; ',
        JSON.stringify([{ name: 'bad name', value: 'secret' }]),
        JSON.stringify([{ name: 'a', value: 'x\nsecret' }]),
        JSON.stringify([{ name: 'a', value: 'secret', domain: 'evil.example.com' }]),
        JSON.stringify([{ name: 'a', value: 'secret', domain: '.ample.com' }]),
        JSON.stringify([{ name: 'a', value: 'secret', domain: '.example.com', hostOnly: true }]),
        JSON.stringify([{ name: 'a', value: 'secret', path: 'relative' }]),
        JSON.stringify([{ name: 'a', value: 'secret', sameSite: 'none', secure: false }]),
        JSON.stringify([{ name: 'a', value: 'secret', httpOnly: 'true' }]),
        JSON.stringify([{ name: 'a', value: 'secret', expirationDate: 1 }]),
        JSON.stringify([{ name: '__Host-a', value: 'secret', domain: '.example.com' }]),
        JSON.stringify([{ name: '__Secure-a', value: 'secret', secure: false }]),
        JSON.stringify([{ name: 'a', value: 'secret', partitionKey: {} }]),
        'a=' + 'x'.repeat(65536),
        Array(201).fill('a=b').join(';'),
    ])('rejects malformed, mismatched or unsupported input without disclosing values', input => {
        let error: Error | undefined;
        try { parseBrowserCookies('app.example.com', input); } catch (e) { error = e as Error; }
        expect(error).toBeInstanceOf(Error);
        expect(error!.message).not.toContain('secret');
    });
});
