/**
 * The PR dashboard test plugin end to end: an extension canvas whose async
 * `refresh` capability reads pull requests through `host.runScript` and a mock
 * `query_pull_request`. Every case runs through BOTH invoke paths — the REST
 * `capabilities/:name` route and `extension_canvas` run mode.
 *
 * The owner runner is a fake that skips chat-context assembly but keeps the
 * real script engine and the allow-list filtering.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { CocToolRuntime, defineTool, runToolScript } from '@plusplusoneplusplus/coc-agent-sdk';
import { createRouter } from '../../../src/server/shared/router';
import { registerCanvasRoutes } from '../../../src/server/canvas/canvas-routes';
import { CanvasStore } from '../../../src/server/canvas/canvas-store';
import { createCanvasRunScriptFactory, type CanvasToolScriptFlags } from '../../../src/server/canvas/canvas-script-bridge';
import type { OwnerScriptRunner } from '../../../src/server/executors/owner-script-runner';
import { createCanvasTools } from '../../../src/server/llm-tools/canvas-tools';
import type { Route } from '../../../src/server/types';
import type { ProcessWebSocketServer } from '../../../src/server/streaming/websocket';
import {
    createMockPrTool,
    emptyListResult,
    failureResult,
    loadPrDashboardFixture,
    type MockPrTool,
} from '../../fixtures/canvas/pr-dashboard/mock-pr-data';

const WS = 'pr-dash-ws';
const OWNER = 'owner-chat';
const ON: CanvasToolScriptFlags = { canvasHostApis: true, toolScripting: true, canvasToolScripts: true };

function post(handler: ReturnType<typeof createRouter>, url: string, body: unknown): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close(() => reject(new Error('Server did not bind')));
                return;
            }
            const payload = JSON.stringify(body);
            const req = http.request({
                hostname: '127.0.0.1', port: address.port, path: url, method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
            }, res => {
                const chunks: Buffer[] = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => server.close(() => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : undefined });
                }));
            });
            req.on('error', e => server.close(() => reject(e)));
            req.write(payload);
            req.end();
        });
    });
}

type Outcome = { kind: 'ok' } | { kind: 'conflict' } | { kind: 'disabled' } | { kind: 'error'; error: string };

interface Harness {
    dataDir: string;
    store: CanvasStore;
    pr: MockPrTool;
    flags: CanvasToolScriptFlags;
    invoke: (canvasId: string, capability: string, params?: unknown) => Promise<Outcome>;
}

/** Records the mock tool + the real engine, filtered by the manifest's tools. */
function fakeOwnerRunner(pr: MockPrTool): OwnerScriptRunner {
    return async request => {
        if (request.processId !== OWNER || request.workspaceId !== WS) throw new Error('unexpected owner');
        const tools = [pr.tool, defineTool('extra_tool', { handler: async () => 'nope' })]
            .filter(tool => request.allowTools.includes(tool.name));
        const runtime = new CocToolRuntime(tools, { workspaceId: request.workspaceId, processId: request.processId });
        try {
            return await runToolScript({
                code: request.code, state: request.state, runtime, requireJsonResult: true,
                allowNestedScripts: false, scriptToolCallId: '', depth: 1, signal: request.signal,
            });
        } finally {
            runtime.dispose();
        }
    };
}

function harness(path_: 'rest' | 'tool', list?: Parameters<typeof createMockPrTool>[0]): Harness {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-pr-dash-'));
    const store = new CanvasStore(dataDir);
    const pr = createMockPrTool(list);
    const flags: CanvasToolScriptFlags = { ...ON };
    const runScriptFactory = createCanvasRunScriptFactory({
        getFeatures: () => flags,
        getOwnerScriptRunner: () => fakeOwnerRunner(pr),
        log: () => {},
    });
    const completeFactory = () => async () => ({ ok: false as const, error: 'no model in tests' });

    if (path_ === 'rest') {
        const routes: Route[] = [];
        registerCanvasRoutes(
            routes, dataDir,
            () => ({ broadcastProcessEvent: vi.fn() } as unknown as ProcessWebSocketServer),
            undefined, () => false, undefined,
            () => flags.canvasHostApis === true,
            completeFactory,
            runScriptFactory,
        );
        const handler = createRouter({ routes, spaHtml: '' });
        return {
            dataDir, store, pr, flags,
            invoke: async (canvasId, capability, params) => {
                const res = await post(handler, `/api/workspaces/${WS}/canvases/${canvasId}/capabilities/${capability}`, { params: params ?? {} });
                if (res.status === 200) return { kind: 'ok' };
                if (res.status === 409) return { kind: 'conflict' };
                if (res.status === 404) return { kind: 'disabled' };
                return { kind: 'error', error: String(res.body?.error ?? res.status) };
            },
        };
    }

    // The AI path, called from a DIFFERENT chat than the canvas owner.
    const { extension } = createCanvasTools({
        dataDir, workspaceId: WS, processId: 'some-other-chat', canvasStore: store,
        getCanvasHostApisEnabled: () => flags.canvasHostApis === true,
        completeFactory,
        runScriptFactory,
    });
    return {
        dataDir, store, pr, flags,
        invoke: async (canvasId, capability, params) => {
            const res = await extension.handler({ canvasId, capability, params } as any) as any;
            if (res.success) return { kind: 'ok' };
            if (/state changed/.test(res.error)) return { kind: 'conflict' };
            if (/disabled/.test(res.error)) return { kind: 'disabled' };
            return { kind: 'error', error: res.error };
        },
    };
}

function createDashboard(store: CanvasStore, initialState?: Record<string, unknown>): string {
    const fixture = loadPrDashboardFixture();
    const canvas = store.createCanvas({
        workspaceId: WS, title: 'PR dashboard', type: 'extension',
        content: JSON.stringify(initialState ?? fixture.state, null, 2),
        processId: OWNER, editor: 'ai',
    });
    store.saveExtension(WS, canvas.id, {
        manifest: fixture.manifest, uiHtml: fixture.uiHtml, capabilitiesJs: fixture.capabilitiesJs,
    }, 'ai');
    return canvas.id;
}

function stateOf(store: CanvasStore, canvasId: string): any {
    return JSON.parse(store.getCanvas(WS, canvasId)!.content);
}

describe.each(['rest', 'tool'] as const)('PR dashboard canvas via %s', (invokePath) => {
    let h: Harness | undefined;
    afterEach(() => {
        if (h) fs.rmSync(h.dataDir, { recursive: true, force: true });
        h = undefined;
    });

    it('fills the table from a list call plus a detail call for the first five', async () => {
        h = harness(invokePath);
        const id = createDashboard(h.store);

        expect(await h.invoke(id, 'refresh')).toEqual({ kind: 'ok' });

        const state = stateOf(h.store, id);
        expect(state.prs).toHaveLength(7);
        expect(state.errors).toEqual([]);
        expect(typeof state.refreshedAt).toBe('string');
        const hasDetail = Object.fromEntries(state.prs.map((p: any) => [p.id, p.hasDetail]));
        expect(hasDetail).toEqual({ 101: true, 102: true, 103: true, 104: false, 105: true, 106: false, 107: false });

        expect(h.pr.calls).toHaveLength(2);
        expect(h.pr.calls[0]).toEqual({ provider: 'github', repository: 'octo/demo', status: 'open', limit: 10 });
        expect(h.pr.calls[1]).toEqual({ provider: 'github', repository: 'octo/demo', ids: [101, 102, 103, 104, 105] });
    });

    it('passes values through state, so quotes and backticks reach the tool unchanged', async () => {
        h = harness(invokePath);
        const id = createDashboard(h.store);
        const repository = 'octo/it\'s-"odd"-`${process.exit()}`';

        expect(await h.invoke(id, 'set_repo', { provider: 'github', repository })).toEqual({ kind: 'ok' });
        expect(await h.invoke(id, 'refresh')).toEqual({ kind: 'ok' });

        expect(h.pr.calls[0].repository).toBe(repository);
        expect(stateOf(h.store, id).repository).toBe(repository);
    });

    it('records a tool failure as an error, keeps prs, and bumps the revision once', async () => {
        h = harness(invokePath, () => failureResult);
        const id = createDashboard(h.store, { ...loadPrDashboardFixture().state, prs: [{ id: 1, title: 'old' }] });
        const before = h.store.getCanvas(WS, id)!.revision;

        expect(await h.invoke(id, 'refresh')).toEqual({ kind: 'ok' });

        const state = stateOf(h.store, id);
        expect(state.errors).toEqual(['auth-required: Sign in to GitHub first']);
        expect(state.prs).toEqual([{ id: 1, title: 'old' }]);
        expect(h.store.getCanvas(WS, id)!.revision).toBe(before + 1);
    });

    it('skips the detail call for an empty list', async () => {
        h = harness(invokePath, () => emptyListResult);
        const id = createDashboard(h.store);

        expect(await h.invoke(id, 'refresh')).toEqual({ kind: 'ok' });

        expect(stateOf(h.store, id).prs).toEqual([]);
        expect(h.pr.calls).toHaveLength(1);
    });

    it('reports a conflict when a user save lands mid-run, then refreshes from the saved state', async () => {
        let canvasId = '';
        let saved = false;
        h = harness(invokePath, args => {
            if (!saved) {
                saved = true;
                const current = h!.store.getCanvas(WS, canvasId)!;
                h!.store.updateCanvas(WS, canvasId, {
                    content: JSON.stringify({ ...JSON.parse(current.content), repository: 'octo/saved' }),
                    expectedRevision: current.revision,
                    editor: 'user',
                });
            }
            return { ...emptyListResult, repository: args.repository };
        });
        canvasId = createDashboard(h.store);

        expect(await h.invoke(canvasId, 'refresh')).toEqual({ kind: 'conflict' });
        expect(stateOf(h.store, canvasId).refreshedAt).toBeNull();

        expect(await h.invoke(canvasId, 'refresh')).toEqual({ kind: 'ok' });
        expect(h.pr.calls[1].repository).toBe('octo/saved');
        expect(stateOf(h.store, canvasId)).toMatchObject({ repository: 'octo/saved', prs: [] });
    });

    it('surfaces host.runScript disabled when the canvas tool scripts flag is off; set_repo still works', async () => {
        h = harness(invokePath);
        h.flags.canvasToolScripts = false;
        const id = createDashboard(h.store);
        const before = h.store.getCanvas(WS, id)!.revision;

        const refresh = await h.invoke(id, 'refresh');
        expect(refresh.kind).toBe('error');
        expect(refresh.kind === 'error' && refresh.error).toContain('canvas tool scripts are off');
        expect(h.store.getCanvas(WS, id)!.revision).toBe(before);
        expect(h.pr.calls).toHaveLength(0);

        h.flags.canvasHostApis = false;
        expect(await h.invoke(id, 'set_repo', { provider: 'ado', repository: 'org/proj/repo' })).toEqual({ kind: 'ok' });
        expect(stateOf(h.store, id)).toMatchObject({ provider: 'ado', repository: 'org/proj/repo' });
    });

    it('fails the run and leaves the canvas unchanged when the returned state is over the size cap', async () => {
        h = harness(invokePath, () => ({ ...emptyListResult, items: [] }));
        const id = createDashboard(h.store);
        const fixture = loadPrDashboardFixture();
        h.store.saveExtension(WS, id, {
            manifest: fixture.manifest, uiHtml: fixture.uiHtml,
            capabilitiesJs: `capabilities = { async refresh(state, params, host) {
                const out = await host.runScript('return "y".repeat(1100000);');
                return { ...state, blob: out.result };
            }, set_repo(state) { return state; } };`,
        }, 'ai');
        const before = h.store.getCanvas(WS, id)!;

        const outcome = await h.invoke(id, 'refresh');
        expect(outcome.kind).toBe('error');
        expect(outcome.kind === 'error' && outcome.error).toContain('canvas state limit');
        expect(h.store.getCanvas(WS, id)!.revision).toBe(before.revision);
        expect(h.store.getCanvas(WS, id)!.content).toBe(before.content);
    });
});
