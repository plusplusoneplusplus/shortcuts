import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CanvasStore } from '../../../src/server/canvas/canvas-store';
import { runKustoCanvas, type RunKustoCanvasOptions } from '../../../src/server/kusto/kusto-service';
import {
    createEmptyKustoState,
    parseKustoState,
    serializeKustoState,
    type KustoCanvasState,
} from '../../../src/server/canvas/kusto-state';

const WS = 'kusto-svc-ws';
const NOW = '2026-07-18T00:00:00.000Z';

function mockExecutor(
    rows: KustoCanvasState['rows'],
    columns = [{ name: 'n', type: 'long' }],
): RunKustoCanvasOptions['executeQuery'] {
    return async () => ({ columns, rows, rowCount: rows.length, truncated: false });
}

function seedKustoCanvas(store: CanvasStore, state: Partial<KustoCanvasState>): string {
    const full = { ...createEmptyKustoState(), ...state };
    const rec = store.createCanvas({
        workspaceId: WS,
        title: 'Kusto Query',
        type: 'kusto',
        content: serializeKustoState(full),
    });
    return rec.id;
}

describe('runKustoCanvas', () => {
    let dataDir: string;
    let store: CanvasStore;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-kusto-svc-'));
        store = new CanvasStore(dataDir);
    });
    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('executes and persists a successful run with rows and lastRun', async () => {
        const id = seedKustoCanvas(store, {
            query: 'T | take 2',
            clusterUrl: 'https://c.kusto.windows.net',
            database: 'DB',
        });
        const outcome = await runKustoCanvas(store, WS, id, {
            now: () => NOW,
            executeQuery: mockExecutor([[1], [2]]),
        });
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(outcome.state.rows).toEqual([[1], [2]]);
        expect(outcome.state.columns).toEqual([{ name: 'n', type: 'long' }]);
        expect(outcome.state.lastRun).toEqual({ timestamp: NOW, status: 'success', rowCount: 2 });
        expect(outcome.state.truncated).toBe(false);

        // Survives reload from disk.
        const reloaded = parseKustoState(store.getCanvas(WS, id)!.content);
        expect(reloaded.rows).toEqual([[1], [2]]);
        expect(reloaded.lastRun?.status).toBe('success');
    });

    it('applies overrides without mutating them into an AI turn', async () => {
        const id = seedKustoCanvas(store, {
            query: 'old',
            clusterUrl: 'https://old.kusto.windows.net',
            database: 'OLD',
        });
        const outcome = await runKustoCanvas(store, WS, id, {
            overrides: { query: 'new | take 1', clusterUrl: 'https://new.kusto.windows.net', database: 'NEW' },
            now: () => NOW,
            executeQuery: mockExecutor([[7]]),
        });
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(outcome.state.query).toBe('new | take 1');
        expect(outcome.state.clusterUrl).toBe('https://new.kusto.windows.net');
        expect(outcome.state.database).toBe('NEW');
        expect(outcome.state.rows).toEqual([[7]]);
    });

    it.each(['workspace-a', 'workspace-b'])('passes the persisted owner snapshot to execution in %s', async workspaceId => {
        const inputs = {
            query: 'Stored query', clusterUrl: 'https://c.kusto.windows.net', database: 'DB',
        };
        const record = store.createCanvas({
            workspaceId, processId: `chat-${workspaceId}`, title: 'Query', type: 'kusto',
            content: serializeKustoState(createEmptyKustoState(inputs)),
        });
        const executeQuery = vi.fn(async () => {
            expect(store.getCanvas(workspaceId, record.id)).toEqual(record);
            return mockExecutor([[5]])(inputs, record);
        });
        const outcome = await runKustoCanvas(store, workspaceId, record.id, {
            executeQuery, overrides: { query: 'Edited query' },
        });
        expect(executeQuery).toHaveBeenCalledExactlyOnceWith({ ...inputs, query: 'Edited query' }, record);
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(outcome.canvas).toMatchObject({
            id: record.id, workspaceId, processId: record.processId, revision: record.revision + 1,
        });
        expect(store.getCanvas(workspaceId === 'workspace-a' ? 'workspace-b' : 'workspace-a', record.id)).toBeNull();
    });

    it('does not infer an owning conversation for an unlinked canvas', async () => {
        const id = seedKustoCanvas(store, {
            query: 'T', clusterUrl: 'https://c.kusto.windows.net', database: 'DB',
        });
        const record = store.getCanvas(WS, id)!;
        const executeQuery = vi.fn<RunKustoCanvasOptions['executeQuery']>(async (_params, canvas) => {
            expect(canvas.processId).toBeUndefined();
            throw new Error('Script owner chat is unavailable');
        });
        const outcome = await runKustoCanvas(store, WS, id, { executeQuery });
        expect(executeQuery).toHaveBeenCalledExactlyOnceWith({
            query: 'T', clusterUrl: 'https://c.kusto.windows.net', database: 'DB',
        }, record);
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(outcome.state.lastRun).toMatchObject({ status: 'error', error: 'Script owner chat is unavailable' });
        expect(outcome.state.rows).toEqual([]);
    });

    it('persists the executor truncation flag and total count without reinterpreting them', async () => {
        const id = seedKustoCanvas(store, {
            query: 'T',
            clusterUrl: 'https://c.kusto.windows.net',
            database: 'DB',
        });
        const outcome = await runKustoCanvas(store, WS, id, {
            now: () => NOW,
            executeQuery: async () => ({
                columns: [{ name: 'n', type: 'long' }], rows: [[1], [2]], rowCount: 20_000, truncated: true,
            }),
        });
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(outcome.state.truncated).toBe(true);
        expect(outcome.state.rows).toEqual([[1], [2]]);
        expect(outcome.state.lastRun?.rowCount).toBe(20_000);
    });

    it('captures a query/auth error as the Kusto canvas error state', async () => {
        const id = seedKustoCanvas(store, {
            query: 'bad',
            clusterUrl: 'https://c.kusto.windows.net',
            database: 'DB',
        });
        const executeQuery = vi.fn(async () => {
            throw new Error('Semantic error: bad query');
        });
        const outcome = await runKustoCanvas(store, WS, id, { now: () => NOW, executeQuery });
        expect(executeQuery).toHaveBeenCalledTimes(1);
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(outcome.state.lastRun).toEqual({ timestamp: NOW, status: 'error', error: 'Semantic error: bad query' });
        // Previous rows are preserved as-is (empty here); no rows written on error.
        expect(outcome.state.rows).toEqual([]);
    });

    it('errors without invoking execution when inputs are missing', async () => {
        const id = seedKustoCanvas(store, { query: '', clusterUrl: '', database: '' });
        const executeQuery = vi.fn(mockExecutor([]));
        const outcome = await runKustoCanvas(store, WS, id, { now: () => NOW, executeQuery });
        expect(executeQuery).not.toHaveBeenCalled();
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(outcome.state.lastRun?.status).toBe('error');
        expect(outcome.state.lastRun?.error).toMatch(/required/i);
    });

    it('returns not-found for a missing canvas', async () => {
        const executeQuery = vi.fn(mockExecutor([]));
        const outcome = await runKustoCanvas(store, WS, 'canvas-does-not-exist', { now: () => NOW, executeQuery });
        expect(outcome).toEqual({ ok: false, reason: 'not-found' });
        expect(executeQuery).not.toHaveBeenCalled();
    });

    it('returns wrong-type for a non-Kusto canvas', async () => {
        const rec = store.createCanvas({ workspaceId: WS, title: 'md', content: '# hi', type: 'markdown' });
        const executeQuery = vi.fn(mockExecutor([]));
        const outcome = await runKustoCanvas(store, WS, rec.id, { now: () => NOW, executeQuery });
        expect(outcome).toEqual({ ok: false, reason: 'wrong-type' });
        expect(executeQuery).not.toHaveBeenCalled();
    });

    it('preserves the chart config across a run', async () => {
        const id = seedKustoCanvas(store, {
            query: 'T | take 1',
            clusterUrl: 'https://c.kusto.windows.net',
            database: 'DB',
            chartConfig: { type: 'bar', x: 'n', y: ['n'] },
        });
        const outcome = await runKustoCanvas(store, WS, id, { now: () => NOW, executeQuery: mockExecutor([[1]]) });
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(outcome.state.chartConfig).toEqual({ type: 'bar', x: 'n', y: ['n'] });
    });

    it.each(['success', 'error'] as const)('rejects a late %s without overwriting newer edits', async result => {
        const id = seedKustoCanvas(store, {
            query: 'T', clusterUrl: 'https://c.kusto.windows.net', database: 'DB',
        });
        const started = Promise.withResolvers<void>();
        const finish = Promise.withResolvers<void>();
        const executeQuery = vi.fn(async () => {
            started.resolve();
            await finish.promise;
            if (result === 'error') throw new Error('Late query failure');
            return { columns: [], rows: [], rowCount: 0, truncated: false };
        });
        const pending = runKustoCanvas(store, WS, id, { executeQuery });
        await started.promise;
        const previous = store.getCanvas(WS, id)!;
        const editedState = {
            ...parseKustoState(previous.content), query: 'New query',
            chartConfig: { type: 'bar' as const, x: 'n', y: ['n'] },
        };
        const edit = store.updateCanvas(WS, id, {
            content: serializeKustoState(editedState), editor: 'user', expectedRevision: previous.revision,
        });
        expect(edit.ok).toBe(true);
        finish.resolve();
        expect(await pending).toMatchObject({
            ok: false, reason: 'revision-conflict', currentRevision: previous.revision + 1,
            error: expect.stringContaining('Reload'),
        });
        expect(store.getCanvas(WS, id)).toEqual(edit.ok ? edit.canvas : undefined);
        expect(executeQuery).toHaveBeenCalledTimes(1);
    });

    it('lets only one concurrent run commit the same revision without retries', async () => {
        const id = seedKustoCanvas(store, {
            query: 'T', clusterUrl: 'https://c.kusto.windows.net', database: 'DB',
        });
        const before = store.getCanvas(WS, id)!;
        const firstStarted = Promise.withResolvers<void>();
        const firstFinish = Promise.withResolvers<void>();
        const executeQuery = vi.fn(async () => {
            firstStarted.resolve();
            await firstFinish.promise;
            return { columns: [], rows: [], rowCount: 0, truncated: false };
        });
        const first = runKustoCanvas(store, WS, id, { executeQuery });
        await firstStarted.promise;
        const second = await runKustoCanvas(store, WS, id, {
            overrides: { query: 'New query' }, executeQuery: mockExecutor([[2]]),
        });
        expect(second.ok).toBe(true);
        firstFinish.resolve();
        expect(await first).toMatchObject({ ok: false, reason: 'revision-conflict' });
        expect(store.getCanvas(WS, id)).toEqual(second.ok ? second.canvas : undefined);
        expect(store.getCanvas(WS, id)?.revision).toBe(before.revision + 1);
        expect(executeQuery).toHaveBeenCalledTimes(1);
    });
});
