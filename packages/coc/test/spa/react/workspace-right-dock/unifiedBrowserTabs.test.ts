/**
 * unifiedBrowserTabs — URL normalization and the descriptor a browser tab opens
 * with: http(s) only, `https://` for a bare domain (`http://` for loopback),
 * no search fallback, a fresh tab per open, and no persistence.
 */
import { describe, expect, it } from 'vitest';
import {
    BLANK_BROWSER_LABEL,
    browserLabelForUrl,
    browserOpenInput,
    browserSessionKey,
    hasExplicitUrlScheme,
    normalizeBrowserUrl,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedBrowserTabs';
import {
    EMPTY_UNIFIED_PANEL,
    openTab,
    parseUnifiedPanelState,
    serializeUnifiedPanelState,
    updateBrowserTab,
    visibleTabs,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';

function ok(input: string): string {
    const result = normalizeBrowserUrl(input);
    if (!result.ok) throw new Error(`expected ${input} to normalize: ${result.reason}`);
    return result.url;
}

function rejected(input: string): string {
    const result = normalizeBrowserUrl(input);
    if (result.ok) throw new Error(`expected ${input} to be rejected, got ${result.url}`);
    return result.reason;
}

describe('normalizeBrowserUrl', () => {
    it('enforces the host URL limit on both typed and percent-encoded addresses', () => {
        const prefix = 'https://example.test/';
        expect(ok(prefix + 'x'.repeat(8192 - prefix.length))).toHaveLength(8192);
        expect(rejected(prefix + 'x'.repeat(8193 - prefix.length))).toContain('too long');
        expect(rejected(prefix + '\u754c'.repeat(2000))).toContain('too long');
        expect(rejected('example.test/' + '\u754c'.repeat(2000))).toContain('too long');
    });
    it('keeps explicit http and https URLs', () => {
        expect(ok('https://example.com/a?b=1#c')).toBe('https://example.com/a?b=1#c');
        expect(ok('  http://example.com ')).toBe('http://example.com/');
        expect(ok('HTTPS://Example.COM/Path')).toBe('https://example.com/Path');
    });

    it('accepts localhost and loopback, with or without a scheme', () => {
        expect(ok('http://localhost:3000/app')).toBe('http://localhost:3000/app');
        expect(ok('https://127.0.0.1:8443')).toBe('https://127.0.0.1:8443/');
        expect(ok('localhost:5173')).toBe('http://localhost:5173/');
        expect(ok('localhost')).toBe('http://localhost/');
        expect(ok('127.0.0.1:8080/x')).toBe('http://127.0.0.1:8080/x');
        expect(ok('[::1]:9000')).toBe('http://[::1]:9000/');
        expect(ok('app.localhost:3000')).toBe('http://app.localhost:3000/');
    });

    it('adds https:// to a bare domain', () => {
        expect(ok('example.com')).toBe('https://example.com/');
        expect(ok('docs.example.co.uk/guide?q=1')).toBe('https://docs.example.co.uk/guide?q=1');
        expect(ok('example.com:8080')).toBe('https://example.com:8080/');
        expect(ok('10.0.0.5')).toBe('https://10.0.0.5/');
    });

    it('never treats arbitrary text as a search query', () => {
        expect(rejected('how do I center a div')).toMatch(/Not a URL/);
        expect(rejected('react')).toMatch(/Not a URL/);
        expect(rejected('foo.123')).toMatch(/Not a URL/);
        expect(rejected('/etc/passwd')).toMatch(/Not a URL/);
        expect(rejected('user:pw@example.com')).toBeTruthy();
        expect(rejected('999.1.1.1')).toMatch(/Not a URL/);
    });

    it('rejects unsupported schemes and malformed input with a reason', () => {
        expect(rejected('')).toBe('Enter a URL.');
        expect(rejected('   ')).toBe('Enter a URL.');
        expect(rejected('javascript:alert(1)')).toMatch(/javascript: URLs are not supported/);
        expect(rejected('file:///etc/passwd')).toMatch(/file: URLs are not supported/);
        expect(rejected('ftp://example.com')).toMatch(/ftp: URLs are not supported/);
        expect(rejected('data:text/html,hi')).toMatch(/not supported/);
        expect(rejected('mailto:a@example.com')).toMatch(/not supported/);
        expect(rejected('http://')).toBeTruthy();
        expect(rejected('https://exa mple.com')).toBeTruthy();
    });
});

describe('hasExplicitUrlScheme', () => {
    it('recognizes URLs written with a scheme but not host:port or prose', () => {
        expect(hasExplicitUrlScheme('https://example.com')).toBe(true);
        expect(hasExplicitUrlScheme('ftp://example.com')).toBe(true);
        expect(hasExplicitUrlScheme('javascript:alert(1)')).toBe(true);
        expect(hasExplicitUrlScheme('localhost:3000')).toBe(false);
        expect(hasExplicitUrlScheme('todo: fix')).toBe(false);
        expect(hasExplicitUrlScheme('example.com')).toBe(false);
    });
});

describe('browser tab descriptors', () => {
    const context = { ownerWorkspaceId: 'ws-member', ownerRoutingRef: 'clone:host-a:ws-member', chatId: 'chat-1' };

    it('opens a new workspace-owned tab per request, blank or with a URL', () => {
        const blank = browserOpenInput(context);
        const page = browserOpenInput(context, 'https://example.com/');
        expect(blank.kind).toBe('browser');
        expect(blank.label).toBe(BLANK_BROWSER_LABEL);
        expect(blank.browserUrl).toBeUndefined();
        expect(page.browserUrl).toBe('https://example.com/');
        expect(page.label).toBe('example.com');
        expect(blank.resourceId).not.toBe(page.resourceId);

        let state = openTab(EMPTY_UNIFIED_PANEL, blank);
        state = openTab(state, page);
        state = openTab(state, browserOpenInput(context, 'https://example.com/'));
        expect(state.workspaceTabs.map(tab => tab.kind)).toEqual(['browser', 'browser', 'browser']);
        expect(state.workspaceTabs[1]).toMatchObject({
            chatId: null,
            ownerWorkspaceId: 'ws-member',
            ownerRoutingRef: 'clone:host-a:ws-member',
            browserUrl: 'https://example.com/',
        });
    });

    it('stays visible across chat switches', () => {
        const state = openTab(EMPTY_UNIFIED_PANEL, browserOpenInput(context, 'https://example.com/'));
        expect(visibleTabs(state, 'chat-1')).toHaveLength(1);
        expect(visibleTabs(state, 'chat-2')).toHaveLength(1);
        expect(visibleTabs(state, null)).toHaveLength(1);
    });

    it('is never persisted, and neither is its selection', () => {
        let state = openTab(EMPTY_UNIFIED_PANEL, {
            kind: 'terminal', ownerWorkspaceId: 'ws', chatId: null, resourceId: 'terminal', label: 'Terminal',
        });
        state = openTab(state, browserOpenInput(context, 'https://secret.example.com/session'));
        const raw = serializeUnifiedPanelState(state);
        expect(raw).not.toContain('browser');
        expect(raw).not.toContain('secret.example.com');
        const restored = parseUnifiedPanelState(raw);
        expect(restored.workspaceTabs.map(tab => tab.kind)).toEqual(['terminal']);
        expect(Object.values(restored.activeByScope).every(id => !String(id).includes('browser'))).toBe(true);
    });

    it('follows the page URL and title without activating or recreating the tab', () => {
        let state = openTab(EMPTY_UNIFIED_PANEL, browserOpenInput(context));
        const id = state.workspaceTabs[0].id;
        state = openTab(state, {
            kind: 'terminal', ownerWorkspaceId: 'ws', chatId: null, resourceId: 'terminal', label: 'Terminal',
        });
        const active = state.activeByScope;
        const next = updateBrowserTab(state, id, { url: 'https://a.example/', label: 'A page' });
        expect(next.workspaceTabs[0]).toMatchObject({ id, browserUrl: 'https://a.example/', label: 'A page' });
        expect(next.activeByScope).toBe(active);
        expect(updateBrowserTab(next, id, { url: 'https://a.example/', label: 'A page' })).toBe(next);
        expect(updateBrowserTab(next, id, { label: '  ' })).toBe(next);
        expect(updateBrowserTab(next, 'missing', { label: 'x' })).toBe(next);
    });

    it('labels by host and keys the site session by the concrete owner', () => {
        expect(browserLabelForUrl(undefined)).toBe(BLANK_BROWSER_LABEL);
        expect(browserLabelForUrl('http://localhost:3000/x')).toBe('localhost:3000');
        expect(browserSessionKey({ ownerWorkspaceId: 'ws', ownerRoutingRef: 'clone:h:ws' })).toBe('clone:h:ws');
        expect(browserSessionKey({ ownerWorkspaceId: 'ws', ownerRoutingRef: null })).toBe('ws');
        expect(browserSessionKey({ ownerWorkspaceId: 'ws' })).toBe('ws');
    });
});
