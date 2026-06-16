/**
 * AC-03 — per-clone client factory (getCocClientFor) and WS URL derivation
 * (cloneWsUrl). Verifies remote routing is opt-in and local behavior is unchanged.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApiUrl } from '@plusplusoneplusplus/coc-client';
import { getCocClientFor, getSpaCocClient, resetSpaCocClientForTests } from '../../../../src/server/spa/client/react/api/cocClient';
import { cloneWsUrl } from '../../../../src/server/spa/client/react/api/wsUrl';

beforeEach(() => {
    resetSpaCocClientForTests();
});

afterEach(() => {
    resetSpaCocClientForTests();
});

// ── getCocClientFor ───────────────────────────────────────────────────────────

describe('getCocClientFor', () => {
    it('returns the default singleton when baseUrl is undefined', () => {
        expect(getCocClientFor(undefined)).toBe(getSpaCocClient());
    });

    it('returns the default singleton when baseUrl is empty string', () => {
        expect(getCocClientFor('')).toBe(getSpaCocClient());
    });

    it('returns a client bound to the given baseUrl for a remote clone', () => {
        const client = getCocClientFor('http://127.0.0.1:4000');
        expect(client.options.baseUrl).toBe('http://127.0.0.1:4000');
        // Must NOT be the default origin singleton.
        expect(client).not.toBe(getSpaCocClient());
        // Default singleton stays at the page origin (empty baseUrl) — unchanged.
        expect(getSpaCocClient().options.baseUrl).toBe('');
    });

    it('caches and reuses the client per baseUrl (stable identity)', () => {
        const a = getCocClientFor('http://127.0.0.1:4000');
        const b = getCocClientFor('http://127.0.0.1:4000');
        expect(a).toBe(b);
    });

    it('normalizes a trailing slash so it hits the same cache entry', () => {
        const a = getCocClientFor('http://127.0.0.1:4000');
        const b = getCocClientFor('http://127.0.0.1:4000/');
        expect(a).toBe(b);
        expect(b.options.baseUrl).toBe('http://127.0.0.1:4000');
    });

    it('returns distinct clients for distinct baseUrls', () => {
        const a = getCocClientFor('http://127.0.0.1:4000');
        const b = getCocClientFor('http://127.0.0.1:4001');
        expect(a).not.toBe(b);
        expect(a.options.baseUrl).toBe('http://127.0.0.1:4000');
        expect(b.options.baseUrl).toBe('http://127.0.0.1:4001');
    });

    it('routes REST requests to the remote origin (api base preserved)', () => {
        const client = getCocClientFor('http://127.0.0.1:4000');
        // The transport builds request URLs via buildApiUrl(baseUrl, apiBasePath, …);
        // assert that resolves against the remote origin with the standard /api base.
        const url = buildApiUrl(client.options.baseUrl, client.options.apiBasePath, '/workspaces');
        expect(url).toBe('http://127.0.0.1:4000/api/workspaces');
    });
});

// ── cloneWsUrl ────────────────────────────────────────────────────────────────

describe('cloneWsUrl — local (no baseUrl)', () => {
    const original = window.location;

    afterEach(() => {
        Object.defineProperty(window, 'location', { value: original, configurable: true, writable: true });
    });

    function setLocation(href: string) {
        const url = new URL(href);
        Object.defineProperty(window, 'location', {
            value: { ...original, protocol: url.protocol, host: url.host, href },
            configurable: true,
            writable: true,
        });
    }

    it('derives ws:// from an http page origin (legacy behavior)', () => {
        setLocation('http://localhost:3000/dashboard');
        expect(cloneWsUrl('/ws')).toBe('ws://localhost:3000/ws');
    });

    it('derives wss:// from an https page origin', () => {
        setLocation('https://coc.example.com/dashboard');
        expect(cloneWsUrl('/ws')).toBe('wss://coc.example.com/ws');
    });

    it('preserves a terminal path with query string verbatim', () => {
        setLocation('http://localhost:3000/');
        expect(cloneWsUrl('/ws/terminal?workspaceId=abc&cols=80&rows=24'))
            .toBe('ws://localhost:3000/ws/terminal?workspaceId=abc&cols=80&rows=24');
    });

    it('adds a leading slash when the path lacks one', () => {
        setLocation('http://localhost:3000/');
        expect(cloneWsUrl('ws')).toBe('ws://localhost:3000/ws');
    });
});

describe('cloneWsUrl — remote (with baseUrl)', () => {
    it('maps an http baseUrl to ws:// at that host:port', () => {
        expect(cloneWsUrl('/ws', 'http://127.0.0.1:4000')).toBe('ws://127.0.0.1:4000/ws');
    });

    it('maps an https baseUrl to wss://', () => {
        expect(cloneWsUrl('/ws', 'https://remote.example.com')).toBe('wss://remote.example.com/ws');
    });

    it('keeps the host:port from the baseUrl, not the page origin', () => {
        // Even though the page is on :3000, the socket targets the remote :4000.
        expect(cloneWsUrl('/ws', 'http://127.0.0.1:4000')).toContain('127.0.0.1:4000');
    });

    it('preserves a terminal path + query against the remote origin', () => {
        expect(cloneWsUrl('/ws/terminal?workspaceId=abc&cols=80&rows=24', 'http://127.0.0.1:4000'))
            .toBe('ws://127.0.0.1:4000/ws/terminal?workspaceId=abc&cols=80&rows=24');
    });

    it('ignores a trailing slash / path on the baseUrl (origin only)', () => {
        expect(cloneWsUrl('/ws', 'http://127.0.0.1:4000/')).toBe('ws://127.0.0.1:4000/ws');
    });
});
