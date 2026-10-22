import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    BrowserNavigationApprovals, addBrowserApprovedSite, browserApprovalSite, getBrowserApprovedSitesPath,
    readBrowserApprovedSites, removeBrowserApprovedSite,
} from '../../../src/server/llm-tools/browser-navigation-approval';
import { registerBrowserRoutes } from '../../../src/server/admin/admin-browser-routes';
import type { Route } from '../../../src/server/types';

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

describe('BrowserNavigationApprovals', () => {
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-approvals-'));
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('scopes "Allow once" to one conversation', () => {
        const approvals = new BrowserNavigationApprovals(dataDir);
        expect(approvals.isAllowed('ws1', 'p1', 'google.com')).toBe(false);
        approvals.allowOnce('ws1', 'p1', 'google.com');
        expect(approvals.isAllowed('ws1', 'p1', 'google.com')).toBe(true);
        expect(approvals.isAllowed('ws1', 'p2', 'google.com')).toBe(false);
        expect(approvals.isAllowed('ws2', 'p1', 'google.com')).toBe(false);
        expect(readBrowserApprovedSites(dataDir)).toEqual([]);
        approvals.forgetConversation('ws1', 'p1');
        expect(approvals.isAllowed('ws1', 'p1', 'google.com')).toBe(false);
    });

    it('keeps "Always allow" for every workspace and across restarts', () => {
        new BrowserNavigationApprovals(dataDir).allowAlways('GitHub.com');
        const restarted = new BrowserNavigationApprovals(dataDir);
        expect(restarted.isAllowed('ws1', 'p1', 'github.com')).toBe(true);
        expect(restarted.isAllowed('ws2', 'p9', 'github.com')).toBe(true);
        expect(readBrowserApprovedSites(dataDir)).toEqual(['github.com']);
    });

    it('stops allowing a site once it is removed from the global list', () => {
        const approvals = new BrowserNavigationApprovals(dataDir);
        approvals.allowAlways('bbc.co.uk');
        expect(removeBrowserApprovedSite(dataDir, 'bbc.co.uk')).toBe(true);
        expect(removeBrowserApprovedSite(dataDir, 'bbc.co.uk')).toBe(false);
        expect(approvals.isAllowed('ws1', 'p1', 'bbc.co.uk')).toBe(false);
    });

    it('stores a sorted, de-duplicated list and ignores corrupt files', () => {
        addBrowserApprovedSite(dataDir, 'b.com');
        addBrowserApprovedSite(dataDir, 'a.com');
        addBrowserApprovedSite(dataDir, 'b.com');
        expect(JSON.parse(fs.readFileSync(getBrowserApprovedSitesPath(dataDir), 'utf8'))).toEqual({ sites: ['a.com', 'b.com'] });
        expect(fs.readdirSync(dataDir)).toEqual(['browser-approved-sites.json']);
        fs.writeFileSync(getBrowserApprovedSitesPath(dataDir), '{not json');
        expect(readBrowserApprovedSites(dataDir)).toEqual([]);
        fs.writeFileSync(getBrowserApprovedSitesPath(dataDir), JSON.stringify({ sites: ['x.com', 3, '', 'x.com'] }));
        expect(readBrowserApprovedSites(dataDir)).toEqual(['x.com']);
    });
});

describe('admin browser approved-site routes', () => {
    let dataDir: string;
    let routes: Route[];

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-approval-routes-'));
        routes = [];
        registerBrowserRoutes(routes, { store: {} as never, dataDir });
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function call(method: string, url: string): Promise<{ status: number; body: any }> {
        const route = routes.find(r => r.method === method && (typeof r.pattern === 'string' ? r.pattern === url : r.pattern.test(url)))!;
        const match = typeof route.pattern === 'string' ? null : url.match(route.pattern);
        let status = 0;
        let raw = '';
        const res = {
            writeHead: (code: number) => { status = code; return res; },
            setHeader: () => {},
            end: (chunk?: string) => { raw += chunk ?? ''; },
            headersSent: false,
        };
        await route.handler({ method, url } as never, res as never, match as never);
        return { status, body: raw ? JSON.parse(raw) : undefined };
    }

    it('lists and removes always-allowed sites', async () => {
        addBrowserApprovedSite(dataDir, 'google.com');
        addBrowserApprovedSite(dataDir, 'bbc.co.uk');
        expect(await call('GET', '/api/admin/browser-approved-sites')).toEqual({ status: 200, body: { sites: ['bbc.co.uk', 'google.com'] } });

        const removed = await call('DELETE', `/api/admin/browser-approved-sites/${encodeURIComponent('google.com')}`);
        expect(removed).toEqual({ status: 200, body: { site: 'google.com', removed: true, sites: ['bbc.co.uk'] } });
        expect(readBrowserApprovedSites(dataDir)).toEqual(['bbc.co.uk']);
    });

    it('returns 404 when removing a site that is not listed', async () => {
        expect((await call('DELETE', '/api/admin/browser-approved-sites/nope.com')).status).toBe(404);
    });
});
