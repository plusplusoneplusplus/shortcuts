import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../../../src/server/shared/router';
import { registerCanvasRoutes } from '../../../src/server/canvas/canvas-routes';
import { CanvasStore } from '../../../src/server/canvas/canvas-store';
import type { Route } from '../../../src/server/types';
import type { ProcessWebSocketServer } from '../../../src/server/streaming/websocket';
import { parseExplorationState } from '../../../src/server/canvas/exploration-state';

const WS = 'create-route-ws';

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

function build(explorationEnabled: boolean) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-create-route-'));
    const store = new CanvasStore(dataDir);
    const broadcastProcessEvent = vi.fn();
    const routes: Route[] = [];
    registerCanvasRoutes(
        routes,
        dataDir,
        () => ({ broadcastProcessEvent } as unknown as ProcessWebSocketServer),
        undefined,
        () => explorationEnabled,
    );
    return { dataDir, store, handler: createRouter({ routes, spaHtml: '' }), broadcastProcessEvent };
}

const blankContent = JSON.stringify({ query: '', clusterUrl: 'https://c.kusto.windows.net', database: 'DB', columns: [], rows: [], truncated: false });

describe('POST /canvases (manual exploration create, AC-07)', () => {
    let ctx: ReturnType<typeof build>;
    afterEach(() => {
        if (ctx) fs.rmSync(ctx.dataDir, { recursive: true, force: true });
    });

    it('404s when the exploration feature is disabled (AC-08)', async () => {
        ctx = build(false);
        const res = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases`, {
            type: 'exploration', title: 'Exploration', content: blankContent,
        });
        expect(res.status).toBe(404);
    });

    it('creates an exploration canvas and persists the seeded content', async () => {
        ctx = build(true);
        const res = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases`, {
            type: 'exploration', title: 'Exploration', content: blankContent, processId: 'proc-1',
        });
        expect(res.status).toBe(201);
        expect(res.body.canvas.type).toBe('exploration');
        expect(res.body.canvas.processId).toBe('proc-1');
        const state = parseExplorationState(res.body.canvas.content);
        expect(state.clusterUrl).toBe('https://c.kusto.windows.net');
        expect(state.database).toBe('DB');
        // Round-trips through the store.
        expect(ctx.store.getCanvas(WS, res.body.canvas.id)?.type).toBe('exploration');
        expect(ctx.broadcastProcessEvent).toHaveBeenCalled();
    });

    it('400s for a non-exploration type', async () => {
        ctx = build(true);
        const res = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases`, {
            type: 'markdown', title: 'md', content: '# hi',
        });
        expect(res.status).toBe(400);
    });

    it('400s when content is missing', async () => {
        ctx = build(true);
        const res = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases`, {
            type: 'exploration', title: 'Exploration',
        });
        expect(res.status).toBe(400);
    });
});
