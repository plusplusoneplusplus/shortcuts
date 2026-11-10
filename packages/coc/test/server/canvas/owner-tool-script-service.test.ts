import { describe, expect, it, vi } from 'vitest';
import { runOwnerToolScript } from '../../../src/server/canvas/owner-tool-script-service';
import { OwnerScriptUnavailableError } from '../../../src/server/executors/owner-script-runner';
import type { ToolScriptRunResult } from '@plusplusoneplusplus/coc-agent-sdk';

const success = { ok: true, result: { count: 1 }, logs: [{ level: 'log', text: 'hi' }], callCount: 1 } as ToolScriptRunResult;
function setup() {
    const controller = new AbortController();
    const runner = vi.fn(async () => success);
    const options = { workspaceId: 'workspace-a', processId: 'chat-a', tools: ['execute_kusto_query'],
        request: { code: 'return 1;', state: { x: 1 } }, runner, signal: controller.signal };
    return { options, runner, controller };
}

describe('bounded internal owner tool script service', () => {
    it('narrows tools and excludes MCP while preserving structured results and logs', async () => {
        const { options, runner } = setup();
        expect(await runOwnerToolScript(options)).toEqual({ ok: true, result: { count: 1 }, logs: ['hi'], callCount: 1 });
        expect(runner).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'workspace-a', processId: 'chat-a',
            code: 'return 1;', state: { x: 1 }, allowTools: ['execute_kusto_query'], includeMcpTools: false, signal: expect.any(AbortSignal) });
    });

    it('rejects command and nested-script declarations without dispatch', async () => {
        const { options, runner } = setup();
        for (const name of ['execute_kusto_command', 'run_tool_script', 'save_memory', 'mcp_call']) {
            expect(await runOwnerToolScript({ ...options, tools: [name] })).toMatchObject({ ok: false, code: 'tool-not-allowed' });
        }
        expect(runner).not.toHaveBeenCalled();
    });

    it('does not let alternate request fields replace the bound owner or permissions', async () => {
        const { options, runner } = setup();
        await runOwnerToolScript({ ...options, request: { ...options.request, workspaceId: 'forged', processId: 'other',
            allowTools: ['execute_kusto_command'], includeMcpTools: true } as typeof options.request });
        expect(runner.mock.calls[0][0]).toMatchObject({ workspaceId: 'workspace-a', processId: 'chat-a',
            allowTools: ['execute_kusto_query'], includeMcpTools: false });
    });

    it.each(['result', 'logs'])('caps the complete envelope including %s without partial success', async field => {
        const { options, runner } = setup();
        runner.mockResolvedValueOnce({ ...success, ...(field === 'result' ? { result: '界'.repeat(100) }
            : { logs: [{ level: 'log', text: '界'.repeat(100) }] }) } as ToolScriptRunResult);
        expect(await runOwnerToolScript({ ...options, maxResultBytes: 200 })).toEqual({ ok: false, code: 'result-limit',
            error: 'Tool script result exceeds the serialized byte limit', logs: [], callCount: 0 });
    });

    it('rejects unserializable output and reports runner failures clearly', async () => {
        const { options, runner } = setup();
        runner.mockResolvedValueOnce({ ...success, result: BigInt(1) } as unknown as ToolScriptRunResult);
        expect(await runOwnerToolScript(options)).toMatchObject({ ok: false, code: 'script-error' });
        runner.mockRejectedValueOnce(new OwnerScriptUnavailableError());
        expect(await runOwnerToolScript(options)).toMatchObject({ ok: false, code: 'no-owner' });
        runner.mockRejectedValueOnce(new Error('Query failed'));
        expect(await runOwnerToolScript(options)).toMatchObject({ ok: false, code: 'script-error', error: 'Query failed' });
        runner.mockResolvedValueOnce({ ok: false, error: { message: 'Denied' }, logs: [], callCount: 0 } as ToolScriptRunResult);
        expect(await runOwnerToolScript(options)).toMatchObject({ ok: false, code: 'script-error', error: 'Denied' });
    });

    it('honors pre-cancellation without dispatch and removes listeners', async () => {
        const { options, runner, controller } = setup();
        const remove = vi.spyOn(controller.signal, 'removeEventListener');
        controller.abort();
        expect(await runOwnerToolScript(options)).toMatchObject({ ok: false, code: 'aborted' });
        expect(runner).not.toHaveBeenCalled();
        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it('times out uncooperative work once, aborts its signal and observes late failures', async () => {
        const { options } = setup();
        let signal: AbortSignal | undefined;
        let rejectLate!: (error: Error) => void;
        const runner = vi.fn(request => {
            signal = request.signal;
            return new Promise<ToolScriptRunResult>((_, reject) => { rejectLate = reject; });
        });
        expect(await runOwnerToolScript({ ...options, runner, timeoutMs: 20 })).toMatchObject({ ok: false, code: 'timeout' });
        expect(signal?.aborted).toBe(true);
        expect(runner).toHaveBeenCalledTimes(1);
        rejectLate(new Error('Late query rejection'));
        await Promise.resolve();
    });

    it('rejects a late success after cancellation', async () => {
        const { options, controller } = setup();
        let finish!: (result: ToolScriptRunResult) => void;
        const pending = runOwnerToolScript({ ...options, runner: () => new Promise(resolve => { finish = resolve; }) });
        controller.abort();
        finish(success);
        expect(await pending).toMatchObject({ ok: false, code: 'aborted' });
    });
});
