/**
 * Unit tests for the RouteTable registry that replaced the server root's inline
 * if-chain. Focus: first-match-wins ordering, method/path matching, and the
 * method-fallthrough behavior that preserves the old `/api/preferences` 404.
 */

import { describe, it, expect } from 'vitest';
import { URL } from 'url';
import { RouteTable, type RouteContext } from '../../src/server/http-util';

function ctx(method: string, pathname: string): RouteContext {
    return { method, url: new URL(`http://localhost${pathname}`), req: {} as any, res: {} as any };
}

describe('RouteTable', () => {
    it('dispatches to the first matching route (registration order wins)', async () => {
        const hits: string[] = [];
        const table = new RouteTable();
        table.on('GET', '/a', () => { hits.push('first'); });
        table.on('GET', '/a', () => { hits.push('second'); });
        const handled = await table.dispatch(ctx('GET', '/a'));
        expect(handled).toBe(true);
        expect(hits).toEqual(['first']);
    });

    it('returns false when no route matches (path or method)', async () => {
        const table = new RouteTable();
        table.on('GET', '/a', () => {});
        expect(await table.dispatch(ctx('POST', '/a'))).toBe(false);
        expect(await table.dispatch(ctx('GET', '/b'))).toBe(false);
    });

    it('on() matches method + path exactly', async () => {
        let hit = false;
        const table = new RouteTable();
        table.on('POST', '/x', () => { hit = true; });
        expect(await table.dispatch(ctx('GET', '/x'))).toBe(false);
        expect(hit).toBe(false);
        expect(await table.dispatch(ctx('POST', '/x'))).toBe(true);
        expect(hit).toBe(true);
    });

    it('onPrefix() matches by pathname prefix (trailing slash preserved)', async () => {
        const seen: string[] = [];
        const table = new RouteTable();
        table.onPrefix('DELETE', '/api/agents/', ({ url }) => { seen.push(url.pathname); });
        // Exact path without trailing slash must NOT match the prefix route
        expect(await table.dispatch(ctx('DELETE', '/api/agents'))).toBe(false);
        expect(await table.dispatch(ctx('DELETE', '/api/agents/abc'))).toBe(true);
        expect(seen).toEqual(['/api/agents/abc']);
    });

    it('when() lets a path matched only on some methods fall through (preferences 404)', async () => {
        const table = new RouteTable();
        table.when(
            (m, url) => url.pathname === '/api/preferences' && (m === 'GET' || m === 'PATCH' || m === 'PUT'),
            () => {},
        );
        expect(await table.dispatch(ctx('DELETE', '/api/preferences'))).toBe(false);
        expect(await table.dispatch(ctx('GET', '/api/preferences'))).toBe(true);
        expect(await table.dispatch(ctx('PUT', '/api/preferences'))).toBe(true);
    });

    it('awaits async handlers before resolving dispatch', async () => {
        let done = false;
        const table = new RouteTable();
        table.on('GET', '/a', async () => { await Promise.resolve(); done = true; });
        await table.dispatch(ctx('GET', '/a'));
        expect(done).toBe(true);
    });
});
