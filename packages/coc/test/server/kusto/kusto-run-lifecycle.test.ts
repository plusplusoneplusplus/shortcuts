import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CopilotSDKService, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../../src/server/index';
import * as kustoRuntime from '../../../src/server/kusto/kusto-client-runtime';
import type { KustoResponseLike } from '../../../src/server/kusto/kusto-exec';
import { CanvasStore, type CanvasRecord } from '../../../src/server/canvas/canvas-store';
import { createEmptyKustoState, serializeKustoState } from '../../../src/server/canvas/kusto-state';

describe('Kusto Run production lifecycle', () => {
    let root: string;
    let store: SqliteProcessStore;
    let canvases: CanvasStore;
    let service: CopilotSDKService;
    let server: Awaited<ReturnType<typeof createExecutionServer>> | undefined;
    const work: { signal: AbortSignal; finish: (value: KustoResponseLike) => void }[] = [];
    const executeQuery = vi.fn();
    const complete = vi.fn();

    beforeEach(async () => {
        work.length = 0;
        root = await mkdtemp(join(tmpdir(), 'kusto-run-lifecycle-'));
        const configPath = join(root, 'config.yaml');
        await writeFile(configPath, 'kusto:\n  enabled: true\nfeatures:\n  canvasHostApis: false\n  canvasToolScripts: false\n  toolScripting: false\n');
        store = new SqliteProcessStore({ dbPath: join(root, 'processes.db') });
        canvases = new CanvasStore(root);
        service = new CopilotSDKService();
        vi.spyOn(service, 'listModels').mockResolvedValue([]);
        vi.spyOn(service, 'isAvailable').mockResolvedValue({ available: false });
        vi.spyOn(service, 'sendMessage').mockImplementation(complete);
        executeQuery.mockImplementation((_database, _query, signal: AbortSignal) => new Promise<KustoResponseLike>(finish => {
            // Deliberately ignore cancellation: late SDK completion must never write or retry.
            work.push({ signal, finish });
        }));
        vi.spyOn(kustoRuntime, 'createKustoClientRuntime').mockImplementation(getConfig => ({
            getEnabled: () => getConfig().enabled === true,
            clientFactory: () => ({ executeQuery }),
            commandClientFactory: () => { throw new Error('Commands must not run'); },
            syncConfig: getConfig, dispose: vi.fn(),
        }));
        server = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: root, configPath,
            aiService: service, store, queue: { autoStart: false } });
        for (const workspaceId of ['ws-1', 'ws-2']) {
            const repo = join(root, workspaceId);
            await mkdir(repo);
            await store.registerWorkspace({ id: workspaceId, name: workspaceId, rootPath: repo });
            await store.addProcess({ id: `${workspaceId}-chat`, type: 'chat', status: 'completed',
                startTime: new Date(), promptPreview: 'Kusto', metadata: { workspaceId } });
        }
    });

    afterEach(async () => {
        await server?.close();
        service?.dispose();
        store?.close();
        vi.restoreAllMocks();
        vi.clearAllMocks();
        await rm(root, { recursive: true, force: true });
    });

    function seed(workspaceId: string): CanvasRecord {
        return canvases.createCanvas({ workspaceId, processId: `${workspaceId}-chat`, title: 'Query', type: 'kusto',
            content: serializeKustoState(createEmptyKustoState({ query: 'print 1',
                clusterUrl: 'https://c.kusto.windows.net', database: 'DB' })) });
    }

    function run(canvas: CanvasRecord, signal?: AbortSignal) {
        return fetch(`${server!.url}/api/workspaces/${canvas.workspaceId}/canvases/${canvas.id}/run`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal,
        });
    }

    it.each(['archive', 'remove', 'clear'] as const)('cancels on owner %s while another workspace finishes normally', async action => {
        const first = seed('ws-1');
        const second = seed('ws-2');
        const ownerBefore = await store.getProcess(second.processId!, second.workspaceId);
        const events = vi.spyOn(store, 'emitProcessEvent');
        const pending = run(first);
        await vi.waitFor(() => expect(work).toHaveLength(1));
        const sibling = run(second);
        await vi.waitFor(() => expect(work).toHaveLength(2));
        if (action === 'archive') {
            store.archiveProcess(first.processId!);
            // Restoring the owner must not revive an already cancelled run.
            store.unarchiveProcess(first.processId!);
        }
        else if (action === 'remove') await store.removeProcess(first.processId!);
        else await store.clearProcesses({ workspaceId: first.workspaceId });
        await vi.waitFor(() => expect(work[0].signal.aborted).toBe(true));
        expect(work[1].signal.aborted).toBe(false);
        expect((await pending).status).toBe(500);
        work[0].finish({ primaryResults: [] });
        work[1].finish({ primaryResults: [] });
        expect((await sibling).status).toBe(200);
        expect(canvases.getCanvas(first.workspaceId, first.id)).toEqual(first);
        expect(canvases.getCanvas(second.workspaceId, second.id)?.revision).toBe(second.revision + 1);
        expect(await store.getProcess(second.processId!, second.workspaceId)).toEqual(ownerBefore);
        expect(executeQuery).toHaveBeenCalledTimes(2);
        expect(events.mock.calls.filter(([, event]) => event.type === 'canvas-updated')).toEqual([
            [second.processId, { type: 'canvas-updated', canvasUpdate: expect.objectContaining({ canvasId: second.id, revision: second.revision + 1 }) }],
        ]);
        expect(complete).not.toHaveBeenCalled();
    });

    it('cancels on live Kusto disablement and accepts a new run after re-enabling', async () => {
        const canvas = seed('ws-1');
        const pending = run(canvas);
        await vi.waitFor(() => expect(work).toHaveLength(1));
        const update = async (enabled: boolean) => {
            const response = await fetch(`${server!.url}/api/admin/config`, { method: 'PUT',
                headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ 'kusto.enabled': enabled }) });
            expect(response.status).toBe(200);
        };
        await update(false);
        expect(work[0].signal.aborted).toBe(true);
        expect((await pending).status).toBe(500);
        work[0].finish({ primaryResults: [] });
        expect(canvases.getCanvas(canvas.workspaceId, canvas.id)).toEqual(canvas);
        expect((await run(canvas)).status).toBe(404);
        await update(true);
        const next = run(canvas);
        await vi.waitFor(() => expect(work).toHaveLength(2));
        expect(work[1].signal.aborted).toBe(false);
        work[1].finish({ primaryResults: [] });
        expect((await next).status).toBe(200);
        expect(executeQuery).toHaveBeenCalledTimes(2);
    });

    it('aborts disconnected HTTP work without cancelling another owner or retrying late results', async () => {
        const canvas = seed('ws-1');
        const second = seed('ws-2');
        const controller = new AbortController();
        const pending = run(canvas, controller.signal).then(() => 'completed', () => 'disconnected');
        await vi.waitFor(() => expect(work).toHaveLength(1));
        const sibling = run(second);
        await vi.waitFor(() => expect(work).toHaveLength(2));
        controller.abort();
        expect(await pending).toBe('disconnected');
        await vi.waitFor(() => expect(work[0].signal.aborted).toBe(true));
        expect(work[1].signal.aborted).toBe(false);
        work[0].finish({ primaryResults: [] });
        work[1].finish({ primaryResults: [] });
        expect((await sibling).status).toBe(200);
        expect(canvases.getCanvas(canvas.workspaceId, canvas.id)).toEqual(canvas);
        expect(canvases.getCanvas(second.workspaceId, second.id)?.revision).toBe(second.revision + 1);
        expect(executeQuery).toHaveBeenCalledTimes(2);
    });

    it('aborts pending work at shutdown and ignores late completion', async () => {
        const canvas = seed('ws-1');
        const pending = run(canvas).then(response => response.status, () => 'disconnected');
        await vi.waitFor(() => expect(work).toHaveLength(1));
        const closing = server!.close();
        expect(work[0].signal.aborted).toBe(true);
        await closing;
        server = undefined;
        expect([500, 'disconnected']).toContain(await pending);
        work[0].finish({ primaryResults: [] });
        await new Promise(resolve => setImmediate(resolve));
        expect(canvases.getCanvas(canvas.workspaceId, canvas.id)).toEqual(canvas);
        expect(executeQuery).toHaveBeenCalledOnce();
        expect(complete).not.toHaveBeenCalled();
    });
});
