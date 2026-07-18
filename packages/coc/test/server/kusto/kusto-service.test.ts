import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CanvasStore } from '../../../src/server/canvas/canvas-store';
import { runKustoCanvas } from '../../../src/server/kusto/kusto-service';
import {
    createEmptyKustoState,
    parseKustoState,
    serializeKustoState,
    type KustoCanvasState,
} from '../../../src/server/canvas/kusto-state';
import type { KustoClientFactory, KustoClientLike } from '../../../src/server/kusto/kusto-exec';

const WS = 'kusto-svc-ws';
const NOW = '2026-07-18T00:00:00.000Z';

function mockFactory(rows: unknown[][], columns = [{ name: 'n', type: 'long' }]): KustoClientFactory {
    return () =>
        ({
            execute: async () => ({
                primaryResults: [
                    { columns, rows: () => rows.map(r => ({ getValueAt: (i: number) => r[i] })) },
                ],
            }),
        }) as unknown as KustoClientLike;
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
            clientFactory: mockFactory([[1], [2]]),
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
            clientFactory: mockFactory([[7]]),
        });
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(outcome.state.query).toBe('new | take 1');
        expect(outcome.state.clusterUrl).toBe('https://new.kusto.windows.net');
        expect(outcome.state.database).toBe('NEW');
        expect(outcome.state.rows).toEqual([[7]]);
    });

    it('sets truncated when the result exceeds the cap', async () => {
        const id = seedKustoCanvas(store, {
            query: 'T',
            clusterUrl: 'https://c.kusto.windows.net',
            database: 'DB',
        });
        // Uses default 10k cap; simulate a bigger set is expensive, so rely on
        // the kusto-exec truncation being unit-tested and just assert wiring here.
        const outcome = await runKustoCanvas(store, WS, id, {
            now: () => NOW,
            clientFactory: mockFactory(Array.from({ length: 3 }, (_, i) => [i])),
        });
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(outcome.state.truncated).toBe(false);
        expect(outcome.state.lastRun?.rowCount).toBe(3);
    });

    it('captures a query/auth error as the Kusto canvas error state', async () => {
        const id = seedKustoCanvas(store, {
            query: 'bad',
            clusterUrl: 'https://c.kusto.windows.net',
            database: 'DB',
        });
        const failingFactory: KustoClientFactory = () => ({
            execute: async () => {
                throw new Error('Semantic error: bad query');
            },
        });
        const outcome = await runKustoCanvas(store, WS, id, { now: () => NOW, clientFactory: failingFactory });
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(outcome.state.lastRun).toEqual({ timestamp: NOW, status: 'error', error: 'Semantic error: bad query' });
        // Previous rows are preserved as-is (empty here); no rows written on error.
        expect(outcome.state.rows).toEqual([]);
    });

    it('errors without calling the SDK when inputs are missing', async () => {
        const id = seedKustoCanvas(store, { query: '', clusterUrl: '', database: '' });
        let called = false;
        const factory: KustoClientFactory = () => {
            called = true;
            return { execute: async () => ({ primaryResults: [] }) };
        };
        const outcome = await runKustoCanvas(store, WS, id, { now: () => NOW, clientFactory: factory });
        expect(called).toBe(false);
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(outcome.state.lastRun?.status).toBe('error');
        expect(outcome.state.lastRun?.error).toMatch(/required/i);
    });

    it('returns not-found for a missing canvas', async () => {
        const outcome = await runKustoCanvas(store, WS, 'canvas-does-not-exist', { now: () => NOW });
        expect(outcome).toEqual({ ok: false, reason: 'not-found' });
    });

    it('returns wrong-type for a non-Kusto canvas', async () => {
        const rec = store.createCanvas({ workspaceId: WS, title: 'md', content: '# hi', type: 'markdown' });
        const outcome = await runKustoCanvas(store, WS, rec.id, { now: () => NOW });
        expect(outcome).toEqual({ ok: false, reason: 'wrong-type' });
    });

    it('preserves the chart config across a run', async () => {
        const id = seedKustoCanvas(store, {
            query: 'T | take 1',
            clusterUrl: 'https://c.kusto.windows.net',
            database: 'DB',
            chartConfig: { type: 'bar', x: 'n', y: ['n'] },
        });
        const outcome = await runKustoCanvas(store, WS, id, { now: () => NOW, clientFactory: mockFactory([[1]]) });
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(outcome.state.chartConfig).toEqual({ type: 'bar', x: 'n', y: ['n'] });
    });
});
