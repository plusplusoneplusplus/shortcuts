import { describe, expect, it } from 'vitest';
import { browserApprovalSite } from '../../../src/server/llm-tools/browser-navigation-approval';

describe('browserApprovalSite', () => {
    it.each([
        ['https://mail.google.com/inbox', 'google.com'],
        ['https://google.com/', 'google.com'],
        ['https://GOOGLE.com./search?q=1', 'google.com'],
        ['http://news.bbc.co.uk:8080/a', 'bbc.co.uk'],
        ['https://user.github.io/project', 'user.github.io'],
        ['https://a.b.user.github.io/', 'user.github.io'],
        ['http://example.com', 'example.com'],
        ['https://example.com:8443', 'example.com'],
        ['http://10.0.0.1:8080/', '10.0.0.1'],
        ['http://192.168.1.20/', '192.168.1.20'],
        ['http://[2001:db8::1]/', '2001:db8::1'],
        ['http://intranet/', 'intranet'],
    ])('maps %s to %s', (url, site) => {
        expect(browserApprovalSite(url)).toBe(site);
    });

    it.each([
        'about:blank',
        'data:text/html,<p>hi</p>',
        'file:///tmp/page.html',
        'javascript:alert(1)',
        'http://localhost:3000/',
        'https://LOCALHOST/',
        'http://app.localhost/',
        'http://127.0.0.1:4000/',
        'http://127.1.2.3/',
        'http://[::1]:4000/',
        'http://[::ffff:127.0.0.1]/',
        'not a url',
        '',
    ])('never asks for %s', url => {
        expect(browserApprovalSite(url)).toBeNull();
    });

    it('treats http and https of one root domain as the same site', () => {
        expect(browserApprovalSite('http://www.example.org')).toBe(browserApprovalSite('https://docs.example.org:444/x'));
    });
});
