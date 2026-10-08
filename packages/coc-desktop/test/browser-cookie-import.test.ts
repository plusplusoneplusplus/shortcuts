import { describe, expect, it } from 'vitest';
import { parseBrowserCookies } from '../src/browser-cookie-import';

describe('desktop cookie input', () => {
    it('parses header pairs without losing equals signs or empty values', () => {
        expect(parseBrowserCookies('App.Example.com', 'Cookie: session=abc==; empty=')).toEqual([
            { url: 'https://app.example.com/', name: 'session', value: 'abc==', path: '/', secure: true, httpOnly: false, sameSite: 'lax' },
            { url: 'https://app.example.com/', name: 'empty', value: '', path: '/', secure: true, httpOnly: false, sameSite: 'lax' },
        ]);
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
