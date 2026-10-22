/**
 * `runOwnerScript` (canvas `host.runScript`) through the production chain:
 * router → repo bridge → executor registry → chat executor → owner tools.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RepoQueueRegistry, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { OwnerScriptUnavailableError } from '../../../src/server/executors/owner-script-runner';
import { buildMemoryV2Addon } from '../../../src/server/executors/memory-v2-addon';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

vi.mock('../../../src/server/executors/memory-v2-addon', () => ({ buildMemoryV2Addon: vi.fn() }));

const owner = { workspaceId: 'workspace-a', processId: 'chat-a' };

describe('production owner script runtime', () => {
    let dataDir: string;
    let store: SqliteProcessStore;
    let router: MultiRepoQueueRouter;
    const sdk = createMockSDKService();
    const dispose = vi.fn();
    const allowed = vi.fn(async () => JSON.stringify({ value: 1 }));
    const other = vi.fn(async () => JSON.stringify({ value: 2 }));

    beforeEach(async () => {
        vi.clearAllMocks();
        sdk.resetAll();
        dataDir = mkdtempSync(join(tmpdir(), 'owner-script-'));
        store = new SqliteProcessStore({ dbPath: ':memory:' });
        await store.registerWorkspace({ id: owner.workspaceId, name: 'Owner', rootPath: dataDir });
        // Any chat may own a canvas — not only Sentinel.
        await store.addProcess({
            id: owner.processId, type: 'chat', status: 'completed', startTime: new Date(),
            promptPreview: 'Chat', metadata: { workspaceId: owner.workspaceId, mode: 'ask', provider: 'copilot' },
        });
        writeRepoPreferences(dataDir, owner.workspaceId, { disabledLlmTools: [] });
        vi.mocked(buildMemoryV2Addon).mockImplementation(async () => ({
            tools: [defineTool('save_memory', { handler: allowed }), defineTool('recall_memory', { handler: other })],
            suffix: '', excludedBuiltinTools: [], dispose,
        }));
        router = new MultiRepoQueueRouter(new RepoQueueRegistry(), store, {
            dataDir, autoStart: false, aiService: sdk.service,
        });
    });

    afterEach(() => {
        router.dispose();
        store.close();
        rmSync(dataDir, { recursive: true, force: true });
    });

    function run(code: string, allowTools: string[] = ['save_memory'], target = owner, state?: unknown) {
        return router.runOwnerScript({ ...target, code, allowTools, ...(state === undefined ? {} : { state }) });
    }

    it('runs with the owner tools narrowed to allowTools and returns the full engine outcome', async () => {
        const result = await run(
            'console.log("hi"); const a = await tools.save_memory({}); '
            + 'let b; try { await tools.recall_memory({}); } catch (e) { b = e.name; } return { a, b, s: state };',
            ['save_memory'], owner, { repo: 'x' },
        );
        expect(result).toMatchObject({
            ok: true,
            result: { a: { value: 1 }, b: 'ToolCallError', s: { repo: 'x' } },
            logs: [{ level: 'log', text: 'hi' }],
            callCount: 1,
        });
        expect(allowed).toHaveBeenCalledOnce();
        expect(other).not.toHaveBeenCalled();
        expect(sdk.service.sendMessage).not.toHaveBeenCalled();
        expect(router.createAggregateQueueFacade().getAll()).toHaveLength(0);
        expect(dispose).toHaveBeenCalledOnce();
    });

    it('never runs nested scripts, even when run_tool_script is allowed', async () => {
        const result = await run('return await tools.run_tool_script({ code: "return 1;" });', ['save_memory', 'run_tool_script']);
        expect(result.ok).toBe(false);
        expect(result.error?.name).toBe('ToolCallError');
    });

    it('denies an allowed tool the owner marked approval-required, without asking', async () => {
        writeRepoPreferences(dataDir, owner.workspaceId, { disabledLlmTools: [], approvalRequiredLlmTools: ['save_memory'] });
        const result = await run('return await tools.save_memory({});');
        expect(result.ok).toBe(false);
        expect(allowed).not.toHaveBeenCalled();
        expect((await store.getProcess(owner.processId))?.pendingAskUser).toBeUndefined();
    });

    it('refuses an owner in another workspace or a missing owner with OwnerScriptUnavailableError', async () => {
        await expect(run('return 1;', ['save_memory'], { ...owner, workspaceId: 'workspace-b' }))
            .rejects.toBeInstanceOf(OwnerScriptUnavailableError);
        await expect(run('return 1;', ['save_memory'], { ...owner, processId: 'missing' }))
            .rejects.toBeInstanceOf(OwnerScriptUnavailableError);
        expect(buildMemoryV2Addon).not.toHaveBeenCalled();
    });
});
