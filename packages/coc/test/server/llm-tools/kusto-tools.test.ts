import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CanvasStore } from '../../../src/server/canvas/canvas-store';
import { createKustoTools, KUSTO_QUERY_ROW_SAMPLE } from '../../../src/server/llm-tools/kusto-tools';
import {
    createEmptyKustoState,
    parseKustoState,
    serializeKustoState,
} from '../../../src/server/canvas/kusto-state';
import type { KustoClientFactory, KustoClientLike } from '../../../src/server/kusto/kusto-exec';

const WS = 'kusto-tool-ws';
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

function makeTool(store: CanvasStore, dataDir: string, clientFactory: KustoClientFactory) {
    return createKustoTools({
        dataDir,
        workspaceId: WS,
        canvasStore: store,
        clientFactory,
        now: () => NOW,
    }).kustoQuery;
}

describe('kusto_query tool', () => {
    let dataDir: string;
    let store: CanvasStore;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-kusto-tool-'));
        store = new CanvasStore(dataDir);
    });
    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('creates a new Kusto canvas, runs the query, and returns schema + rows + embed', async () => {
        const tool = makeTool(store, dataDir, mockFactory([[1], [2], [3]]));
        const res: any = await tool.handler!({
            query: 'T | take 3',
            clusterUrl: 'https://c.kusto.windows.net',
            database: 'DB',
        });
        expect(res.success).toBe(true);
        expect(res.created).toBe(true);
        expect(res.canvasId).toBeTruthy();
        expect(res.embed).toBe(`canvas://${res.canvasId}`);
        expect(res.columns).toEqual([{ name: 'n', type: 'long' }]);
        expect(res.rows).toEqual([[1], [2], [3]]);
        expect(res.rowCount).toBe(3);
        expect(res.truncated).toBe(false);

        // Persisted and reloadable.
        const reloaded = parseKustoState(store.getCanvas(WS, res.canvasId)!.content);
        expect(reloaded.query).toBe('T | take 3');
        expect(reloaded.rows).toEqual([[1], [2], [3]]);
        expect(reloaded.lastRun?.status).toBe('success');
    });

    it('caps the returned row sample at KUSTO_QUERY_ROW_SAMPLE but stores the full count', async () => {
        const rows = Array.from({ length: KUSTO_QUERY_ROW_SAMPLE + 20 }, (_, i) => [i]);
        const tool = makeTool(store, dataDir, mockFactory(rows));
        const res: any = await tool.handler!({
            query: 'T',
            clusterUrl: 'https://c.kusto.windows.net',
            database: 'DB',
        });
        expect(res.success).toBe(true);
        expect(res.rows.length).toBe(KUSTO_QUERY_ROW_SAMPLE);
        expect(res.rowSampleCount).toBe(KUSTO_QUERY_ROW_SAMPLE);
        expect(res.rowCount).toBe(KUSTO_QUERY_ROW_SAMPLE + 20);
        // Full set is stored on the canvas (within the 10k cap).
        const reloaded = parseKustoState(store.getCanvas(WS, res.canvasId)!.content);
        expect(reloaded.rows.length).toBe(KUSTO_QUERY_ROW_SAMPLE + 20);
    });

    it('updates an existing Kusto canvas when canvasId is provided', async () => {
        const seed = store.createCanvas({
            workspaceId: WS,
            title: 'Existing',
            type: 'kusto',
            content: serializeKustoState(createEmptyKustoState({
                query: 'old', clusterUrl: 'https://old', database: 'OLD',
            })),
        });
        const tool = makeTool(store, dataDir, mockFactory([[9]]));
        const res: any = await tool.handler!({
            canvasId: seed.id,
            query: 'new | take 1',
            clusterUrl: 'https://new.kusto.windows.net',
            database: 'NEW',
        });
        expect(res.success).toBe(true);
        expect(res.created).toBe(false);
        expect(res.canvasId).toBe(seed.id);
        const reloaded = parseKustoState(store.getCanvas(WS, seed.id)!.content);
        expect(reloaded.query).toBe('new | take 1');
        expect(reloaded.database).toBe('NEW');
        expect(reloaded.rows).toEqual([[9]]);
    });

    it('applies an initial chart config on create', async () => {
        const tool = makeTool(store, dataDir, mockFactory([[1]]));
        const res: any = await tool.handler!({
            query: 'T | take 1',
            clusterUrl: 'https://c.kusto.windows.net',
            database: 'DB',
            chartConfig: { type: 'bar', x: 'n', y: ['n'] },
        });
        expect(res.success).toBe(true);
        expect(res.chartConfig).toEqual({ type: 'bar', x: 'n', y: ['n'] });
        const reloaded = parseKustoState(store.getCanvas(WS, res.canvasId)!.content);
        expect(reloaded.chartConfig).toEqual({ type: 'bar', x: 'n', y: ['n'] });
    });

    it('surfaces a query/auth error as success:false but still persists the Kusto canvas with an embed', async () => {
        const failing: KustoClientFactory = () => ({
            execute: async () => { throw new Error('Semantic error: bad query'); },
        });
        const tool = makeTool(store, dataDir, failing);
        const res: any = await tool.handler!({
            query: 'bad',
            clusterUrl: 'https://c.kusto.windows.net',
            database: 'DB',
        });
        expect(res.success).toBe(false);
        expect(res.error).toBe('Semantic error: bad query');
        expect(res.canvasId).toBeTruthy();
        expect(res.embed).toBe(`canvas://${res.canvasId}`);
        const reloaded = parseKustoState(store.getCanvas(WS, res.canvasId)!.content);
        expect(reloaded.lastRun?.status).toBe('error');
    });

    it('rejects missing required inputs without creating a canvas', async () => {
        const tool = makeTool(store, dataDir, mockFactory([[1]]));
        const res: any = await tool.handler!({ query: '', clusterUrl: 'https://c', database: 'DB' });
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/query is required/);
        expect(store.listCanvases(WS).length).toBe(0);
    });

    it('rejects a canvasId that is not a Kusto canvas', async () => {
        const md = store.createCanvas({ workspaceId: WS, title: 'md', content: '# hi', type: 'markdown' });
        const tool = makeTool(store, dataDir, mockFactory([[1]]));
        const res: any = await tool.handler!({
            canvasId: md.id,
            query: 'T',
            clusterUrl: 'https://c.kusto.windows.net',
            database: 'DB',
        });
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/not a Kusto canvas/);
    });
});
