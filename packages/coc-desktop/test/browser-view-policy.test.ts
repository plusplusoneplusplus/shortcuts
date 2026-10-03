/**
 * Tests for the browser tab's pure policy: which URLs the main process loads,
 * how navigations / `window.open` are routed, and how sessions are partitioned.
 */

import { describe, expect, it } from 'vitest';
import {
    browserPartitionFor,
    browserUserAgent,
    classifyBrowserNavigation,
    classifyBrowserWindowOpen,
    isBrowserNavAction,
    isBrowserPermissionAllowed,
    isValidBrowserSessionKey,
    isValidBrowserViewId,
    validateBrowserUrl,
} from '../src/browser-view-policy';

describe('validateBrowserUrl', () => {
    it('accepts http(s) URLs, including localhost, and returns the normalized href', () => {
        expect(validateBrowserUrl('https://example.com')).toEqual({ ok: true, url: 'https://example.com/' });
        expect(validateBrowserUrl('http://localhost:5173/app?x=1#h')).toEqual({ ok: true, url: 'http://localhost:5173/app?x=1#h' });
        expect(validateBrowserUrl('  http://127.0.0.1:8080  ')).toEqual({ ok: true, url: 'http://127.0.0.1:8080/' });
    });

    it('rejects non-web schemes as unsupported', () => {
        for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'ftp://x.test/', 'chrome://gpu']) {
            expect(validateBrowserUrl(url)).toEqual({ ok: false, reason: expect.stringMatching(/unsupported|invalid/) });
        }
        expect(validateBrowserUrl('file:///etc/passwd')).toEqual({ ok: false, reason: 'invalid' });
        expect(validateBrowserUrl('ftp://x.test/')).toEqual({ ok: false, reason: 'unsupported' });
    });

    it('rejects malformed input, bare text, control characters and huge strings', () => {
        expect(validateBrowserUrl(undefined)).toEqual({ ok: false, reason: 'invalid' });
        expect(validateBrowserUrl('')).toEqual({ ok: false, reason: 'invalid' });
        expect(validateBrowserUrl('example.com')).toEqual({ ok: false, reason: 'invalid' });
        expect(validateBrowserUrl('https://exa\nmple.com')).toEqual({ ok: false, reason: 'invalid' });
        expect(validateBrowserUrl(`https://a.test/${'x'.repeat(9000)}`)).toEqual({ ok: false, reason: 'invalid' });
    });
});

describe('classifyBrowserNavigation', () => {
    it('allows http(s) and about:blank', () => {
        expect(classifyBrowserNavigation('https://a.test/next')).toBe('allow');
        expect(classifyBrowserNavigation('http://localhost:3000/')).toBe('allow');
        expect(classifyBrowserNavigation('about:blank')).toBe('allow');
    });

    it('denies everything else', () => {
        for (const url of ['file:///tmp/x.html', 'javascript:void 0', 'msteams://open', 'data:text/html,x', 'not a url']) {
            expect(classifyBrowserNavigation(url)).toBe('deny');
        }
    });
});

describe('classifyBrowserWindowOpen', () => {
    it('turns scripted pop-ups with window features into a pop-up window', () => {
        expect(classifyBrowserWindowOpen('https://login.test/auth', 'new-window')).toBe('popup');
        expect(classifyBrowserWindowOpen('about:blank', 'new-window')).toBe('popup');
        expect(classifyBrowserWindowOpen('', 'new-window')).toBe('popup');
    });

    it('turns new-window links into a CoC browser tab', () => {
        expect(classifyBrowserWindowOpen('https://b.test/', 'foreground-tab')).toBe('tab');
        expect(classifyBrowserWindowOpen('http://localhost:8080/', 'background-tab')).toBe('tab');
        expect(classifyBrowserWindowOpen('https://b.test/', 'default')).toBe('tab');
    });

    it('denies non-web targets and blank non-popup opens', () => {
        expect(classifyBrowserWindowOpen('file:///tmp/x.html', 'new-window')).toBe('deny');
        expect(classifyBrowserWindowOpen('javascript:alert(1)', 'foreground-tab')).toBe('deny');
        expect(classifyBrowserWindowOpen('about:blank', 'foreground-tab')).toBe('deny');
        expect(classifyBrowserWindowOpen('', 'foreground-tab')).toBe('deny');
    });
});

describe('browserPartitionFor', () => {
    it('is stable per session key and never persistent', () => {
        const a = browserPartitionFor('ws-1');
        expect(browserPartitionFor('ws-1')).toBe(a);
        expect(a.startsWith('persist:')).toBe(false);
        expect(a).toMatch(/^coc-browser-[0-9a-f]{32}$/);
    });

    it('isolates different owners, including clone routing refs, from each other and from html pages', () => {
        const keys = ['ws-1', 'ws-2', 'remote:srv:ws-1', 'clone:ws-1:abc'];
        const parts = new Set(keys.map(browserPartitionFor));
        expect(parts.size).toBe(keys.length);
        expect(parts.has('coc-html-page')).toBe(false);
    });
});

describe('browserUserAgent', () => {
    it('drops Electron and app tokens but keeps Chrome', () => {
        const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) coc-desktop/3.4.9 Chrome/142.0.0.0 Electron/42.11.9 Safari/537.36';
        expect(browserUserAgent(ua)).toBe('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36');
    });
});

describe('small guards', () => {
    it('validates view ids and session keys', () => {
        expect(isValidBrowserViewId('browser-abc-1')).toBe(true);
        expect(isValidBrowserViewId('')).toBe(false);
        expect(isValidBrowserViewId('a\nb')).toBe(false);
        expect(isValidBrowserViewId(1)).toBe(false);
        expect(isValidBrowserSessionKey('ws-1')).toBe(true);
        expect(isValidBrowserSessionKey('')).toBe(false);
        expect(isValidBrowserSessionKey('x'.repeat(2000))).toBe(false);
    });

    it('recognizes nav actions', () => {
        for (const action of ['back', 'forward', 'reload', 'stop']) {
            expect(isBrowserNavAction(action)).toBe(true);
        }
        expect(isBrowserNavAction('close')).toBe(false);
    });

    it('denies sensitive permissions by default', () => {
        for (const permission of ['media', 'geolocation', 'notifications', 'openExternal']) {
            expect(isBrowserPermissionAllowed(permission)).toBe(false);
        }
        expect(isBrowserPermissionAllowed('clipboard-sanitized-write')).toBe(true);
    });
});
