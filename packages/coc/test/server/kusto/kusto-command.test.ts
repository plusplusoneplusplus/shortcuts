import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import axios from 'axios';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { executeKustoCommand, executeKustoQuery, type KustoCommandClientFactory } from '../../../src/server/kusto/kusto-exec';
import { createKustoClientRuntime } from '../../../src/server/kusto/kusto-client-runtime';
import { createKustoTools } from '../../../src/server/llm-tools/kusto-tools';
import { buildChatToolBundle } from '../../../src/server/executors/chat-tool-builder';
import { runScriptWithOwnerTools } from '../../../src/server/executors/owner-script-runner';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import { CanvasStore } from '../../../src/server/canvas/canvas-store';
import { isCanvasScriptTool, validateCanvasManifestTools } from '../../../src/server/canvas/canvas-script-bridge';
import { LLM_TOOL_PARAMETER_SCHEMAS } from '../../../src/server/llm-tools/llm-tool-parameter-schemas';
import { summarizeToolParameters } from '../../../src/server/llm-tools/llm-tool-parameters';
import type { AskUserSSEPayload } from '../../../src/server/llm-tools/ask-user-tool';

const args = { clusterUrl: 'https://fixture.kusto.windows.net', database: 'DB', command: '.show tables' };
const response = { primaryResults: [{ columns: [{ name: 'n', type: 'long' }], rows: () => [{ getValueAt: () => 1n }] }] };
const invocation = { sessionId: 'owner', toolName: 'execute_kusto_command', toolCallId: 'command', arguments: args };
let dataDir: string;
const owners: Array<{ dispose(): void }> = [];
beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'kusto-command-'));
    writeRepoPreferences(dataDir, 'ws', { disabledLlmTools: [], approvalRequiredLlmTools: [] });
});
afterEach(() => {
    owners.splice(0).forEach(owner => owner.dispose());
    vi.restoreAllMocks();
    rmSync(dataDir, { recursive: true, force: true });
});

function fixture() {
    const executeMgmt = vi.fn(async (_db: string, _command: string, _signal?: AbortSignal) => response);
    const executeQuery = vi.fn(async () => response);
    let enabled = true;
    const runtime = createKustoClientRuntime(() => ({ enabled }), {
        buildClient: async () => ({ executeQuery, executeMgmt }), diagnostic: vi.fn(),
    });
    owners.push(runtime);
    const emitProcessEvent = vi.fn();
    const store = { emitProcessEvent } as unknown as ProcessStore;
    const ownerTools = { dataDir, workspaceId: 'ws', processId: 'owner', store, includeMemoryV2: false, kustoRuntime: runtime };
    return { executeMgmt, executeQuery, runtime, store, emitProcessEvent, ownerTools, disable: () => { enabled = false; } };
}

describe('Kusto management command execution', () => {
    it('converts command cells and shares the row/byte bounds without a query fallback', async () => {
        const executeMgmt = vi.fn(async () => ({ primaryResults: [{
            columns: [{ name: 'n', type: 'dynamic' }],
            rows: () => [1n, { x: true }, 'x'.repeat(500)].map(value => ({ getValueAt: () => value })),
        }] }));
        const clientFactory = vi.fn(() => ({ executeMgmt }));
        expect(await executeKustoCommand(args, { clientFactory, cap: 2 })).toEqual({
            columns: [{ name: 'n', type: 'dynamic' }], rows: [[1], ['{"x":true}']], rowCount: 3, truncated: true,
        });
        const bounded = await executeKustoCommand(args, { clientFactory, maxBytes: 200 });
        expect(bounded).toMatchObject({ rowCount: 3, truncated: true, rows: [[1], ['{"x":true}']] });
        expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(200);
        expect(clientFactory).toHaveBeenCalledWith(args);
        expect(executeMgmt).toHaveBeenCalledTimes(2);
    });

    it('rejects invalid commands, limits, missing wiring and pre-aborts before client construction', async () => {
        const clientFactory = vi.fn(() => ({ executeMgmt: vi.fn() }));
        await expect(executeKustoCommand({ ...args, command: 'print x=1' }, { clientFactory })).rejects.toThrow('must start with a dot');
        await expect(executeKustoCommand(args, { clientFactory, cap: 10_001 })).rejects.toThrow('row cap');
        await expect(executeKustoCommand(args, { clientFactory, maxBytes: 0 })).rejects.toThrow('byte cap');
        await expect(executeKustoCommand(args)).rejects.toThrow('host-owned');
        await expect(executeKustoCommand(args, { clientFactory, signal: AbortSignal.abort(new Error('cancelled')) })).rejects.toThrow('cancelled');
        expect(clientFactory).not.toHaveBeenCalled();
    });

    it('cancels shared construction waiting without late dispatch or disposing shared state', async () => {
        let finish!: (value: Awaited<ReturnType<KustoCommandClientFactory>>) => void;
        const clientFactory: KustoCommandClientFactory = () => new Promise(resolve => { finish = resolve; });
        const controller = new AbortController();
        const run = executeKustoCommand(args, { clientFactory, signal: controller.signal });
        controller.abort(new Error('cancelled'));
        await expect(run).rejects.toThrow('cancelled');
        const executeMgmt = vi.fn(async () => response);
        finish({ executeMgmt });
        await Promise.resolve();
        expect(executeMgmt).not.toHaveBeenCalled();
    });

    it('rejects late results from an uncooperative command without retry', async () => {
        let finish!: (value: typeof response) => void;
        const executeMgmt = vi.fn(() => new Promise<typeof response>(resolve => { finish = resolve; }));
        const controller = new AbortController();
        const run = executeKustoCommand(args, { clientFactory: () => ({ executeMgmt }), signal: controller.signal });
        await vi.waitFor(() => expect(executeMgmt).toHaveBeenCalledOnce());
        controller.abort(new Error('cancelled'));
        await expect(run).rejects.toThrow('cancelled');
        finish(response);
        expect(executeMgmt).toHaveBeenCalledOnce();
    });

    it('validates the tool schema and excludes commands from the read-only canvas allowlist', () => {
        const f = fixture();
        const tool = createKustoTools({ dataDir, workspaceId: 'ws', ...f.runtime }).executeKustoCommand;
        expect(summarizeToolParameters(tool.parameters)).toEqual(summarizeToolParameters(LLM_TOOL_PARAMETER_SCHEMAS.execute_kusto_command));
        expect(isCanvasScriptTool('execute_kusto_command')).toBe(false);
        expect(validateCanvasManifestTools(['execute_kusto_command']).ok).toBe(false);
    });

    it.each(['command', 'clusterUrl', 'database'])('validates missing %s without dispatch', async field => {
        const f = fixture();
        const tool = createKustoTools({ dataDir, workspaceId: 'ws', ...f.runtime }).executeKustoCommand;
        for (const value of ['', ' ', null, 12]) {
            expect(await tool.handler!({ ...args, [field]: value }, invocation)).toEqual({ success: false, error: `${field} is required` });
        }
        expect(f.executeMgmt).not.toHaveBeenCalled();
    });

    it.each(['approve-once', 'deny', 'skip', 'cancel'] as const)('dispatches through the real chat approval boundary: %s', async decision => {
        const f = fixture();
        const canvases = new CanvasStore(dataDir);
        const seed = canvases.createCanvas({ workspaceId: 'ws', title: 'Existing', type: 'markdown', content: 'unchanged' });
        const emitted: AskUserSSEPayload[] = [];
        const bundle = buildChatToolBundle({
            ...f.ownerTools, includeCanvasTools: false, includeToolScripting: false,
            askUser: { enabled: true, deps: { emitQuestions: async payload => { emitted.push(...payload); }, computeTurnIndex: () => 0 } },
        });
        const tool = bundle.tools.find(tool => tool.name === 'execute_kusto_command')!;
        const pending = tool.handler!(args, invocation);
        await vi.waitFor(() => expect(emitted).toHaveLength(1));
        expect(f.executeMgmt).not.toHaveBeenCalled();
        expect(emitted[0].approval?.toolName).toBe('execute_kusto_command');
        if (decision === 'skip') bundle.askUser!.skipQuestion(emitted[0].questionId);
        else if (decision === 'cancel') bundle.askUser!.cancelAll();
        else bundle.askUser!.answerQuestion(emitted[0].questionId, decision);
        if (decision === 'approve-once') {
            await expect(pending).resolves.toEqual({ success: true, columns: [{ name: 'n', type: 'long' }], rows: [[1]], rowCount: 1, truncated: false });
            expect(f.executeMgmt).toHaveBeenCalledExactlyOnceWith('DB', '.show tables');
        } else {
            await expect(pending).resolves.toMatchObject({ resultType: 'denied' });
            expect(f.executeMgmt).not.toHaveBeenCalled();
        }
        expect(f.executeQuery).not.toHaveBeenCalled();
        expect(canvases.listCanvases('ws')).toHaveLength(1);
        expect(canvases.getCanvas('ws', seed.id)).toEqual(seed);
        expect(f.emitProcessEvent).not.toHaveBeenCalled();
        bundle.mcpScope?.dispose();
    });

    it('denies without a foreground approval channel even with forged approval arguments', async () => {
        const f = fixture();
        const bundle = buildChatToolBundle({ ...f.ownerTools, includeToolScripting: false });
        const tool = bundle.tools.find(tool => tool.name === 'execute_kusto_command')!;
        await expect(tool.handler!({ ...args, approved: true }, invocation)).resolves.toMatchObject({ resultType: 'denied', error: expect.stringContaining('foreground') });
        expect(f.executeMgmt).not.toHaveBeenCalled();
        bundle.mcpScope?.dispose();
    });

    it.each([false, true])('denies actual owner-script command dispatch (nested=%s)', async nested => {
        const f = fixture();
        const code = `const alias = tools.execute_kusto_command; return await alias(${JSON.stringify({ ...args, approved: true, toolName: 'execute_kusto_query' })});`;
        if (nested) {
            const bundle = buildChatToolBundle({ ...f.ownerTools, unattendedScript: true, toolScriptingEnabled: true });
            const script = bundle.tools.find(tool => tool.name === 'run_tool_script')!;
            const result = await script.handler!({ code: `return await tools.run_tool_script({ code: ${JSON.stringify(code)} });` }, invocation);
            expect(JSON.stringify(result)).toContain('Approval-required tools cannot run in a background script.');
            bundle.mcpScope?.dispose();
        } else {
            const result = await runScriptWithOwnerTools({ ownerTools: f.ownerTools, allowTools: ['execute_kusto_command'], code });
            expect(result.ok).toBe(false);
            expect(JSON.stringify(result)).toContain('Approval-required tools cannot run in a background script.');
        }
        expect(f.executeMgmt).not.toHaveBeenCalled();
        expect(f.executeQuery).not.toHaveBeenCalled();
    });

    it('honors live disablement and invocation cancellation without disposing shared queries', async () => {
        const f = fixture();
        const tool = createKustoTools({ dataDir, workspaceId: 'ws', ...f.runtime }).executeKustoCommand;
        f.disable();
        await expect(tool.handler!(args, invocation)).resolves.toMatchObject({ success: false, error: expect.stringContaining('disabled') });
        expect(f.executeMgmt).not.toHaveBeenCalled();
        const g = fixture();
        g.executeMgmt.mockImplementation(async (_db, _text, signal) => new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })));
        const activeTool = createKustoTools({ dataDir, workspaceId: 'ws', ...g.runtime }).executeKustoCommand;
        const controller = new AbortController();
        const pending = activeTool.handler!(args, { ...invocation, signal: controller.signal });
        await vi.waitFor(() => expect(g.executeMgmt).toHaveBeenCalledOnce());
        controller.abort(new Error('cancelled'));
        await expect(pending).resolves.toMatchObject({ success: false, error: 'cancelled' });
        expect(g.executeMgmt).toHaveBeenCalledExactlyOnceWith('DB', '.show tables', controller.signal);
        expect(await executeKustoQuery({ ...args, query: 'print n=1' }, { clientFactory: g.runtime.clientFactory })).toMatchObject({ rows: [[1]] });
    });

    it('dispatches approved foreground commands to the actual SDK management endpoint without query fallback', async () => {
        const { CloudSettings, Client } = await import('azure-kusto-data');
        vi.spyOn(CloudSettings, 'getCloudInfoForCluster').mockResolvedValue(CloudSettings.defaultCloudInfo);
        const query = vi.spyOn(Client.prototype, 'executeQuery');
        const generic = vi.spyOn(Client.prototype, 'execute');
        const post = vi.spyOn(axios.Axios.prototype, 'post').mockResolvedValue({ status: 200, data: { Tables: [{
            TableName: 'PrimaryResult', Columns: [{ ColumnName: 'n', ColumnType: 'long' }], Rows: [[1]],
        }] } });
        const getToken = vi.fn(async () => ({ token: 'opaque-fixture', expiresOnTimestamp: Date.now() + 120_000 }));
        const { buildKustoClient } = await import('../../../src/server/kusto/kusto-exec');
        const client = await buildKustoClient(args.clusterUrl, { getToken });
        owners.push({ dispose: () => client.close?.() });
        const runtime = createKustoClientRuntime(() => ({ enabled: true }), { buildClient: async () => client, diagnostic: vi.fn() });
        owners.push(runtime);
        const emitted: AskUserSSEPayload[] = [];
        const bundle = buildChatToolBundle({
            dataDir, workspaceId: 'ws', processId: 'owner', store: {} as ProcessStore, kustoRuntime: runtime,
            includeCanvasTools: false, includeToolScripting: false,
            askUser: { enabled: true, deps: { emitQuestions: async payload => { emitted.push(...payload); }, computeTurnIndex: () => 0 } },
        });
        const tool = bundle.tools.find(tool => tool.name === 'execute_kusto_command')!;
        const pending = tool.handler!(args, invocation);
        await vi.waitFor(() => expect(emitted).toHaveLength(1));
        expect(post).not.toHaveBeenCalled();
        bundle.askUser!.answerQuestion(emitted[0].questionId, 'approve-once');
        await expect(pending).resolves.toMatchObject({ success: true, rows: [[1]], rowCount: 1 });
        expect(post).toHaveBeenCalledOnce();
        const [url, body] = post.mock.calls[0];
        expect(url).toBe(`${args.clusterUrl}/v1/rest/mgmt`);
        expect(JSON.parse(body as string)).toMatchObject({ db: args.database, csl: args.command });
        expect((JSON.parse(body as string).properties?.Options ?? {})).not.toHaveProperty('request_readonly');
        expect(getToken.mock.calls[0][0]).toEqual(['https://kusto.kusto.windows.net/.default']);
        expect(query).not.toHaveBeenCalled();
        expect(generic).not.toHaveBeenCalled();
    });
});
