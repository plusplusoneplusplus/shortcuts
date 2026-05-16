/**
 * Tests for MCP OAuth REST routes (mcp-oauth-routes.ts).
 *
 * Uses in-memory stubs to exercise route logic without HTTP I/O.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { McpOauthManager } from '../../../src/server/mcp-oauth/mcp-oauth-manager';
import { registerMcpOauthRoutes } from '../../../src/server/mcp-oauth/mcp-oauth-routes';
import type { Route } from '../../../src/server/types';

interface FakeRes {
    statusCode: number;
    body: any;
    headers: Record<string, string>;
    writeHead: (status: number, headers?: Record<string, string>) => void;
    end: (data?: string) => void;
    setHeader: (name: string, value: string) => void;
}

function createFakeRes(): FakeRes {
    const res: any = {
        statusCode: 200,
        body: null,
        headers: {},
        writeHead(status: number, headers?: Record<string, string>) {
            res.statusCode = status;
            if (headers) Object.assign(res.headers, headers);
        },
        end(data?: string) {
            if (data) {
                try { res.body = JSON.parse(data); } catch { res.body = data; }
            }
        },
        setHeader(name: string, value: string) {
            res.headers[name.toLowerCase()] = value;
        },
    };
    return res;
}

function createFakeReq(method: string, url: string, body?: Record<string, unknown>) {
    const chunks: Buffer[] = [];
    if (body) chunks.push(Buffer.from(JSON.stringify(body)));
    return {
        method,
        url,
        headers: { 'content-type': 'application/json' },
        on(event: string, cb: (data?: Buffer) => void) {
            if (event === 'data') for (const c of chunks) cb(c);
            if (event === 'end') cb();
            return this;
        },
    } as any;
}

async function dispatch(
    routes: Route[],
    method: string,
    fullUrl: string,
    body?: Record<string, unknown>,
): Promise<FakeRes> {
    const path = fullUrl.split('?')[0];
    const route = routes.find(r => r.method === method && (r.pattern as RegExp).test(path));
    if (!route) throw new Error(`No route matched ${method} ${path}`);
    const match = path.match(route.pattern as RegExp) as RegExpMatchArray;
    const res = createFakeRes();
    const req = createFakeReq(method, fullUrl, body);
    await (route.handler as any)(req, res, match);
    return res;
}

describe('MCP OAuth REST routes', () => {
    let routes: Route[];
    let manager: McpOauthManager;

    beforeEach(() => {
        manager = new McpOauthManager();
        routes = [];
        registerMcpOauthRoutes(routes, { manager });
    });

    it('GET /pending returns empty list when no entries', async () => {
        const res = await dispatch(routes, 'GET', '/api/mcp-oauth/pending');
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ items: [] });
    });

    it('GET /pending returns all entries', async () => {
        manager.addPending({ requestId: 'a', serverName: 's', serverUrl: 'u' });
        manager.addPending({ requestId: 'b', serverName: 's', serverUrl: 'u' });
        const res = await dispatch(routes, 'GET', '/api/mcp-oauth/pending');
        expect(res.statusCode).toBe(200);
        expect(res.body.items.map((i: any) => i.id).sort()).toEqual(['a', 'b']);
    });

    it('GET /pending honors ?status and ?workspaceId filters', async () => {
        manager.addPending({ requestId: 'a', serverName: 's', serverUrl: 'u', workspaceId: 'w1' });
        manager.addPending({ requestId: 'b', serverName: 's', serverUrl: 'u', workspaceId: 'w2' });
        manager.resolve('b', 'completed');
        const filtered = await dispatch(routes, 'GET', '/api/mcp-oauth/pending?status=pending');
        expect(filtered.body.items.map((i: any) => i.id)).toEqual(['a']);
        const byWs = await dispatch(routes, 'GET', '/api/mcp-oauth/pending?workspaceId=w2');
        expect(byWs.body.items.map((i: any) => i.id)).toEqual(['b']);
    });

    it('GET /pending/:id returns entry or 404', async () => {
        manager.addPending({ requestId: 'x', serverName: 's', serverUrl: 'u' });
        const ok = await dispatch(routes, 'GET', '/api/mcp-oauth/pending/x');
        expect(ok.statusCode).toBe(200);
        expect(ok.body.id).toBe('x');
        const miss = await dispatch(routes, 'GET', '/api/mcp-oauth/pending/nope');
        expect(miss.statusCode).toBe(404);
    });

    it('POST /pending/:id/resolve marks status', async () => {
        manager.addPending({ requestId: 'x', serverName: 's', serverUrl: 'u' });
        const res = await dispatch(routes, 'POST', '/api/mcp-oauth/pending/x/resolve', { status: 'completed' });
        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('completed');
        expect(manager.getPending('x')?.status).toBe('completed');
    });

    it('POST /pending/:id/resolve rejects invalid status', async () => {
        manager.addPending({ requestId: 'x', serverName: 's', serverUrl: 'u' });
        const res = await dispatch(routes, 'POST', '/api/mcp-oauth/pending/x/resolve', { status: 'bogus' });
        expect(res.statusCode).toBe(400);
    });

    it('POST /pending/:id/resolve 404s when not found', async () => {
        const res = await dispatch(routes, 'POST', '/api/mcp-oauth/pending/nope/resolve', { status: 'completed' });
        expect(res.statusCode).toBe(404);
    });

    it('DELETE /pending/:id removes entry', async () => {
        manager.addPending({ requestId: 'x', serverName: 's', serverUrl: 'u' });
        const res = await dispatch(routes, 'DELETE', '/api/mcp-oauth/pending/x');
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ removed: true, id: 'x' });
        expect(manager.getPending('x')).toBeUndefined();
    });

    it('DELETE /pending/:id 404s when missing', async () => {
        const res = await dispatch(routes, 'DELETE', '/api/mcp-oauth/pending/nope');
        expect(res.statusCode).toBe(404);
    });
});
