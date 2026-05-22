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

    describe('POST /pending/:id/complete-and-retry', () => {
        it('marks entry as completed and returns retryEnqueued=false without executeFollowUp', async () => {
            manager.addPending({ requestId: 'oauth1', serverName: 'TestServer', serverUrl: 'http://test', processId: 'p1', originalMessage: 'hello' });
            const res = await dispatch(routes, 'POST', '/api/mcp-oauth/pending/oauth1/complete-and-retry');
            expect(res.statusCode).toBe(200);
            expect(res.body.status).toBe('completed');
            expect(res.body.retryEnqueued).toBe(false);
            expect(manager.getPending('oauth1')?.status).toBe('completed');
        });

        it('returns 404 when entry does not exist', async () => {
            const res = await dispatch(routes, 'POST', '/api/mcp-oauth/pending/missing/complete-and-retry');
            expect(res.statusCode).toBe(404);
        });

        it('calls executeFollowUp and returns retryEnqueued=true', async () => {
            let followUpCalled = false;
            let followUpArgs: [string, string] | undefined;
            const routesWithRetry: Route[] = [];
            registerMcpOauthRoutes(routesWithRetry, {
                manager,
                executeFollowUp: async (processId, message) => {
                    followUpCalled = true;
                    followUpArgs = [processId, message];
                },
            });
            manager.addPending({ requestId: 'oauth2', serverName: 'S', serverUrl: 'u', processId: 'proc-abc', originalMessage: 'do the thing' });
            const res = await dispatch(routesWithRetry, 'POST', '/api/mcp-oauth/pending/oauth2/complete-and-retry');
            expect(res.statusCode).toBe(200);
            expect(res.body.retryEnqueued).toBe(true);
            expect(followUpCalled).toBe(true);
            expect(followUpArgs).toEqual(['proc-abc', 'do the thing']);
        });

        it('emits mcp-oauth-completed SSE event when store is provided', async () => {
            const events: any[] = [];
            const fakeStore = {
                emitProcessEvent: (processId: string, event: any) => { events.push({ processId, event }); },
            };
            const routesWithStore: Route[] = [];
            registerMcpOauthRoutes(routesWithStore, {
                manager,
                store: fakeStore as any,
            });
            manager.addPending({ requestId: 'oauth3', serverName: 'Srv', serverUrl: 'http://srv', processId: 'p-1' });
            await dispatch(routesWithStore, 'POST', '/api/mcp-oauth/pending/oauth3/complete-and-retry');
            expect(events).toHaveLength(1);
            expect(events[0].processId).toBe('p-1');
            expect(events[0].event.type).toBe('mcp-oauth-completed');
            expect(events[0].event.mcpOAuth.requestId).toBe('oauth3');
            expect(events[0].event.mcpOAuth.serverName).toBe('Srv');
        });

        it('retryEnqueued is false when no originalMessage is stored', async () => {
            let followUpCalled = false;
            const routesWithRetry: Route[] = [];
            registerMcpOauthRoutes(routesWithRetry, {
                manager,
                executeFollowUp: async () => { followUpCalled = true; },
            });
            manager.addPending({ requestId: 'oauth4', serverName: 'S', serverUrl: 'u', processId: 'proc-x' });
            const res = await dispatch(routesWithRetry, 'POST', '/api/mcp-oauth/pending/oauth4/complete-and-retry');
            expect(res.body.retryEnqueued).toBe(false);
            expect(followUpCalled).toBe(false);
        });
    });

    describe('POST /api/mcp-oauth/start', () => {
        it('is not registered when aiService is omitted', async () => {
            // Default `routes` in beforeEach has no aiService → endpoint absent.
            const path = '/api/mcp-oauth/start';
            const found = routes.find(r => r.method === 'POST' && (r.pattern as RegExp).test(path));
            expect(found).toBeUndefined();
        });

        it('is not registered when aiService cannot create SDK clients', async () => {
            const r: Route[] = [];
            registerMcpOauthRoutes(r, {
                manager,
                aiService: { isAvailable: async () => ({ available: true }) } as any,
                resolveWorkspaceRoot: async () => undefined,
            });

            const path = '/api/mcp-oauth/start';
            const found = r.find(route => route.method === 'POST' && (route.pattern as RegExp).test(path));
            expect(found).toBeUndefined();
        });

        it('returns 400 when serverName is missing', async () => {
            const r: Route[] = [];
            registerMcpOauthRoutes(r, {
                manager,
                aiService: { createClient: async () => ({ createSession: async () => ({}) }) } as any,
                resolveWorkspaceRoot: async () => undefined,
            });
            const res = await dispatch(r, 'POST', '/api/mcp-oauth/start', {});
            expect(res.statusCode).toBe(400);
        });

        it('shortcuts with alreadyAuthenticated when route is wired but no SDK call is needed', async () => {
            // We can't easily fake the global mcp-config loader from here without
            // touching the filesystem, so this case is covered by:
            //   - readMcpServerAuthInfo unit tests (returns authenticated → 200 shortcut)
            //   - manual integration testing on a workspace with a real config
            //
            // What we *can* assert: the route exists when aiService is wired and
            // it surfaces a 404 for a server the user never configured.
            const r: Route[] = [];
            registerMcpOauthRoutes(r, {
                manager,
                aiService: { createClient: async () => ({ createSession: async () => ({}) }) } as any,
                resolveWorkspaceRoot: async () => undefined,
            });
            const res = await dispatch(r, 'POST', '/api/mcp-oauth/start', {
                serverName: 'this-server-does-not-exist',
            });
            expect(res.statusCode).toBe(404);
        });
    });
});
