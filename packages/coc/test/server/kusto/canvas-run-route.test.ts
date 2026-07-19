import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../../../src/server/shared/router';
import { registerCanvasRoutes } from '../../../src/server/canvas/canvas-routes';
import { CanvasStore } from '../../../src/server/canvas/canvas-store';
import type { Route } from '../../../src/server/types';
import type { ProcessWebSocketServer } from '../../../src/server/streaming/websocket';
import type { KustoClientFactory, KustoClientLike } from '../../../src/server/kusto/kusto-exec';
import { createEmptyKustoState, parseKustoState, serializeKustoState } from '../../../src/server/canvas/kusto-state';

const WS = 'run-route-ws';

function request(handler: ReturnType<typeof createRouter>, method: string, url: string, body?: unknown): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close(() => reject(new Error('Server did not bind')));
                return;
            }
            const payload = body === undefined ? undefined : JSON.stringify(body);
            const req = http.request({
                hostname: '127.0.0.1',
                port: address.port,
                path: url,
                method,
                headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : undefined,
            }, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => server.close(() => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : undefined });
                }));
            });
            req.on('error', e => server.close(() => reject(e)));
            if (payload) req.write(payload);
            req.end();
        });
    });
}

const okFactory: KustoClientFactory = () =>
    ({
        execute: async () => ({
            primaryResults: [
                { columns: [{ name: 'n', type: 'long' }], rows: () => [{ getValueAt: () => 1 }] },
            ],
        }),
    }) as unknown as KustoClientLike;

function build(kustoEnabled: boolean, factory: KustoClientFactory = okFactory) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-run-route-'));
    const store = new CanvasStore(dataDir);
    const broadcastProcessEvent = vi.fn();
    const routes: Route[] = [];
    registerCanvasRoutes(
        routes,
        dataDir,
        () => ({ broadcastProcessEvent } as unknown as ProcessWebSocketServer),
        undefined,
        () => kustoEnabled,
        factory,
    );
    return { dataDir, store, handler: createRouter({ routes, spaHtml: '' }), broadcastProcessEvent };
}

function seed(store: CanvasStore): string {
    const state = { ...createEmptyKustoState(), query: 'T | take 1', clusterUrl: 'https://c.kusto.windows.net', database: 'DB' };
    return store.createCanvas({ workspaceId: WS, title: 'Kusto Query', type: 'kusto', content: serializeKustoState(state) }).id;
}

describe('POST /canvases/:id/run', () => {
    let ctx: ReturnType<typeof build>;
    afterEach(() => {
        if (ctx) fs.rmSync(ctx.dataDir, { recursive: true, force: true });
    });

    it('404s when the Kusto feature is disabled (AC-08)', async () => {
        ctx = build(false);
        const id = seed(ctx.store);
        const res = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases/${id}/run`, {});
        expect(res.status).toBe(404);
    });

    it('runs the stored query and persists results when enabled', async () => {
        ctx = build(true);
        const id = seed(ctx.store);
        const res = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases/${id}/run`, {});
        expect(res.status).toBe(200);
        const state = parseKustoState(res.body.canvas.content);
        expect(state.rows).toEqual([[1]]);
        expect(state.lastRun?.status).toBe('success');
        expect(ctx.broadcastProcessEvent).toHaveBeenCalled();
    });

    it('applies query/cluster/database overrides from the body', async () => {
        ctx = build(true);
        const id = seed(ctx.store);
        const res = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases/${id}/run`, {
            query: 'Other | take 1',
            clusterUrl: 'https://other.kusto.windows.net',
            database: 'OTHER',
        });
        expect(res.status).toBe(200);
        const state = parseKustoState(res.body.canvas.content);
        expect(state.query).toBe('Other | take 1');
        expect(state.database).toBe('OTHER');
    });

    it('surfaces a query error as stored error state (still 200)', async () => {
        const failing: KustoClientFactory = () => ({
            execute: async () => {
                throw new Error('Semantic error: boom');
            },
        });
        ctx = build(true, failing);
        const id = seed(ctx.store);
        const res = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases/${id}/run`, {});
        expect(res.status).toBe(200);
        const state = parseKustoState(res.body.canvas.content);
        expect(state.lastRun?.status).toBe('error');
        expect(state.lastRun?.error).toContain('boom');
    });

    it('400s for a non-Kusto canvas', async () => {
        ctx = build(true);
        const rec = ctx.store.createCanvas({ workspaceId: WS, title: 'md', content: '# hi', type: 'markdown' });
        const res = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases/${rec.id}/run`, {});
        expect(res.status).toBe(400);
    });

    it('404s for a missing Kusto canvas', async () => {
        ctx = build(true);
        const res = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases/canvas-missing/run`, {});
        expect(res.status).toBe(404);
    });
});
