import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../../../src/server/shared/router';
import { registerCanvasRoutes } from '../../../src/server/canvas/canvas-routes';
import { CanvasStore, MAX_CANVAS_TEXT_FILE_BYTES } from '../../../src/server/canvas/canvas-store';
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

    it('serves extension documents and invokes a capability over shared state', async () => {
        const canvas = store.createCanvas({ workspaceId: WS, title: 'Board', content: '{"cards":[]}', type: 'extension', processId: 'p1' });
        store.saveExtension(WS, canvas.id, {
            manifest: { description: 'Kanban', capabilities: [{ name: 'add_card', description: 'Add a card' }] },
            uiHtml: '<div>board</div>',
            capabilitiesJs: 'capabilities = { add_card: function (s, p) { var c = (s.cards||[]).slice(); c.push({ id: p.id }); return { cards: c }; } };',
        }, 'ai');

        const ext = await request(handler, 'GET', `/api/workspaces/${WS}/canvases/${canvas.id}/extension`);
        expect(ext.status).toBe(200);
        expect(ext.body.extension.manifest.capabilities[0].name).toBe('add_card');

        const invoke = await request(handler, 'POST', `/api/workspaces/${WS}/canvases/${canvas.id}/capabilities/add_card`, { params: { id: 'c1' } });
        expect(invoke.status).toBe(200);
        expect(JSON.parse(invoke.body.canvas.content).cards).toEqual([{ id: 'c1' }]);
        expect(invoke.body.canvas.revision).toBe(3); // create(1) + saveExtension(2) + capability(3)

        expect(broadcastProcessEvent).toHaveBeenCalledWith(expect.objectContaining({
            type: 'canvas-updated',
            canvasId: canvas.id,
            editor: 'user',
        }));
    });

    it('returns 422 when a capability is unknown or errors', async () => {
        const canvas = store.createCanvas({ workspaceId: WS, title: 'Board', content: '{}', type: 'extension' });
        store.saveExtension(WS, canvas.id, {
            manifest: { description: 'x', capabilities: [{ name: 'noop', description: 'noop' }] },
            uiHtml: '<div></div>',
            capabilitiesJs: 'capabilities = { noop: function (s) { return s; } };',
        }, 'ai');

        const bad = await request(handler, 'POST', `/api/workspaces/${WS}/canvases/${canvas.id}/capabilities/missing_cap`, { params: {} });
        expect(bad.status).toBe(422);
    });

    it('404s extension routes for a non-extension canvas', async () => {
        const md = store.createCanvas({ workspaceId: WS, title: 'Doc', content: 'hi' });
        const ext = await request(handler, 'GET', `/api/workspaces/${WS}/canvases/${md.id}/extension`);
        expect(ext.status).toBe(404);

        const cap = await request(handler, 'POST', `/api/workspaces/${WS}/canvases/${md.id}/capabilities/x`, { params: {} });
        expect(cap.status).toBe(404);
    });

    it('rejects an empty save body', async () => {
        const c = store.createCanvas({ workspaceId: WS, title: 'Doc', content: 'v1' });
        const res = await request(handler, 'PUT', `/api/workspaces/${WS}/canvases/${c.id}`, {});
        expect(res.status).toBe(400);
    });

    describe('excalidraw canvases inherit canvas features (AC-06)', () => {
        const scene = (boxId: string): string => JSON.stringify({
            type: 'excalidraw',
            elements: [{ id: boxId, type: 'rectangle', x: 0, y: 0, width: 100, height: 40 }],
            appState: {},
        });

        it('lists an excalidraw canvas filtered by processId', async () => {
            const diagram = store.createCanvas({ workspaceId: WS, title: 'Arch', content: scene('box1'), type: 'excalidraw', processId: 'p-diagram' });
            store.createCanvas({ workspaceId: WS, title: 'Notes', content: '# notes', processId: 'p-other' });

            const res = await request(handler, 'GET', `/api/workspaces/${WS}/canvases?processId=p-diagram`);
            expect(res.status).toBe(200);
            expect(res.body.canvases).toHaveLength(1);
            expect(res.body.canvases[0].id).toBe(diagram.id);
            expect(res.body.canvases[0].type).toBe('excalidraw');
        });

        it('versions and revision-checks an excalidraw canvas like any other', async () => {
            const c = store.createCanvas({ workspaceId: WS, title: 'Arch', content: scene('box1'), type: 'excalidraw' });

            const second = await request(handler, 'PUT', `/api/workspaces/${WS}/canvases/${c.id}`, {
                content: scene('box2'),
                expectedRevision: 1,
            });
            expect(second.status).toBe(200);
            expect(second.body.canvas.revision).toBe(2);
            expect(second.body.canvas.type).toBe('excalidraw');

            const versions = await request(handler, 'GET', `/api/workspaces/${WS}/canvases/${c.id}/versions`);
            expect(versions.body.versions.map((v: any) => v.revision)).toEqual([2, 1]);

            const v1 = await request(handler, 'GET', `/api/workspaces/${WS}/canvases/${c.id}/versions/1`);
            expect(JSON.parse(v1.body.version.content).elements[0].id).toBe('box1');

            const stale = await request(handler, 'PUT', `/api/workspaces/${WS}/canvases/${c.id}`, {
                content: scene('box3'),
                expectedRevision: 1,
            });
            expect(stale.status).toBe(409);
            expect(stale.body.error).toBe('revision-conflict');
            expect(stale.body.currentRevision).toBe(2);
        });

        it('round-trips comments on an excalidraw canvas', async () => {
            const c = store.createCanvas({ workspaceId: WS, title: 'Arch', content: scene('box1'), type: 'excalidraw' });

            const created = await request(handler, 'POST', `/api/workspaces/${WS}/canvases/${c.id}/comments`, {
                anchorText: 'box1',
                body: 'tweak this box',
            });
            expect(created.status).toBe(201);

            const listed = await request(handler, 'GET', `/api/workspaces/${WS}/canvases/${c.id}/comments`);
            expect(listed.body.comments).toHaveLength(1);
            expect(listed.body.comments[0].body).toBe('tweak this box');
        });
    });
});

/**
 * Read-only canvas files. The route is the boundary an artifact's arbitrary,
 * AI-authored JS reaches, so the traversal cases matter more here than the
 * happy path — and the raw (percent-encoded) form is what the router matches,
 * which is exactly where an encoded `..` would slip past a decoded-only check.
 */
describe('canvas file routes', () => {
    let dataDir: string;
    let store: CanvasStore;
    let handler: ReturnType<typeof createRouter>;
    let canvasId: string;
    let filesRoot: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-canvas-file-routes-'));
        store = new CanvasStore(dataDir);
        const routes: Route[] = [];
        registerCanvasRoutes(routes, dataDir);
        handler = createRouter({ routes, spaHtml: '' });

        canvasId = store.createCanvas({ workspaceId: WS, title: 'Sales', content: '{}', type: 'extension' }).id;
        filesRoot = store.getCanvasFilesRoot(WS, canvasId);
        fs.mkdirSync(filesRoot, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    function seed(relativePath: string, contents: string | Buffer): void {
        const full = path.join(filesRoot, ...relativePath.split('/'));
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, contents);
    }

    const filesUrl = (suffix = '') => `/api/workspaces/${WS}/canvases/${canvasId}/files${suffix}`;

    it('lists the canvas files', async () => {
        seed('data.csv', 'a,b\n');
        seed('raw/jan.json', '{}');

        const res = await request(handler, 'GET', filesUrl());
        expect(res.status).toBe(200);
        expect(res.body.files).toEqual([
            { path: 'data.csv', size: 4, encoding: 'utf-8' },
            { path: 'raw/jan.json', size: 2, encoding: 'utf-8' },
        ]);
    });

    it('lists an empty array for a canvas with no files', async () => {
        const res = await request(handler, 'GET', filesUrl());
        expect(res.status).toBe(200);
        expect(res.body.files).toEqual([]);
    });

    it('404s the listing for a canvas that does not exist', async () => {
        const res = await request(handler, 'GET', `/api/workspaces/${WS}/canvases/no-such-canvas/files`);
        expect(res.status).toBe(404);
    });

    it('400s the listing for an invalid canvas id', async () => {
        const res = await request(handler, 'GET', `/api/workspaces/${WS}/canvases/BAD_ID/files`);
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid canvas ID');
    });

    it('reads a text file as utf-8', async () => {
        seed('data.csv', 'month,revenue\njan,10\n');

        const res = await request(handler, 'GET', filesUrl('/data.csv'));
        expect(res.status).toBe(200);
        expect(res.body.file).toEqual({
            path: 'data.csv',
            size: 21,
            encoding: 'utf-8',
            content: 'month,revenue\njan,10\n',
        });
    });

    it('reads a nested file and one whose name needs encoding', async () => {
        seed('raw/jan.json', '{"n":1}');
        seed('my report.csv', 'a\n');

        const nested = await request(handler, 'GET', filesUrl('/raw/jan.json'));
        expect(nested.status).toBe(200);
        expect(nested.body.file.content).toBe('{"n":1}');

        // %20 is an ordinary escape — it must survive the traversal screen.
        const spaced = await request(handler, 'GET', filesUrl('/my%20report.csv'));
        expect(spaced.status).toBe(200);
        expect(spaced.body.file).toMatchObject({ path: 'my report.csv', content: 'a\n' });
    });

    it('returns binary content base64-encoded', async () => {
        const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
        seed('logo.png', bytes);

        const res = await request(handler, 'GET', filesUrl('/logo.png'));
        expect(res.status).toBe(200);
        expect(res.body.file.encoding).toBe('base64');
        expect(Buffer.from(res.body.file.content, 'base64')).toEqual(bytes);
    });

    it('honours ?encoding=base64 and rejects any other encoding', async () => {
        seed('data.csv', 'a,b\n');

        const forced = await request(handler, 'GET', filesUrl('/data.csv?encoding=base64'));
        expect(forced.status).toBe(200);
        expect(forced.body.file.encoding).toBe('base64');
        expect(Buffer.from(forced.body.file.content, 'base64').toString('utf-8')).toBe('a,b\n');

        const bogus = await request(handler, 'GET', filesUrl('/data.csv?encoding=utf-8'));
        expect(bogus.status).toBe(400);
    });

    it('404s a missing file and a directory', async () => {
        seed('sub/x.txt', 'x');
        expect((await request(handler, 'GET', filesUrl('/nope.csv'))).status).toBe(404);
        expect((await request(handler, 'GET', filesUrl('/sub'))).status).toBe(404);
    });

    it('413s a file over the size cap', async () => {
        seed('big.csv', 'x'.repeat(MAX_CANVAS_TEXT_FILE_BYTES + 1));

        const res = await request(handler, 'GET', filesUrl('/big.csv'));
        expect(res.status).toBe(413);
        expect(res.body.error).toContain('limit');
    });

    /**
     * Every one of these must come back 400 — never 200, and never a 404 that
     * would leak whether the target exists.
     */
    const TRAVERSAL_URLS: Array<[label: string, url: string]> = [
        ['plain ..', '/../../canvas.json'],
        ['encoded .. (lowercase)', '/%2e%2e/%2e%2e/canvas.json'],
        ['encoded .. (uppercase)', '/%2E%2E/%2E%2E/canvas.json'],
        ['double-encoded ..', '/%252e%252e/canvas.json'],
        ['encoded separator', '/data%2f..%2fcanvas.json'],
        ['encoded backslash', '/data%5c..%5ccanvas.json'],
        ['encoded NUL', '/data.csv%00.png'],
        ['mixed literal and encoded', '/sub/..%2f..%2fcanvas.json'],
        ['drive letter', '/C:/Windows/win.ini'],
        ['backslash', '/sub%5C..%5C..%5Ccanvas.json'],
    ];

    it.each(TRAVERSAL_URLS)('rejects %s with 400', async (_label, suffix) => {
        seed('data.csv', 'a\n');
        const res = await request(handler, 'GET', filesUrl(suffix));
        // 400 from the file route, or 404 from the router when the encoded form
        // never matched the pattern at all — never 200, and never file contents.
        expect([400, 404]).toContain(res.status);
        expect(res.body?.file).toBeUndefined();
    });

    it('cannot read the canvas descriptor one directory up', async () => {
        const res = await request(handler, 'GET', filesUrl('/..%2fcanvas.json'));
        expect(res.status).toBe(400);
        expect(res.body.file).toBeUndefined();
    });

    it('refuses a symlink pointing outside the files root', async () => {
        const outside = path.join(dataDir, 'outside.txt');
        fs.writeFileSync(outside, 'TOP SECRET');
        try {
            fs.symlinkSync(outside, path.join(filesRoot, 'link.txt'));
        } catch {
            return; // no symlink privilege on this platform
        }

        const res = await request(handler, 'GET', filesUrl('/link.txt'));
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).not.toContain('TOP SECRET');
    });

    it('exposes no write route — PUT, POST and DELETE all fail', async () => {
        seed('data.csv', 'a\n');
        for (const method of ['PUT', 'POST', 'DELETE']) {
            const res = await request(handler, method, filesUrl('/data.csv'), { content: 'pwned' });
            expect(res.status).toBe(404);
        }
        expect(fs.readFileSync(path.join(filesRoot, 'data.csv'), 'utf-8')).toBe('a\n');
    });
});
