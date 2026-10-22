import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildChatToolBundle } from '../../../src/server/executors/chat-tool-builder';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import { CONFIG_FILE_NAME } from '../../../src/config';
import type { OwnerScriptRunner } from '../../../src/server/executors/owner-script-runner';

const WS = 'ws-canvas-script';

describe('extension_canvas in buildChatToolBundle gets the owner script runner', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-owner-script-'));
        writeRepoPreferences(tmpDir, WS, { disabledLlmTools: [] });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    async function runRefresh(features: string) {
        fs.writeFileSync(path.join(tmpDir, CONFIG_FILE_NAME), `features:\n${features}`);
        const runner = vi.fn<OwnerScriptRunner>(async () => ({ ok: true, result: { n: 3 }, logs: [], calls: [], callCount: 1 }));
        const bundle = buildChatToolBundle({
            dataDir: tmpDir,
            store: { emitProcessEvent: vi.fn() } as any,
            workspaceId: WS,
            processId: 'owner-chat',
            canvasToolsEnabled: true,
            kustoToolsEnabled: false,
            systemOneToolEnabled: false,
            ownerScriptRunner: runner,
        });
        const extension = bundle.tools.find(tool => tool.name === 'extension_canvas')!;
        const invocation = { sessionId: 's', toolCallId: 'c', toolName: 'extension_canvas', arguments: {} };
        const built = await extension.handler!({
            title: 'Board', description: 'd',
            capabilities: [{ name: 'refresh', description: 'r', async: true }],
            capabilitiesJs: 'capabilities = { async refresh(state, params, host) { try { return { out: (await host.runScript("return 1;")).result }; } catch (e) { return { code: e.code }; } } };',
            uiHtml: '<div></div>',
            tools: ['query_pull_request'],
        } as never, invocation as never) as { canvasId: string };
        const ran = await extension.handler!({ canvasId: built.canvasId, capability: 'refresh' } as never, invocation as never) as { state: string };
        return { runner, state: JSON.parse(ran.state) };
    }

    it('runs host.runScript as the canvas owner when all three flags are on', async () => {
        const { runner, state } = await runRefresh('  canvasHostApis: true\n  canvasToolScripts: true\n');
        expect(state).toEqual({ out: { n: 3 } });
        expect(runner).toHaveBeenCalledWith(expect.objectContaining({
            workspaceId: WS, processId: 'owner-chat', allowTools: ['query_pull_request'],
        }));
    });

    it("rejects 'disabled' while features.canvasToolScripts is off", async () => {
        const { runner, state } = await runRefresh('  canvasHostApis: true\n');
        expect(state).toEqual({ code: 'disabled' });
        expect(runner).not.toHaveBeenCalled();
    });
});
