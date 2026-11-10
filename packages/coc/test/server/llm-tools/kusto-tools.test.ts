import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runScriptWithOwnerTools } from '../../../src/server/executors/owner-script-runner';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import { CONFIG_FILE_NAME } from '../../../src/config';
import { isCanvasScriptTool, validateCanvasManifestTools } from '../../../src/server/canvas/canvas-script-bridge';
import { summarizeToolParameters } from '../../../src/server/llm-tools/llm-tool-parameters';
import { LLM_TOOL_PARAMETER_SCHEMAS } from '../../../src/server/llm-tools/llm-tool-parameter-schemas';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
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
            executeQuery: async () => ({
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

    it.each([false, true])('emits typed result events on create and update (query failure: %s)', async fails => {
        const emitProcessEvent = vi.fn();
        const tool = createKustoTools({
            dataDir, workspaceId: WS, processId: 'query-chat',
            processStore: { emitProcessEvent } as unknown as ProcessStore,
            canvasStore: store,
            clientFactory: fails ? () => ({ executeQuery: async () => { throw new Error('query failed'); } }) : mockFactory([[9]]),
        }).kustoQuery;
        const inputs = { query: 'T', clusterUrl: 'https://c.kusto.windows.net', database: 'DB' };
        const created: any = await tool.handler!(inputs);
        const updated: any = await tool.handler!({ ...inputs, canvasId: created.canvasId });
        expect(updated.embed).toBe(`canvas://${created.canvasId}`);
        expect(store.listCanvases(WS, { processId: 'query-chat' })).toHaveLength(1);
        expect(emitProcessEvent).toHaveBeenCalledTimes(2);
        for (const [index, result] of [created, updated].entries()) {
            expect(emitProcessEvent).toHaveBeenNthCalledWith(index + 1, 'query-chat', {
                type: 'canvas-updated',
                canvasUpdate: { canvasId: result.canvasId, title: 'Kusto Query', revision: result.revision, editor: 'ai', canvasType: 'kusto' },
            });
        }
        expect(updated.revision).toBeGreaterThan(created.revision);
    });

    it('reports a conflicting edit without a result event or automatic retry', async () => {
        const record = store.createCanvas({
            workspaceId: WS, title: 'Query', type: 'kusto', processId: 'query-chat',
            content: serializeKustoState(createEmptyKustoState()),
        });
        const emitProcessEvent = vi.fn();
        const executeQuery = vi.fn(async () => {
            store.updateCanvas(WS, record.id, {
                title: 'Newer title', editor: 'user', expectedRevision: record.revision,
            });
            return { primaryResults: [] };
        });
        const tool = createKustoTools({
            dataDir, workspaceId: WS, processId: 'query-chat',
            processStore: { emitProcessEvent } as unknown as ProcessStore,
            canvasStore: store, clientFactory: () => ({ executeQuery }),
        }).kustoQuery;
        expect(await tool.handler!({
            canvasId: record.id, query: 'T', clusterUrl: 'https://c.kusto.windows.net', database: 'DB',
        })).toEqual({ success: false, error: expect.stringContaining('Reload') });
        expect(store.getCanvas(WS, record.id)).toMatchObject({
            title: 'Newer title', content: record.content, revision: record.revision + 1,
        });
        expect(emitProcessEvent).not.toHaveBeenCalled();
        expect(executeQuery).toHaveBeenCalledTimes(1);
    });

    it('cancels with the turn signal and does not write a late result into the canvas', async () => {
        const record = store.createCanvas({
            workspaceId: WS, title: 'Query', type: 'kusto',
            content: serializeKustoState(createEmptyKustoState()),
        });
        const turn = new AbortController();
        let querySignal: AbortSignal | undefined;
        const executeQuery = vi.fn((_db: string, _q: string, signal?: AbortSignal) => {
            querySignal = signal;
            return new Promise<never>(() => {});
        });
        const tool = makeTool(store, dataDir, () => ({ executeQuery }));
        const pending = tool.handler!(
            { canvasId: record.id, query: 'T', clusterUrl: 'https://c.kusto.windows.net', database: 'DB' },
            { sessionId: 's', toolCallId: 't', toolName: 'kusto_query', arguments: {}, signal: turn.signal } as any,
        );
        await vi.waitFor(() => expect(executeQuery).toHaveBeenCalledOnce());
        turn.abort(new Error('turn cancelled'));
        expect(await pending).toEqual({ success: false, error: 'turn cancelled' });
        expect(querySignal?.aborted).toBe(true);
        expect(store.getCanvas(WS, record.id)).toMatchObject({ content: record.content, revision: record.revision });
    });

    it('rechecks live disablement before executing', async () => {
        const clientFactory = vi.fn(mockFactory([[1]]));
        const tool = createKustoTools({
            dataDir, workspaceId: WS, canvasStore: store, clientFactory, getEnabled: () => false,
        }).kustoQuery;
        const res: any = await tool.handler!({ query: 'T', clusterUrl: 'https://c.kusto.windows.net', database: 'DB' });
        expect(res).toMatchObject({ success: false, error: 'Kusto is disabled on the server host.' });
        expect(clientFactory).not.toHaveBeenCalled();
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
            executeQuery: async () => { throw new Error('Semantic error: bad query'); },
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

    describe('execute_kusto_query', () => {
        const args = { query: 'T | take 2', clusterUrl: 'https://c.kusto.windows.net', database: 'DB' };
        const executionTool = (clientFactory = mockFactory([[1], [2]]), getEnabled = () => true) => createKustoTools({
            dataDir, workspaceId: WS, canvasStore: store, clientFactory, getEnabled,
        }).executeKustoQuery;

        it('returns structured results without creating or editing canvases or emitting updates', async () => {
            const seed = store.createCanvas({ workspaceId: WS, title: 'Existing', content: 'unchanged', type: 'markdown' });
            const emitProcessEvent = vi.fn();
            const clientFactory = vi.fn(mockFactory([[1], [2]]));
            const tool = createKustoTools({
                dataDir, workspaceId: WS, canvasStore: store, clientFactory,
                processId: 'owner', processStore: { emitProcessEvent } as unknown as ProcessStore,
            }).executeKustoQuery;
            // Even direct callers supplying canvas/command/owner fields cannot change the operation.
            expect(await tool.handler!({ ...args, canvasId: seed.id, command: '.drop table T', workspaceId: 'other' })).toEqual({
                success: true, columns: [{ name: 'n', type: 'long' }], rows: [[1], [2]], rowCount: 2, truncated: false,
            });
            expect(clientFactory).toHaveBeenCalledExactlyOnceWith(args);
            expect(store.listCanvases(WS)).toHaveLength(1);
            expect(store.getCanvas(WS, seed.id)).toEqual(seed);
            expect(store.listCanvases('other')).toEqual([]);
            expect(emitProcessEvent).not.toHaveBeenCalled();
        });

        it('returns more than the canvas row sample and enforces the execution row cap', async () => {
            const result = await executionTool(mockFactory(Array.from({ length: 10_002 }, (_, i) => [i]))).handler!(args);
            expect(result).toMatchObject({ success: true, rowCount: 10_002, truncated: true });
            expect((result as any).rows).toHaveLength(10_000);
            expect(store.listCanvases(WS)).toEqual([]);
        });

        it('enforces the byte cap and returns valid JSON', async () => {
            const tool = executionTool(mockFactory([['a'.repeat(5 * 1024 * 1024)], ['b'.repeat(5 * 1024 * 1024)]]));
            const result = await tool.handler!(args);
            expect(result).toMatchObject({ success: true, rowCount: 2, truncated: true });
            expect((result as any).rows).toHaveLength(1);
            expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(8 * 1024 * 1024);
            expect(JSON.parse(JSON.stringify(result))).toEqual(result);
        });

        it.each(['query', 'clusterUrl', 'database'] as const)('rejects missing or invalid %s before execution', async field => {
            const clientFactory = vi.fn(mockFactory([[1]]));
            const tool = executionTool(clientFactory);
            for (const value of ['', '  ', null, 42]) {
                expect(await tool.handler!({ ...args, [field]: value })).toEqual({ success: false, error: `${field} is required` });
            }
            expect(clientFactory).not.toHaveBeenCalled();
            expect(store.listCanvases(WS)).toEqual([]);
        });

        it('rejects management commands before constructing an SDK client', async () => {
            const clientFactory = vi.fn(mockFactory([[1]]));
            expect(await executionTool(clientFactory).handler!({ ...args, query: '  .show tables' }))
                .toMatchObject({ success: false, error: expect.stringMatching(/management commands require explicit approval/) });
            expect(clientFactory).not.toHaveBeenCalled();
            expect(isCanvasScriptTool('execute_kusto_query')).toBe(true);
            expect(isCanvasScriptTool('kusto_query')).toBe(false);
            expect(validateCanvasManifestTools(['execute_kusto_query'])).toEqual({ ok: true, tools: ['execute_kusto_query'] });
        });

        it('rechecks live disablement before real or mock execution', async () => {
            let enabled = true;
            const clientFactory = vi.fn(mockFactory([[1]]));
            const tool = executionTool(clientFactory, () => enabled);
            enabled = false;
            for (const query of [args.query, 'mock:big: 2']) {
                expect(await tool.handler!({ ...args, query })).toEqual({ success: false, error: 'Kusto is disabled on the server host.' });
            }
            expect(clientFactory).not.toHaveBeenCalled();
        });

        it('surfaces query and redacted host auth failures without persisting an error canvas or retrying', async () => {
            for (const message of ['Semantic error: bad query', 'Kusto Rust auth: AccountMismatch']) {
                const executeQuery = vi.fn(async () => { throw new Error(message); });
                expect(await executionTool(() => ({ executeQuery })).handler!(args)).toEqual({ success: false, error: message });
                expect(executeQuery).toHaveBeenCalledOnce();
                expect(store.listCanvases(WS)).toEqual([]);
            }
        });

        it.each(['allowed', 'disabled', 'approval-required'] as const)('uses owner script permissions (%s)', async mode => {
            writeRepoPreferences(dataDir, WS, {
                disabledLlmTools: mode === 'disabled' ? ['execute_kusto_query'] : [],
                approvalRequiredLlmTools: mode === 'approval-required' ? ['execute_kusto_query'] : [],
            });
            fs.writeFileSync(path.join(dataDir, CONFIG_FILE_NAME),
                'features:\n  canvasHostApis: false\n  toolScripting: false\n  canvasToolScripts: false\n');
            const clientFactory = vi.fn(mockFactory([[1], [2]]));
            const emitProcessEvent = vi.fn();
            const result = await runScriptWithOwnerTools({
                ownerTools: {
                    dataDir, workspaceId: WS, processId: 'owner',
                    store: { emitProcessEvent } as unknown as ProcessStore,
                    includeMemoryV2: false,
                    kustoRuntime: { getEnabled: () => true, clientFactory },
                },
                allowTools: ['execute_kusto_query'],
                code: `return await tools.execute_kusto_query(${JSON.stringify(args)});`,
            });
            if (mode === 'allowed') {
                expect(result).toMatchObject({ ok: true, callCount: 1, result: { success: true, rows: [[1], [2]] } });
                expect(clientFactory).toHaveBeenCalledOnce();
            } else {
                expect(result.ok).toBe(false);
                expect(clientFactory).not.toHaveBeenCalled();
            }
            expect(store.listCanvases(WS)).toEqual([]);
            expect(emitProcessEvent).not.toHaveBeenCalled();
        });

        it('keeps settings parameter metadata aligned with the execution tool schema', () => {
            expect(summarizeToolParameters(executionTool().parameters))
                .toEqual(summarizeToolParameters(LLM_TOOL_PARAMETER_SCHEMAS.execute_kusto_query));
        });
    });

});
