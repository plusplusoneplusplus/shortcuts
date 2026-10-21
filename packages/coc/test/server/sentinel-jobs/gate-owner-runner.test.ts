import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CocToolRuntime, defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import { runJobGateWithOwnerTools, type JobGateOwnerTools } from '../../../src/server/sentinel-jobs/job-gate-owner-runner';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import { buildMemoryV2Addon } from '../../../src/server/executors/memory-v2-addon';

vi.mock('../../../src/server/executors/memory-v2-addon', () => ({ buildMemoryV2Addon: vi.fn() }));

describe('runJobGateWithOwnerTools', () => {
    let dataDir: string;
    let ownerTools: JobGateOwnerTools;
    const dispose = vi.fn();
    const handler = vi.fn(async () => JSON.stringify({ value: 7 }));

    beforeEach(() => {
        vi.clearAllMocks();
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'script-owner-tools-'));
        writeRepoPreferences(dataDir, 'workspace-a', { disabledLlmTools: [] });
        ownerTools = { dataDir, workspaceId: 'workspace-a', processId: 'sentinel-a', store: {} as never };
        vi.mocked(buildMemoryV2Addon).mockResolvedValue({
            tools: [defineTool('owner_tool', { handler }), defineTool('save_memory', { handler })],
            suffix: '', excludedBuiltinTools: [], dispose,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('uses the full resolved CoC list and owner-qualified memory context', async () => {
        // Unregistered owner_tool is excluded by the ordinary chat script adapter.
        const runtimeDispose = vi.spyOn(CocToolRuntime.prototype, 'dispose');
        await expect(runJobGateWithOwnerTools({
            ownerTools, state: { previous: 2 },
            code: 'return { state, result: await tools.owner_tool({ number: 42 }) };',
        })).resolves.toEqual({ state: { previous: 2 }, result: { value: 7 } });
        expect(handler).toHaveBeenCalledWith({ number: 42 }, expect.objectContaining({
            toolCallId: expect.any(String), signal: expect.any(AbortSignal),
        }));
        expect(buildMemoryV2Addon).toHaveBeenCalledWith(dataDir, 'workspace-a', undefined, 'sentinel-a');
        expect(runtimeDispose).toHaveBeenCalledOnce();
        expect(dispose).toHaveBeenCalledOnce();
    });

    it('turns gated tools into catchable errors without creating approval questions', async () => {
        writeRepoPreferences(dataDir, 'workspace-a', {
            disabledLlmTools: [], approvalRequiredLlmTools: ['save_memory'],
        });
        const emitQuestions = vi.fn();
        // Extra runtime properties cannot supply approval wiring to this path.
        const extra = { ...ownerTools, askUser: { enabled: true, deps: { emitQuestions } } };
        await expect(runJobGateWithOwnerTools({
            ownerTools: extra, state: null,
            code: 'try { await tools.save_memory({}); } catch (e) { return { name: e.name, code: e.code }; }',
        })).resolves.toEqual({ name: 'ToolCallError', code: 'TOOL_ERROR' });
        expect(handler).not.toHaveBeenCalled();
        expect(emitQuestions).not.toHaveBeenCalled();
        expect(dispose).toHaveBeenCalledOnce();
    });

    it('does not expose ask_user', async () => {
        await expect(runJobGateWithOwnerTools({
            ownerTools, state: null, code: 'return await tools.ask_user({ questions: [] });',
        })).rejects.toMatchObject({ name: 'ToolCallError' });
        expect(dispose).toHaveBeenCalledOnce();
    });

    it('retains enabled tools marked non-scriptable for ordinary chat scripts', async () => {
        ownerTools.followUpSuggestions = { enabled: true, count: 3 };
        await expect(runJobGateWithOwnerTools({
            ownerTools, state: null,
            code: 'return await tools.suggest_follow_ups({ suggestions: ["Read", "Check", "Wait"] });',
        })).resolves.toEqual({ suggestions: ['Read', 'Check', 'Wait'] });
    });

    it('admits nesting through an enabled and ungated owner script tool', async () => {
        await expect(runJobGateWithOwnerTools({
            ownerTools, state: null,
            code: `return await tools.run_tool_script({ code: 'return await tools.owner_tool({});' });`,
        })).resolves.toMatchObject({ result: { value: 7 } });
        expect(handler).toHaveBeenCalledOnce();
    });

    it.each(['disabled', 'gated', 'excluded', 'provider-excluded'])('denies %s nesting before child side effects', async policy => {
        writeRepoPreferences(dataDir, 'workspace-a', {
            disabledLlmTools: policy === 'disabled' ? ['run_tool_script'] : [],
            approvalRequiredLlmTools: policy === 'gated' ? ['run_tool_script'] : [],
        });
        if (policy === 'excluded') ownerTools.excludeTools = ['run_tool_script'];
        if (policy === 'provider-excluded') ownerTools.includeToolScripting = false;
        await expect(runJobGateWithOwnerTools({
            ownerTools, state: null,
            code: `return await tools.run_tool_script({ code: 'return await tools.owner_tool({});' });`,
        })).rejects.toMatchObject({ name: 'ToolCallError', message: expect.stringContaining('denied') });
        expect(handler).not.toHaveBeenCalled();
        expect(dispose).toHaveBeenCalledOnce();
    });

    it('keeps nested child calls behind the same approval policy', async () => {
        writeRepoPreferences(dataDir, 'workspace-a', {
            disabledLlmTools: [], approvalRequiredLlmTools: ['save_memory'],
        });
        await expect(runJobGateWithOwnerTools({
            ownerTools, state: null,
            code: `return await tools.run_tool_script({ code: 'return await tools.save_memory({});' });`,
        })).rejects.toMatchObject({ name: 'ToolCallError' });
        expect(handler).not.toHaveBeenCalled();
        expect(dispose).toHaveBeenCalledOnce();
    });

    it('isolates preferences between owners in different workspaces', async () => {
        writeRepoPreferences(dataDir, 'workspace-a', { disabledLlmTools: ['save_memory', 'run_tool_script'] });
        writeRepoPreferences(dataDir, 'workspace-b', { disabledLlmTools: [] });
        await expect(runJobGateWithOwnerTools({
            ownerTools, state: null, code: 'return await tools.save_memory({});',
        })).rejects.toMatchObject({ name: 'ToolCallError' });
        await expect(runJobGateWithOwnerTools({
            ownerTools: { ...ownerTools, workspaceId: 'workspace-b', processId: 'sentinel-b' },
            state: null, code: 'return await tools.save_memory({});',
        })).resolves.toEqual({ value: 7 });
        expect(buildMemoryV2Addon).toHaveBeenLastCalledWith(dataDir, 'workspace-b', undefined, 'sentinel-b');
        expect(handler).toHaveBeenCalledOnce();
        expect(dispose).toHaveBeenCalledTimes(2);
    });

    it('disposes context and runtime after a script error', async () => {
        const runtimeDispose = vi.spyOn(CocToolRuntime.prototype, 'dispose');
        await expect(runJobGateWithOwnerTools({
            ownerTools, state: null, code: 'throw new Error("failed script");',
        })).rejects.toThrow('failed script');
        expect(runtimeDispose).toHaveBeenCalledOnce();
        expect(dispose).toHaveBeenCalledOnce();
    });

    it('rejects pre-aborted runs before resolving resources', async () => {
        const controller = new AbortController();
        controller.abort(new Error('rule removed'));
        await expect(runJobGateWithOwnerTools({
            ownerTools, state: null, code: 'return 1;', signal: controller.signal,
        })).rejects.toThrow('rule removed');
        expect(buildMemoryV2Addon).not.toHaveBeenCalled();
    });

    it('disposes a context resolved after cancellation without starting the script', async () => {
        const controller = new AbortController();
        vi.mocked(buildMemoryV2Addon).mockImplementationOnce(async () => {
            controller.abort(new Error('owner revoked'));
            return { tools: [], suffix: '', excludedBuiltinTools: [], dispose };
        });
        await expect(runJobGateWithOwnerTools({
            ownerTools, state: null, code: 'return await tools.owner_tool({});', signal: controller.signal,
        })).rejects.toThrow('owner revoked');
        expect(handler).not.toHaveBeenCalled();
        expect(dispose).toHaveBeenCalledOnce();
    });

    it('cancels in-flight handler work and disposes both resources on revocation', async () => {
        const controller = new AbortController();
        let toolSignal: AbortSignal | undefined;
        const started = Promise.withResolvers<void>();
        handler.mockImplementationOnce((_args?: unknown, invocation?: { signal?: AbortSignal }) => {
            toolSignal = invocation?.signal;
            started.resolve();
            return new Promise((_resolve, reject) => toolSignal!.addEventListener('abort',
                () => reject(toolSignal!.reason), { once: true }));
        });
        const runtimeDispose = vi.spyOn(CocToolRuntime.prototype, 'dispose');
        const run = runJobGateWithOwnerTools({
            ownerTools, state: null, code: 'return await tools.owner_tool({});', signal: controller.signal,
        });
        const assertion = expect(run).rejects.toThrow('rule edited');
        await started.promise;
        controller.abort(new Error('rule edited'));
        await assertion;
        expect(toolSignal?.aborted).toBe(true);
        expect(runtimeDispose).toHaveBeenCalledOnce();
        expect(dispose).toHaveBeenCalledOnce();
    });
});
