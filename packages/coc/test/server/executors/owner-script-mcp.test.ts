/**
 * MCP access for scripts that run outside a chat turn — canvas `host.runScript`
 * (owner-script runner) and Sentinel refrain gates — through the production
 * chain: servers come from the owner chat's workspace, `mcp_call` keeps the
 * unattended approval policy, and every client is closed when the run ends.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { RepoQueueRegistry, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { buildMemoryV2Addon } from '../../../src/server/executors/memory-v2-addon';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import { createCanvasRunScriptFactory } from '../../../src/server/canvas/canvas-script-bridge';
import { CONFIG_FILE_NAME } from '../../../src/config';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

vi.mock('../../../src/server/executors/memory-v2-addon', () => ({ buildMemoryV2Addon: vi.fn() }));

const FIXTURE = path.join(__dirname, '..', 'llm-tools', 'fixtures', 'fake-mcp-server.cjs');
const PID_SCRIPT = `return Number(await tools.mcp_call({ server: 'alpha', tool: 'pid' }));`;

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function waitForExit(pid: number): Promise<void> {
    const deadline = Date.now() + 5000;
    while (isAlive(pid) && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
    expect(isAlive(pid)).toBe(false);
}

describe('owner scripts reach the owner workspace MCP servers', () => {
    let dataDir: string;
    let store: SqliteProcessStore;
    let router: MultiRepoQueueRouter;
    const sdk = createMockSDKService();

    function setFeatures(features: Record<string, boolean>) {
        fs.writeFileSync(path.join(dataDir, CONFIG_FILE_NAME),
            `features:\n${Object.entries(features).map(([k, v]) => `  ${k}: ${v}\n`).join('')}`);
    }

    async function addOwner(workspaceId: string, processId: string, server: string,
        metadata: Record<string, unknown> = { mode: 'ask', provider: 'copilot' }) {
        const rootPath = path.join(dataDir, workspaceId);
        fs.mkdirSync(path.join(rootPath, '.vscode'), { recursive: true });
        fs.writeFileSync(path.join(rootPath, '.vscode', 'mcp.json'), JSON.stringify({
            servers: { [server]: { command: process.execPath, args: [FIXTURE] } },
        }));
        await store.registerWorkspace({ id: workspaceId, name: workspaceId, rootPath, enabledMcpServers: [server] } as any);
        await store.addProcess({
            id: processId, type: 'chat', status: 'completed', startTime: new Date(),
            promptPreview: 'Owner', metadata: { workspaceId, ...metadata },
        });
        // Approval off for mcp_call: unattended runs may call it.
        writeRepoPreferences(dataDir, workspaceId, { disabledLlmTools: [], approvalOptOutLlmTools: ['mcp_call'] });
    }

    beforeEach(async () => {
        vi.clearAllMocks();
        sdk.resetAll();
        dataDir = fs.mkdtempSync(path.join(tmpdir(), 'owner-script-mcp-'));
        store = new SqliteProcessStore({ dbPath: ':memory:' });
        setFeatures({ toolScripting: true, toolScriptingMcp: true });
        vi.mocked(buildMemoryV2Addon).mockImplementation(async () => ({
            tools: [], suffix: '', excludedBuiltinTools: [], dispose: () => {},
        }));
        router = new MultiRepoQueueRouter(new RepoQueueRegistry(), store, {
            dataDir, autoStart: false, aiService: sdk.service,
        });
        await addOwner('ws-a', 'chat-a', 'alpha');
    });

    afterEach(() => {
        router.dispose();
        store.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    const runOwner = (code: string, workspaceId = 'ws-a', processId = 'chat-a') =>
        router.runOwnerScript({ workspaceId, processId, code, allowTools: [] });

    it('lists and calls the owner servers, then kills the stdio child when the run ends', async () => {
        const run = await runOwner(`
            const listed = await tools.mcp_list_tools({ server: 'alpha' });
            let failed;
            try { await tools.mcp_call({ server: 'alpha', tool: 'fail' }); } catch (e) { failed = e.name; }
            const pid = Number(await tools.mcp_call({ server: 'alpha', tool: 'pid' }));
            return { names: listed.tools.map(t => t.name), failed, pid };`);
        expect(run.ok).toBe(true);
        const result = run.result as { names: string[]; failed: string; pid: number };
        expect(result.names).toContain('echo');
        expect(result.failed).toBe('ToolCallError');
        await waitForExit(result.pid);
        expect(sdk.service.sendMessage).not.toHaveBeenCalled();
    });

    it('keeps two owner workspaces isolated', async () => {
        await addOwner('ws-b', 'chat-b', 'beta');
        const run = await runOwner(`
            let alpha;
            try { await tools.mcp_list_tools({ server: 'alpha' }); } catch (e) { alpha = e.message; }
            const beta = await tools.mcp_list_tools({ server: 'beta' });
            return { alpha, beta: beta.tools.length };`, 'ws-b', 'chat-b');
        expect(run.result).toMatchObject({ beta: 4 });
        expect((run.result as { alpha: string }).alpha).toContain('unknown-server');
    });

    it('denies mcp_call by default on unattended runs but still lists tools', async () => {
        writeRepoPreferences(dataDir, 'ws-a', { disabledLlmTools: [] });
        const run = await runOwner(`
            const listed = await tools.mcp_list_tools({ server: 'alpha' });
            let denied;
            try { await tools.mcp_call({ server: 'alpha', tool: 'echo', args: { text: 'x' } }); } catch (e) { denied = e.message; }
            return { listed: listed.tools.length, denied };`);
        expect(run.result).toMatchObject({ listed: 4 });
        expect((run.result as { denied?: string }).denied).toBeTruthy();
    });

    it('offers nothing MCP-related when the flag is off', async () => {
        setFeatures({ toolScripting: true, toolScriptingMcp: false });
        const run = await runOwner(`return await tools.mcp_list_tools({ server: 'alpha' });`);
        expect(run.ok).toBe(false);
        expect(run.error?.name).toBe('ToolCallError');
    });

    it('still reaches MCP for a Codex owner, whose turns leave run_tool_script out', async () => {
        await addOwner('ws-c', 'chat-c', 'alpha', { mode: 'ask', provider: 'codex' });
        const run = await runOwner(PID_SCRIPT, 'ws-c', 'chat-c');
        expect(run.ok).toBe(true);
        await waitForExit(run.result as number);
    });

    it('serves canvas host.runScript as the owner chat, even with no manifest tools', async () => {
        const runScript = createCanvasRunScriptFactory({
            getFeatures: () => ({ canvasHostApis: true, toolScripting: true, canvasToolScripts: true }),
            getOwnerScriptRunner: () => router.runOwnerScript,
            log: () => {},
        })({ workspaceId: 'ws-a', canvasId: 'canvas-1', capability: 'refresh', processId: 'chat-a', tools: [] });
        const outcome = await runScript({ code: PID_SCRIPT }, new AbortController().signal);
        expect(outcome.ok).toBe(true);
        await waitForExit((outcome as { result: number }).result);
    });

    it('runs Sentinel refrain gates with the owner servers and closes them after the gate', async () => {
        await addOwner('ws-s', 'sentinel-s', 'alpha', { mode: 'sentinel', provider: 'copilot' });
        const pid = await router.runRefrainGate({
            workspaceId: 'ws-s', processId: 'sentinel-s', code: PID_SCRIPT, state: null,
        }) as number;
        expect(pid).toBeGreaterThan(0);
        await waitForExit(pid);
    });
});
