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

const WS = 'route-workspace';

function request(handler: ReturnType<typeof createRouter>, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
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
                path,
                method,
                headers: payload ? {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                } : undefined,
            }, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => {
                    server.close(() => {
                        const text = Buffer.concat(chunks).toString('utf8');
                        resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : undefined });
                    });
                });
            });
            req.on('error', error => server.close(() => reject(error)));
            if (payload) req.write(payload);
            req.end();
        });
    });
}

describe('canvas routes', () => {
    let dataDir: string;
    let store: CanvasStore;
    let handler: ReturnType<typeof createRouter>;
    let broadcastProcessEvent: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-canvas-routes-'));
        store = new CanvasStore(dataDir);
        broadcastProcessEvent = vi.fn();
        const routes: Route[] = [];
        registerCanvasRoutes(routes, dataDir, () => ({ broadcastProcessEvent } as unknown as ProcessWebSocketServer));
        handler = createRouter({ routes, spaHtml: '' });
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('lists canvases, optionally filtered by processId', async () => {
        store.createCanvas({ workspaceId: WS, title: 'A', content: 'a', processId: 'p1' });
        const b = store.createCanvas({ workspaceId: WS, title: 'B', content: 'b', processId: 'p2' });

        const all = await request(handler, 'GET', `/api/workspaces/${WS}/canvases`);
        expect(all.status).toBe(200);
        expect(all.body.canvases).toHaveLength(2);

        const filtered = await request(handler, 'GET', `/api/workspaces/${WS}/canvases?processId=p2`);
        expect(filtered.status).toBe(200);
        expect(filtered.body.canvases).toHaveLength(1);
        expect(filtered.body.canvases[0].id).toBe(b.id);
    });

    it('returns a full canvas record', async () => {
        const c = store.createCanvas({ workspaceId: WS, title: 'Doc', content: '# Body' });
        const res = await request(handler, 'GET', `/api/workspaces/${WS}/canvases/${c.id}`);
        expect(res.status).toBe(200);
        expect(res.body.canvas.content).toBe('# Body');
        expect(res.body.canvas.revision).toBe(1);
    });

    it('404s on a missing canvas and 400s on an invalid id', async () => {
        const missing = await request(handler, 'GET', `/api/workspaces/${WS}/canvases/missing-000000`);
        expect(missing.status).toBe(404);

        const invalid = await request(handler, 'GET', `/api/workspaces/${WS}/canvases/..%2Fescape`);
        expect(invalid.status).toBe(400);
    });

    it('saves user content with a revision check and broadcasts canvas-updated', async () => {
        const c = store.createCanvas({ workspaceId: WS, title: 'Doc', content: 'old', processId: 'p1' });

        const res = await request(handler, 'PUT', `/api/workspaces/${WS}/canvases/${c.id}`, {
            content: 'new',
            expectedRevision: 1,
        });

        expect(res.status).toBe(200);
        expect(res.body.canvas.content).toBe('new');
        expect(res.body.canvas.revision).toBe(2);
        expect(res.body.canvas.lastEditor).toBe('user');

        expect(broadcastProcessEvent).toHaveBeenCalledWith(expect.objectContaining({
            type: 'canvas-updated',
            workspaceId: WS,
            canvasId: c.id,
            processId: 'p1',
            revision: 2,
            editor: 'user',
        }));
    });

    it('returns 409 with the current record on a stale save', async () => {
        const c = store.createCanvas({ workspaceId: WS, title: 'Doc', content: 'v1' });
        store.updateCanvas(WS, c.id, { content: 'v2', editor: 'ai' });

        const res = await request(handler, 'PUT', `/api/workspaces/${WS}/canvases/${c.id}`, {
            content: 'stale write',
            expectedRevision: 1,
        });

        expect(res.status).toBe(409);
        expect(res.body.error).toBe('revision-conflict');
        expect(res.body.currentRevision).toBe(2);
        expect(res.body.canvas.content).toBe('v2');
        expect(broadcastProcessEvent).not.toHaveBeenCalled();
    });

    it('lists version snapshots and serves a single version', async () => {
        const c = store.createCanvas({ workspaceId: WS, title: 'Doc', content: 'v1' });
        store.updateCanvas(WS, c.id, { content: 'v2', editor: 'ai' });

        const list = await request(handler, 'GET', `/api/workspaces/${WS}/canvases/${c.id}/versions`);
        expect(list.status).toBe(200);
        expect(list.body.versions.map((v: any) => v.revision)).toEqual([2, 1]);
        expect(list.body.versions[0].content).toBeUndefined();

        const v1 = await request(handler, 'GET', `/api/workspaces/${WS}/canvases/${c.id}/versions/1`);
        expect(v1.status).toBe(200);
        expect(v1.body.version.content).toBe('v1');

        const missing = await request(handler, 'GET', `/api/workspaces/${WS}/canvases/${c.id}/versions/9`);
        expect(missing.status).toBe(404);
    });

    it('adds, lists, patches, and deletes comments', async () => {
        const c = store.createCanvas({ workspaceId: WS, title: 'Doc', content: 'alpha beta' });

        const created = await request(handler, 'POST', `/api/workspaces/${WS}/canvases/${c.id}/comments`, {
            anchorText: 'alpha',
            body: 'rename this',
        });
        expect(created.status).toBe(201);
        const commentId = created.body.comment.id;
        expect(created.body.comment.status).toBe('open');

        const listed = await request(handler, 'GET', `/api/workspaces/${WS}/canvases/${c.id}/comments?status=open`);
        expect(listed.status).toBe(200);
        expect(listed.body.comments).toHaveLength(1);

        const patched = await request(handler, 'PATCH', `/api/workspaces/${WS}/canvases/${c.id}/comments/${commentId}`, {
            status: 'sent',
        });
        expect(patched.status).toBe(200);
        expect(patched.body.comment.status).toBe('sent');

        const openAfter = await request(handler, 'GET', `/api/workspaces/${WS}/canvases/${c.id}/comments?status=open`);
        expect(openAfter.body.comments).toHaveLength(0);

        const deleted = await request(handler, 'DELETE', `/api/workspaces/${WS}/canvases/${c.id}/comments/${commentId}`);
        expect(deleted.status).toBe(200);
        const afterDelete = await request(handler, 'GET', `/api/workspaces/${WS}/canvases/${c.id}/comments`);
        expect(afterDelete.body.comments).toHaveLength(0);
    });

    it('validates comment payloads and unknown targets', async () => {
        const c = store.createCanvas({ workspaceId: WS, title: 'Doc', content: 'text' });

        const noBody = await request(handler, 'POST', `/api/workspaces/${WS}/canvases/${c.id}/comments`, { anchorText: 'text' });
        expect(noBody.status).toBe(400);

        const badStatus = await request(handler, 'PATCH', `/api/workspaces/${WS}/canvases/${c.id}/comments/whatever`, { status: 'bogus' });
        expect(badStatus.status).toBe(400);

        const missingCanvas = await request(handler, 'POST', `/api/workspaces/${WS}/canvases/missing-000000/comments`, { anchorText: 'a', body: 'b' });
        expect(missingCanvas.status).toBe(404);

        const missingComment = await request(handler, 'PATCH', `/api/workspaces/${WS}/canvases/${c.id}/comments/nope`, { status: 'sent' });
        expect(missingComment.status).toBe(404);
    });

    it('rejects an empty save body', async () => {
        const c = store.createCanvas({ workspaceId: WS, title: 'Doc', content: 'v1' });
        const res = await request(handler, 'PUT', `/api/workspaces/${WS}/canvases/${c.id}`, {});
        expect(res.status).toBe(400);
    });
});
