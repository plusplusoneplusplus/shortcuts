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
import type { KustoClientFactory, KustoClientLike } from '../../../src/server/kusto/kusto-exec';
import { createEmptyKustoState, parseKustoState, serializeKustoState } from '../../../src/server/canvas/kusto-state';
import { createKustoClientRuntime } from '../../../src/server/kusto/kusto-client-runtime';
import type { KustoAuthConfig } from '../../../src/server/kusto/kusto-credential';
import { AuthError } from '@plusplusoneplusplus/coc-native';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { runScriptWithOwnerTools, type OwnerScriptRunner } from '../../../src/server/executors/owner-script-runner';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import { CONFIG_FILE_NAME } from '../../../src/config';

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
        executeQuery: async () => ({
            primaryResults: [
                { columns: [{ name: 'n', type: 'long' }], rows: () => [{ getValueAt: () => 1 }] },
            ],
        }),
    }) as unknown as KustoClientLike;

async function build(kustoEnabled: boolean, factory: KustoClientFactory = okFactory) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-run-route-'));
    const store = new CanvasStore(dataDir);
    const processStore = new SqliteProcessStore({ dbPath: ':memory:' });
    for (const workspaceId of [WS, 'other-run-ws']) {
        await processStore.registerWorkspace({ id: workspaceId, name: workspaceId, rootPath: dataDir });
        await processStore.addProcess({ id: `${workspaceId}-chat`, type: 'chat', status: 'completed',
            startTime: new Date(), promptPreview: 'Kusto', metadata: { workspaceId } });
        writeRepoPreferences(dataDir, workspaceId, { disabledLlmTools: [] });
    }
    // Existing installations need no unrelated canvas/script opt-in.
    fs.writeFileSync(path.join(dataDir, CONFIG_FILE_NAME),
        'features:\n  canvasHostApis: false\n  canvasToolScripts: false\n  toolScripting: false\n');
    const enabled = { value: kustoEnabled };
    const runner = vi.fn<OwnerScriptRunner>(request => runScriptWithOwnerTools({
        ...request, ownerTools: { dataDir, workspaceId: request.workspaceId, processId: request.processId,
            store: processStore, includeMemoryV2: false, kustoRuntime: { getEnabled: () => enabled.value, clientFactory: factory } },
    }));
    const broadcastProcessEvent = vi.fn();
    const emitProcessEvent = vi.spyOn(processStore, 'emitProcessEvent');
    const routes: Route[] = [];
    registerCanvasRoutes(routes, dataDir,
        () => ({ broadcastProcessEvent } as unknown as ProcessWebSocketServer),
        processStore, () => enabled.value, () => runner, () => false);
    return { dataDir, store, processStore, runner, enabled, emitProcessEvent,
        handler: createRouter({ routes, spaHtml: '' }), broadcastProcessEvent };
}

function seed(store: CanvasStore): string {
    const state = { ...createEmptyKustoState(), query: 'T | take 1', clusterUrl: 'https://c.kusto.windows.net', database: 'DB' };
    return store.createCanvas({ workspaceId: WS, title: 'Kusto Query', type: 'kusto', processId: `${WS}-chat`, content: serializeKustoState(state) }).id;
}

describe('POST /canvases/:id/run', () => {
    let ctx: Awaited<ReturnType<typeof build>>;
    afterEach(() => {
        if (ctx) { ctx.processStore.close(); fs.rmSync(ctx.dataDir, { recursive: true, force: true }); }
    });

    it('404s when the Kusto feature is disabled (AC-08)', async () => {
        ctx = await build(false);
        const id = seed(ctx.store);
        const res = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases/${id}/run`, {});
        expect(res.status).toBe(404);
        expect(ctx.runner).not.toHaveBeenCalled();
    });

    it('runs the stored query and persists results when enabled', async () => {
        ctx = await build(true);
        const id = seed(ctx.store);
        const before = ctx.store.getCanvas(WS, id)!;
        const ownerBefore = await ctx.processStore.getProcess(`${WS}-chat`, WS);
        const res = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases/${id}/run`, {});
        expect(res.status).toBe(200);
        expect(res.body.canvas.revision).toBe(before.revision + 1);
        expect(ctx.runner).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            workspaceId: WS, processId: `${WS}-chat`, allowTools: ['execute_kusto_query'], includeMcpTools: false,
            code: 'return await tools.execute_kusto_query(state);',
        }));
        expect(await ctx.processStore.getProcess(`${WS}-chat`, WS)).toEqual(ownerBefore);
        expect(ctx.emitProcessEvent.mock.calls.filter(([, event]) => event.type === 'canvas-updated')).toHaveLength(1);
        const state = parseKustoState(res.body.canvas.content);
        expect(state.rows).toEqual([[1]]);
        expect(state.lastRun?.status).toBe('success');
        expect(ctx.broadcastProcessEvent).toHaveBeenCalledTimes(1);
    });

    it.each(['success', 'error'] as const)('returns 409 without notifying when a late %s conflicts with an edit', async result => {
        let id: string;
        let edited: ReturnType<CanvasStore['getCanvas']>;
        const executeQuery = vi.fn(async () => {
            const record = ctx.store.getCanvas(WS, id)!;
            const saved = ctx.store.updateCanvas(WS, id, {
                content: serializeKustoState({ ...parseKustoState(record.content), query: 'Newer edit' }),
                editor: 'user', expectedRevision: record.revision,
            });
            expect(saved.ok).toBe(true);
            edited = ctx.store.getCanvas(WS, id);
            if (result === 'error') throw new Error('Late failure');
            return { primaryResults: [] };
        });
        ctx = await build(true, () => ({ executeQuery }));
        id = seed(ctx.store);
        const response = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases/${id}/run`, {});
        expect(response.status).toBe(409);
        expect(response.body).toEqual({
            error: 'revision-conflict', currentRevision: edited!.revision, canvas: edited!,
        });
        expect(ctx.store.getCanvas(WS, id)).toEqual(edited!);
        expect(ctx.broadcastProcessEvent).not.toHaveBeenCalled();
        expect(executeQuery).toHaveBeenCalledTimes(1);
    });

    it('applies query/cluster/database overrides from the body', async () => {
        ctx = await build(true);
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
            executeQuery: async () => {
                throw new Error('Semantic error: boom');
            },
        });
        ctx = await build(true, failing);
        const id = seed(ctx.store);
        const res = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases/${id}/run`, {});
        expect(res.status).toBe(200);
        const state = parseKustoState(res.body.canvas.content);
        expect(state.lastRun?.status).toBe('error');
        expect(state.lastRun?.error).toContain('boom');
    });

    it('uses host Rust authentication for both workspaces and persists a sanitized mismatch banner without fallback', async () => {
        const config: KustoAuthConfig = {
            enabled: true,
            azureCli: {
                account: 'fixture-account',
                tenant: '11111111-1111-4111-8111-111111111111',
                subscription: '22222222-2222-4222-8222-222222222222',
            },
        };
        const getToken = vi.fn(async () => ({
            source: 'azure-cli' as const, target: 'https://kusto.kusto.windows.net', tokenType: 'Bearer',
            accessToken: 'opaque-fixture', expiresAt: Date.now() + 120_000,
            account: { id: config.azureCli!.account!, tenant: config.azureCli!.tenant! },
        }));
        const createProvider = vi.fn(() => ({ getToken, dispose: vi.fn(), cancelOutstanding: vi.fn() }));
        const runtime = createKustoClientRuntime(() => config, {
            diagnostic: vi.fn(), createProvider,
            buildClient: async (_cluster, credential) => ({
                executeQuery: async () => {
                    await credential!.getToken(['https://kusto.kusto.windows.net/.default']);
                    return { primaryResults: [{ columns: [{ name: 'n', type: 'long' }], rows: () => [{ getValueAt: () => 1 }] }] };
                },
            }),
        });
        try {
            ctx = await build(true, runtime.clientFactory);
            const id = seed(ctx.store);
            const other = ctx.store.createCanvas({
                workspaceId: 'other-run-ws', processId: 'other-run-ws-chat', title: 'Other fixture', type: 'kusto',
                content: ctx.store.getCanvas(WS, id)!.content,
            });
            for (const [workspace, canvasId] of [[WS, id], ['other-run-ws', other.id]]) {
                const result = await request(ctx.handler, 'POST', `/api/workspaces/${workspace}/canvases/${canvasId}/run`, {});
                expect(parseKustoState(result.body.canvas.content).lastRun?.status).toBe('success');
            }
            expect(createProvider).toHaveBeenCalledTimes(1);
            getToken.mockRejectedValueOnce(new AuthError('AccountMismatch'));
            const result = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases/${id}/run`, {});
            expect(result.status).toBe(200);
            expect(parseKustoState(result.body.canvas.content).lastRun).toMatchObject({
                status: 'error', error: expect.stringContaining('AccountMismatch'),
            });
            expect(JSON.stringify(result.body)).not.toContain('opaque-fixture');
            expect(JSON.stringify(result.body)).not.toContain('fixture-account');
            expect(createProvider).toHaveBeenCalledTimes(1);
            expect(getToken).toHaveBeenCalledTimes(3);
            expect(parseKustoState(ctx.store.getCanvas('other-run-ws', other.id)!.content).lastRun?.status).toBe('success');
        } finally {
            runtime.dispose();
        }
    });

    it.each(['disabled', 'approval-required'] as const)('honors owner tool %s policy with no SDK fallback', async policy => {
        const factory = vi.fn(okFactory);
        ctx = await build(true, factory);
        writeRepoPreferences(ctx.dataDir, WS, {
            disabledLlmTools: policy === 'disabled' ? ['execute_kusto_query'] : [],
            approvalRequiredLlmTools: policy === 'approval-required' ? ['execute_kusto_query'] : [],
        });
        const id = seed(ctx.store);
        const res = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases/${id}/run`, {});
        expect(res.status).toBe(200);
        expect(parseKustoState(res.body.canvas.content).lastRun?.status).toBe('error');
        expect(factory).not.toHaveBeenCalled();
        expect(ctx.runner).toHaveBeenCalledTimes(1);
        expect((await ctx.processStore.getProcess(`${WS}-chat`, WS))?.pendingAskUser).toBeUndefined();
    });

    it.each(['unlinked', 'missing', 'wrong-workspace', 'archived', 'wrong-type'] as const)(
        'rejects a %s owner without running a script or writing a result', async mode => {
            ctx = await build(true);
            if (mode === 'missing') await ctx.processStore.removeProcess(`${WS}-chat`);
            if (mode === 'archived') ctx.processStore.archiveProcess(`${WS}-chat`);
            if (mode === 'wrong-type') await ctx.processStore.updateProcess(`${WS}-chat`, { type: 'workflow' });
            const canvas = ctx.store.createCanvas({ workspaceId: WS, title: 'Invalid owner', type: 'kusto',
                processId: mode === 'unlinked' ? undefined : mode === 'wrong-workspace' ? 'other-run-ws-chat' : `${WS}-chat`,
                content: serializeKustoState({ ...createEmptyKustoState(), query: 'print 1',
                    clusterUrl: 'https://c.kusto.windows.net', database: 'DB' }) });
            const res = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases/${canvas.id}/run`, {
                processId: 'other-run-ws-chat', workspaceId: 'other-run-ws',
            });
            expect(res.status).toBe(500);
            expect(res.body.error).toContain('owner chat is unavailable');
            expect(ctx.runner).not.toHaveBeenCalled();
            expect(ctx.store.getCanvas(WS, canvas.id)).toEqual(canvas);
            expect(ctx.broadcastProcessEvent).not.toHaveBeenCalled();
        },
    );

    it.each(['archive', 'remove', 'disable'] as const)('rejects late results after owner %s', async operation => {
        const executeQuery = vi.fn(async () => {
            if (operation === 'archive') ctx.processStore.archiveProcess(`${WS}-chat`);
            if (operation === 'remove') await ctx.processStore.removeProcess(`${WS}-chat`);
            if (operation === 'disable') ctx.enabled.value = false;
            return { primaryResults: [] };
        });
        ctx = await build(true, () => ({ executeQuery }));
        const id = seed(ctx.store);
        const before = ctx.store.getCanvas(WS, id);
        const res = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases/${id}/run`, {});
        expect(res.status).toBe(500);
        expect(ctx.store.getCanvas(WS, id)).toEqual(before);
        expect(executeQuery).toHaveBeenCalledTimes(1);
        expect(ctx.broadcastProcessEvent).not.toHaveBeenCalled();
    });

    it('never runs management commands or caller-supplied scripts through Run', async () => {
        const factory = vi.fn(okFactory);
        ctx = await build(true, factory);
        const id = seed(ctx.store);
        const res = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases/${id}/run`, {
            query: '.show tables', code: 'return await tools.execute_kusto_command(state)',
            tools: ['execute_kusto_command'], state: { approval: true },
        });
        expect(res.status).toBe(200);
        expect(parseKustoState(res.body.canvas.content).lastRun?.status).toBe('error');
        expect(factory).not.toHaveBeenCalled();
        expect(ctx.runner).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            code: 'return await tools.execute_kusto_query(state);', allowTools: ['execute_kusto_query'],
        }));
    });

    it('400s for a non-Kusto canvas', async () => {
        ctx = await build(true);
        const rec = ctx.store.createCanvas({ workspaceId: WS, title: 'md', content: '# hi', type: 'markdown' });
        const res = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases/${rec.id}/run`, {});
        expect(res.status).toBe(400);
    });

    it('404s for a missing Kusto canvas', async () => {
        ctx = await build(true);
        const res = await request(ctx.handler, 'POST', `/api/workspaces/${WS}/canvases/canvas-missing/run`, {});
        expect(res.status).toBe(404);
    });
});
