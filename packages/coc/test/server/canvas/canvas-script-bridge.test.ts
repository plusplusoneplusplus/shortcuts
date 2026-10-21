import { describe, it, expect, vi } from 'vitest';
import { CocToolRuntime, defineTool, runToolScript } from '@plusplusoneplusplus/coc-agent-sdk';
import {
    createCanvasRunScriptFactory,
    isCanvasToolScriptsEnabled,
    MAX_HOST_SCRIPT_RESULT_BYTES,
    type CanvasToolScriptFlags,
} from '../../../src/server/canvas/canvas-script-bridge';
import {
    OwnerScriptUnavailableError,
    type OwnerScriptRequest,
    type OwnerScriptRunner,
} from '../../../src/server/executors/owner-script-runner';
import { createMockPrTool } from '../../fixtures/canvas/pr-dashboard/mock-pr-data';

const ON: CanvasToolScriptFlags = { canvasHostApis: true, toolScripting: true, canvasToolScripts: true };
const ATTRIBUTION = {
    workspaceId: 'ws-1',
    canvasId: 'pr-board',
    capability: 'refresh',
    processId: 'owner-chat',
    tools: ['query_pull_request'],
};

/**
 * The owner tool set without chat-context assembly: the mock PR tool plus one
 * extra tool the manifest never declares, filtered by `allowTools`, run through
 * the real script engine.
 */
function fakeOwner() {
    const pr = createMockPrTool();
    const extra = vi.fn(async () => 'should not run');
    const requests: OwnerScriptRequest[] = [];
    const runner: OwnerScriptRunner = async request => {
        requests.push(request);
        const tools = [pr.tool, defineTool('extra_tool', { handler: extra })]
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
    return { pr, extra, requests, runner };
}

function factory(opts: { flags?: CanvasToolScriptFlags; runner?: OwnerScriptRunner; maxResultBytes?: number } = {}) {
    const log = vi.fn();
    const make = createCanvasRunScriptFactory({
        getFeatures: () => opts.flags ?? ON,
        getOwnerScriptRunner: () => opts.runner,
        ...(opts.maxResultBytes ? { maxResultBytes: opts.maxResultBytes } : {}),
        log,
    });
    return { make, log };
}

const signal = () => new AbortController().signal;

describe('isCanvasToolScriptsEnabled', () => {
    it('needs all three flags', () => {
        expect(isCanvasToolScriptsEnabled(ON)).toBe(true);
        expect(isCanvasToolScriptsEnabled({ ...ON, canvasHostApis: false })).toBe(false);
        expect(isCanvasToolScriptsEnabled({ ...ON, toolScripting: false })).toBe(false);
        expect(isCanvasToolScriptsEnabled({ ...ON, canvasToolScripts: false })).toBe(false);
        expect(isCanvasToolScriptsEnabled(undefined)).toBe(false);
    });
});

describe('createCanvasRunScriptFactory', () => {
    it('defaults the result cap to 16 MiB', () => {
        expect(MAX_HOST_SCRIPT_RESULT_BYTES).toBe(16 * 1024 * 1024);
    });

    it.each([
        ['canvasHostApis', { ...ON, canvasHostApis: false }],
        ['toolScripting', { ...ON, toolScripting: false }],
        ['canvasToolScripts', { ...ON, canvasToolScripts: false }],
    ])("rejects 'disabled' with %s off and never reaches the owner", async (_flag, flags) => {
        const owner = fakeOwner();
        const { make } = factory({ flags, runner: owner.runner });
        const outcome = await make(ATTRIBUTION)({ code: 'return 1;' }, signal());
        expect(outcome).toMatchObject({ ok: false, code: 'disabled' });
        expect(owner.requests).toHaveLength(0);
    });

    it("rejects 'disabled' when no owner runner is wired", async () => {
        const { make } = factory();
        expect(await make(ATTRIBUTION)({ code: 'return 1;' }, signal())).toMatchObject({ ok: false, code: 'disabled' });
    });

    it("rejects 'no-owner' for a canvas without a processId", async () => {
        const owner = fakeOwner();
        const { make } = factory({ runner: owner.runner });
        const { processId: _omit, ...unowned } = ATTRIBUTION;
        expect(await make(unowned)({ code: 'return 1;' }, signal())).toMatchObject({ ok: false, code: 'no-owner' });
        expect(owner.requests).toHaveLength(0);
    });

    it("maps an owner in another workspace (runner refuses) to 'no-owner'", async () => {
        const { make } = factory({ runner: async () => { throw new OwnerScriptUnavailableError('Script owner chat is not in this workspace'); } });
        expect(await make(ATTRIBUTION)({ code: 'return 1;' }, signal())).toMatchObject({
            ok: false, code: 'no-owner', error: 'Script owner chat is not in this workspace',
        });
    });

    it('runs as the canvas owner and returns result, logs and call count', async () => {
        const owner = fakeOwner();
        const { make } = factory({ runner: owner.runner });
        const outcome = await make(ATTRIBUTION)({
            code: 'console.log("go"); const r = await tools.query_pull_request({ provider: state.provider, repository: state.repository }); return r.items.length;',
            state: { provider: 'github', repository: 'octo/demo' },
        }, signal());

        expect(outcome).toEqual({ ok: true, result: 7, logs: ['go'], callCount: 1 });
        expect(owner.requests[0]).toMatchObject({ workspaceId: 'ws-1', processId: 'owner-chat' });
        expect(owner.pr.calls).toEqual([{ provider: 'github', repository: 'octo/demo' }]);
    });

    it('limits the script to manifest tools ∩ owner tools — others throw ToolCallError and never run', async () => {
        const owner = fakeOwner();
        const { make } = factory({ runner: owner.runner });
        const outcome = await make({ ...ATTRIBUTION, tools: ['query_pull_request', 'run_tool_script'] })({
            code: 'try { await tools.extra_tool({}); return "ran"; } catch (e) { return { name: e.name, code: e.code }; }',
        }, signal());

        expect(outcome).toMatchObject({ ok: true, result: { name: 'ToolCallError', code: 'UNKNOWN_TOOL' } });
        expect(owner.extra).not.toHaveBeenCalled();
        // Neither undeclared nor non-read-only names (run_tool_script) reach the owner.
        expect(owner.requests[0].allowTools).toEqual(['query_pull_request']);
    });

    it('cannot nest scripts', async () => {
        const owner = fakeOwner();
        const { make } = factory({ runner: owner.runner });
        const outcome = await make(ATTRIBUTION)({
            code: 'try { await tools.run_tool_script({ code: "return 1" }); return "nested"; } catch (e) { return e.name; }',
        }, signal());
        expect(outcome).toMatchObject({ ok: true, result: 'ToolCallError' });
    });

    it("maps a script that throws to 'script-error'", async () => {
        const owner = fakeOwner();
        const { make } = factory({ runner: owner.runner });
        const outcome = await make(ATTRIBUTION)({ code: 'throw new Error("boom");' }, signal());
        expect(outcome).toMatchObject({ ok: false, code: 'script-error', error: expect.stringContaining('boom') });
    });

    it("rejects a result over the cap with 'script-error'", async () => {
        const owner = fakeOwner();
        const { make } = factory({ runner: owner.runner, maxResultBytes: 64 });
        const outcome = await make(ATTRIBUTION)({ code: 'return "x".repeat(100);' }, signal());
        expect(outcome).toMatchObject({ ok: false, code: 'script-error', error: expect.stringContaining('64 byte limit') });
    });

    it("reports 'timeout' when the run budget aborts the script, and 'aborted' for any other end", async () => {
        const owner = fakeOwner();
        const { make } = factory({ runner: owner.runner });
        const code = 'await new Promise(() => {});';

        const budget = new AbortController();
        const timedOut = make(ATTRIBUTION)({ code }, budget.signal);
        setTimeout(() => budget.abort({ code: 'timeout' }), 50);
        expect(await timedOut).toMatchObject({ ok: false, code: 'timeout' });

        const ended = new AbortController();
        const aborted = make(ATTRIBUTION)({ code }, ended.signal);
        setTimeout(() => ended.abort({ code: 'aborted' }), 50);
        expect(await aborted).toMatchObject({ ok: false, code: 'aborted' });
    });

    it('logs ids, counts and outcome — never the code, state or result', async () => {
        const owner = fakeOwner();
        const { make, log } = factory({ runner: owner.runner });
        await make(ATTRIBUTION)({
            code: 'return { secretResult: (await tools.query_pull_request({ repository: state.secretRepo })).items.length };',
            state: { secretRepo: 'secret/state-value' },
        }, signal());

        expect(log).toHaveBeenCalledTimes(1);
        const line = log.mock.calls[0][0] as string;
        expect(line).toMatch(/^\[canvas runScript\] workspace=ws-1 canvas=pr-board capability=refresh process=owner-chat calls=1 outcome=ok durationMs=\d+$/);
        expect(line).not.toContain('secretResult');
        expect(line).not.toContain('secret/state-value');
        expect(line).not.toContain('query_pull_request');
    });
});
