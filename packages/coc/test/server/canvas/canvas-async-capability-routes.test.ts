/**
 * Async capability route behaviour: the feature flag gate, per-canvas
 * serialization, and the `host.complete` bound to a run.
 *
 * Kept separate from `canvas-routes.test.ts` because every case here needs the
 * route registered with a different flag/completion wiring, which the shared
 * `beforeEach` in that file deliberately does not do.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../../../src/server/shared/router';
import { registerCanvasRoutes } from '../../../src/server/canvas/canvas-routes';
import { CanvasStore } from '../../../src/server/canvas/canvas-store';
import type { CanvasCapabilityMeta } from '../../../src/server/canvas/canvas-store';
import type { CapabilityCompleteFn } from '../../../src/server/canvas/canvas-capability-runner';
import { MAX_HOST_COMPLETIONS_PER_RUN } from '../../../src/server/canvas/canvas-capability-runner';
import type { Route } from '../../../src/server/types';
import type { ProcessWebSocketServer } from '../../../src/server/streaming/websocket';

const WS = 'async-cap-ws';

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

interface Ctx {
    dataDir: string;
    store: CanvasStore;
    handler: ReturnType<typeof createRouter>;
    completeFactory: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
}

function build(opts: { hostApisEnabled: boolean; complete?: CapabilityCompleteFn }): Ctx {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-async-cap-'));
    const store = new CanvasStore(dataDir);
    const complete = vi.fn(opts.complete ?? (async () => ({ ok: true as const, text: 'stub answer' })));
    const completeFactory = vi.fn(() => complete as unknown as CapabilityCompleteFn);
    const routes: Route[] = [];
    registerCanvasRoutes(
        routes,
        dataDir,
        () => ({ broadcastProcessEvent: vi.fn() } as unknown as ProcessWebSocketServer),
        undefined,
        () => false,
        undefined,
        () => opts.hostApisEnabled,
        completeFactory as unknown as Ctx['completeFactory'],
    );
    return { dataDir, store, handler: createRouter({ routes, spaHtml: '' }), completeFactory, complete };
}

function seed(store: CanvasStore, capabilities: CanvasCapabilityMeta[], capabilitiesJs: string, processId?: string): string {
    const canvas = store.createCanvas({
        workspaceId: WS,
        title: 'Async canvas',
        type: 'extension',
        content: '{"n":0}',
        ...(processId ? { processId } : {}),
    });
    store.saveExtension(WS, canvas.id, {
        manifest: { description: 'async test', capabilities },
        uiHtml: '<div></div>',
        capabilitiesJs,
    }, 'ai');
    return canvas.id;
}

/** Appends to a list after a short await — enough to interleave if unserialized. */
const APPEND_JS = `
capabilities = {
    append: async function (state, params) {
        await new Promise(function (r) { setTimeout(r, 30); });
        var items = (state.items || []).slice();
        items.push(params.item);
        return { items: items };
    },
};
`;

const ASYNC_META: CanvasCapabilityMeta[] = [{ name: 'append', description: 'append', async: true }];

describe('async capability route', () => {
    let ctx: Ctx | undefined;
    afterEach(() => {
        if (ctx) fs.rmSync(ctx.dataDir, { recursive: true, force: true });
        ctx = undefined;
    });

    it('404s an async capability when the canvas host APIs flag is off', async () => {
        ctx = build({ hostApisEnabled: false });
        const id = seed(ctx.store, ASYNC_META, APPEND_JS);
        const res = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases/${id}/capabilities/append`, { params: { item: 'a' } });
        expect(res.status).toBe(404);
        // Not merely refused — nothing ran, so the state is untouched.
        expect(ctx.store.getCanvas(WS, id)!.content).toBe('{"n":0}');
    });

    it('still runs SYNC capabilities with the flag off', async () => {
        ctx = build({ hostApisEnabled: false });
        const id = seed(
            ctx.store,
            [{ name: 'bump', description: 'bump' }],
            'capabilities = { bump: function (s) { return { n: (s.n || 0) + 1 }; } };',
        );
        const res = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases/${id}/capabilities/bump`, { params: {} });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body.canvas.content)).toEqual({ n: 1 });
    });

    it('runs an async capability when the flag is on', async () => {
        ctx = build({ hostApisEnabled: true });
        const id = seed(ctx.store, ASYNC_META, APPEND_JS);
        const res = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases/${id}/capabilities/append`, { params: { item: 'a' } });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body.canvas.content)).toEqual({ items: ['a'] });
    });

    it('serializes two concurrent invocations — both succeed, no 409, both land', async () => {
        ctx = build({ hostApisEnabled: true });
        const id = seed(ctx.store, ASYNC_META, APPEND_JS);
        const url = `/api/workspaces/${WS}/canvases/${id}/capabilities/append`;

        const [first, second] = await Promise.all([
            request(ctx.handler, 'POST', url, { params: { item: 'a' } }),
            request(ctx.handler, 'POST', url, { params: { item: 'b' } }),
        ]);

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        // The second run read the FIRST run's output, so nothing was lost.
        const finalState = JSON.parse(ctx.store.getCanvas(WS, id)!.content);
        expect(finalState.items).toHaveLength(2);
        expect([...finalState.items].sort()).toEqual(['a', 'b']);
    });

    it('serializes five concurrent invocations without losing one', async () => {
        ctx = build({ hostApisEnabled: true });
        const id = seed(ctx.store, ASYNC_META, APPEND_JS);
        const url = `/api/workspaces/${WS}/canvases/${id}/capabilities/append`;

        const responses = await Promise.all(
            ['a', 'b', 'c', 'd', 'e'].map(item => request(ctx!.handler, 'POST', url, { params: { item } })),
        );
        expect(responses.map(r => r.status)).toEqual([200, 200, 200, 200, 200]);
        const finalState = JSON.parse(ctx.store.getCanvas(WS, id)!.content);
        expect([...finalState.items].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    }, 20_000);

    it('gives host.complete the workspace, canvas, capability and owning process', async () => {
        ctx = build({ hostApisEnabled: true });
        const id = seed(
            ctx.store,
            [{ name: 'ask', description: 'ask', async: true }],
            `capabilities = { ask: async function (s, p, host) { return { answer: await host.complete('q') }; } };`,
            'process-42',
        );
        const res = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases/${id}/capabilities/ask`, { params: {} });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body.canvas.content)).toEqual({ answer: 'stub answer' });
        expect(ctx.completeFactory).toHaveBeenCalledWith({
            workspaceId: WS,
            canvasId: id,
            capability: 'ask',
            processId: 'process-42',
        });
    });

    it(`enforces the ${MAX_HOST_COMPLETIONS_PER_RUN}-completion cap across a route invocation`, async () => {
        ctx = build({ hostApisEnabled: true });
        const id = seed(
            ctx.store,
            [{ name: 'spam', description: 'spam', async: true }],
            `capabilities = {
                spam: async function (s, p, host) {
                    var out = [];
                    for (var i = 0; i < 5; i++) {
                        try { out.push(await host.complete('q' + i)); } catch (e) { out.push('ERR:' + e.code); }
                    }
                    return { out: out };
                },
            };`,
        );
        const res = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases/${id}/capabilities/spam`, { params: {} });
        expect(res.status).toBe(200);
        expect(ctx.complete).toHaveBeenCalledTimes(MAX_HOST_COMPLETIONS_PER_RUN);
        const out = JSON.parse(res.body.canvas.content).out as string[];
        expect(out.filter(v => v === 'ERR:quota')).toHaveLength(5 - MAX_HOST_COMPLETIONS_PER_RUN);
    });

    it('422s when the async capability itself fails', async () => {
        ctx = build({ hostApisEnabled: true });
        const id = seed(
            ctx.store,
            [{ name: 'boom', description: 'boom', async: true }],
            `capabilities = { boom: async function () { throw new Error('kaboom'); } };`,
        );
        const res = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases/${id}/capabilities/boom`, { params: {} });
        expect(res.status).toBe(422);
        expect(String(res.body.error)).toContain('kaboom');
    });
});
