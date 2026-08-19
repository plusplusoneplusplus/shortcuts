/**
 * Canvas update fanout — exactly one event per channel, per successful mutation.
 *
 * A canvas change has to reach two independent realtime channels: a
 * `canvas-updated` WebSocket event (other dashboard tabs) and a ProcessStore/SSE
 * event (the chat timeline and chat-side canvas panel). Before the mutation
 * service, the user-save route open-coded only the WebSocket half, so a manual
 * edit refreshed other tabs but never the process timeline — while create,
 * capability and Kusto mutations emitted both.
 *
 * These tests pin BOTH halves for every mutation type, and pin the counts, so
 * neither a dropped channel nor a double-emitted one can come back unnoticed.
 */
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
import type { ProcessStore } from '@plusplusoneplusplus/forge';

const WS = 'fanout-workspace';
const PROC = 'proc-fanout';

function request(handler: ReturnType<typeof createRouter>, method: string, urlPath: string, body?: unknown): Promise<{ status: number; body: any }> {
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
                path: urlPath,
                method,
                headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : undefined,
            }, res => {
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

describe('canvas update fanout', () => {
    let dataDir: string;
    let store: CanvasStore;
    let handler: ReturnType<typeof createRouter>;
    let broadcastProcessEvent: ReturnType<typeof vi.fn>;
    let emitProcessEvent: ReturnType<typeof vi.fn>;

    /** WebSocket `canvas-updated` events seen for a given canvas. */
    const wsEvents = (canvasId: string) =>
        broadcastProcessEvent.mock.calls
            .map(call => call[0])
            .filter(event => event?.type === 'canvas-updated' && event.canvasId === canvasId);

    /** ProcessStore/SSE `canvas-updated` events seen for a given canvas. */
    const sseEvents = (canvasId: string) =>
        emitProcessEvent.mock.calls
            .map(call => call[1])
            .filter(event => event?.type === 'canvas-updated' && event.canvasUpdate?.canvasId === canvasId);

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-canvas-fanout-'));
        store = new CanvasStore(dataDir);
        broadcastProcessEvent = vi.fn();
        emitProcessEvent = vi.fn();
        const processStore = { emitProcessEvent } as unknown as ProcessStore;
        const routes: Route[] = [];
        registerCanvasRoutes(
            routes,
            dataDir,
            () => ({ broadcastProcessEvent } as unknown as ProcessWebSocketServer),
            processStore,
            () => true,
            undefined,
            () => true,
        );
        handler = createRouter({ routes, spaHtml: '' });
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    /**
     * The regression the mutation service was extracted for: a user save used to
     * emit only the WebSocket half, so the chat timeline never learned the
     * canvas changed.
     */
    it('regression: a user save emits BOTH the WebSocket and the process/SSE update', async () => {
        const canvas = store.createCanvas({ workspaceId: WS, title: 'Doc', content: 'a', processId: PROC });

        const res = await request(handler, 'PUT', `/api/workspaces/${WS}/canvases/${canvas.id}`, {
            content: 'b',
            expectedRevision: canvas.revision,
        });

        expect(res.status).toBe(200);
        expect(wsEvents(canvas.id)).toHaveLength(1);
        expect(wsEvents(canvas.id)[0]).toMatchObject({
            workspaceId: WS,
            processId: PROC,
            editor: 'user',
            revision: res.body.canvas.revision,
        });
        expect(sseEvents(canvas.id)).toHaveLength(1);
    });

    it('emits both channels exactly once for a capability invocation', async () => {
        const canvas = store.createCanvas({
            workspaceId: WS,
            title: 'Counter',
            type: 'extension',
            content: '{"count":0}',
            processId: PROC,
        });
        store.saveExtension(WS, canvas.id, {
            manifest: { description: 'Counter', capabilities: [{ name: 'bump', description: 'bump' }] },
            uiHtml: '<div></div>',
            capabilitiesJs: 'capabilities = { bump: function (s) { return { count: (s.count || 0) + 1 }; } };',
        });

        const res = await request(handler, 'POST', `/api/workspaces/${WS}/canvases/${canvas.id}/capabilities/bump`, {});

        expect(res.status).toBe(200);
        expect(wsEvents(canvas.id)).toHaveLength(1);
        expect(sseEvents(canvas.id)).toHaveLength(1);
    });

    it('emits both channels exactly once for a manual Kusto create', async () => {
        const res = await request(handler, 'POST', `/api/workspaces/${WS}/canvases`, {
            type: 'kusto',
            title: 'Q',
            content: '{"query":"T | take 1"}',
            processId: PROC,
        });

        expect(res.status).toBe(201);
        const canvasId = res.body.canvas.id;
        expect(wsEvents(canvasId)).toHaveLength(1);
        expect(sseEvents(canvasId)).toHaveLength(1);
    });

    it('stays silent on a failed mutation — no channel announces a change that did not happen', async () => {
        const canvas = store.createCanvas({ workspaceId: WS, title: 'Doc', content: 'a', processId: PROC });

        const stale = await request(handler, 'PUT', `/api/workspaces/${WS}/canvases/${canvas.id}`, {
            content: 'b',
            expectedRevision: canvas.revision - 1,
        });
        const missing = await request(handler, 'PUT', `/api/workspaces/${WS}/canvases/canvas-does-not-exist`, {
            content: 'b',
        });

        expect(stale.status).toBe(409);
        expect(missing.status).toBe(404);
        expect(wsEvents(canvas.id)).toHaveLength(0);
        expect(emitProcessEvent).not.toHaveBeenCalled();
    });

    /**
     * A canvas with no owning process has no timeline to notify. That is the one
     * case where a channel is legitimately silent — the WebSocket half must
     * still fire, so other tabs refresh.
     */
    it('skips only the process/SSE half for a canvas with no processId', async () => {
        const canvas = store.createCanvas({ workspaceId: WS, title: 'Loose', content: 'a' });

        const res = await request(handler, 'PUT', `/api/workspaces/${WS}/canvases/${canvas.id}`, {
            content: 'b',
            expectedRevision: canvas.revision,
        });

        expect(res.status).toBe(200);
        expect(wsEvents(canvas.id)).toHaveLength(1);
        expect(emitProcessEvent).not.toHaveBeenCalled();
    });
});
