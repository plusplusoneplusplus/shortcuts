import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AIProcess, ProcessStore } from '@plusplusoneplusplus/forge';
import type { ToolScriptRunResult } from '@plusplusoneplusplus/coc-agent-sdk';
import { CanvasMutationService } from '../../../src/server/canvas/canvas-mutation-service';
import { CanvasStore } from '../../../src/server/canvas/canvas-store';
import { createEmptyKustoState, serializeKustoState } from '../../../src/server/canvas/kusto-state';
import type { OwnerScriptRunner } from '../../../src/server/executors/owner-script-runner';

const success: ToolScriptRunResult = { ok: true, result: { success: true, columns: [], rows: [], rowCount: 0, truncated: false },
    logs: [], calls: [], callCount: 1 };

describe('built-in Kusto Run script lifetime', () => {
    let root: string;
    let store: CanvasStore;
    const notify = vi.fn();
    beforeEach(() => {
        vi.clearAllMocks();
        root = mkdtempSync(join(tmpdir(), 'kusto-script-'));
        store = new CanvasStore(root);
    });
    afterEach(() => { vi.useRealTimers(); rmSync(root, { recursive: true, force: true }); });

    function setup(runner: OwnerScriptRunner) {
        const canvas = store.createCanvas({ workspaceId: 'ws', processId: 'chat', title: 'Query', type: 'kusto',
            content: serializeKustoState(createEmptyKustoState({ query: 'print 1', clusterUrl: 'https://c.kusto.windows.net', database: 'DB' })) });
        const owner: AIProcess = { id: 'chat', type: 'chat', status: 'completed', startTime: new Date(),
            promptPreview: 'Kusto', fullPrompt: 'Kusto', metadata: { workspaceId: 'ws' } };
        const getProcess: ProcessStore['getProcess'] = async () => owner;
        const mutations = new CanvasMutationService({ store, notifier: { canvasUpdated: notify },
            processStore: { getProcess }, getKustoEnabled: () => true, getOwnerScriptRunner: () => runner,
            completeFactory: () => async () => ({ ok: false, error: 'No model call permitted' }),
        });
        return { canvas, mutations, owner };
    }

    it('times out once, cancels underlying work and ignores late results without retry', async () => {
        vi.useFakeTimers();
        let finish!: (value: ToolScriptRunResult) => void;
        const runner = vi.fn<OwnerScriptRunner>(() => new Promise(resolve => { finish = resolve; }));
        const { mutations, canvas } = setup(runner);
        const pending = mutations.runKusto('ws', canvas.id, {});
        await vi.waitFor(() => expect(runner).toHaveBeenCalledOnce());
        await vi.advanceTimersByTimeAsync(30_000);
        const result = await pending;
        expect(result.kind).toBe('ok');
        const saved = store.getCanvas('ws', canvas.id)!;
        expect(saved.content).toContain('Tool script timed out');
        expect(saved.revision).toBe(canvas.revision + 1);
        expect(runner.mock.calls[0][0].signal?.aborted).toBe(true);
        finish(success);
        await Promise.resolve();
        expect(store.getCanvas('ws', canvas.id)).toEqual(saved);
        expect(runner).toHaveBeenCalledOnce();
        expect(notify).toHaveBeenCalledOnce();
    });

    it('cancels only this run and does not persist an error or a late success after disconnect', async () => {
        let finish!: (value: ToolScriptRunResult) => void;
        const runner = vi.fn<OwnerScriptRunner>(() => new Promise(resolve => { finish = resolve; }));
        const { mutations, canvas } = setup(runner);
        const controller = new AbortController();
        const pending = mutations.runKusto('ws', canvas.id, {}, controller.signal);
        await vi.waitFor(() => expect(runner).toHaveBeenCalledOnce());
        controller.abort(new Error('Disconnected'));
        expect(await pending).toMatchObject({ kind: 'persist-failed', error: 'Disconnected' });
        expect(runner.mock.calls[0][0].signal?.aborted).toBe(true);
        finish(success);
        await Promise.resolve();
        expect(store.getCanvas('ws', canvas.id)).toEqual(canvas);
        expect(notify).not.toHaveBeenCalled();
        runner.mockResolvedValueOnce(success);
        expect(await mutations.runKusto('ws', canvas.id, {})).toMatchObject({ kind: 'ok' });
    });

    it('cancels every pending run of a retired owner but ignores events from a different workspace', async () => {
        const runner = vi.fn<OwnerScriptRunner>(() => new Promise(() => {}));
        const { mutations, canvas, owner } = setup(runner);
        const first = mutations.runKusto('ws', canvas.id, {});
        const second = mutations.runKusto('ws', canvas.id, {});
        await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(2));
        mutations.onProcessChange({ type: 'process-removed', process: { ...owner, metadata: { workspaceId: 'other' } } });
        mutations.onProcessChange({ type: 'process-updated', process: owner });
        mutations.syncConfig();
        expect(runner.mock.calls.every(([request]) => !request.signal?.aborted)).toBe(true);
        mutations.onProcessChange({ type: 'process-updated', process: { ...owner, archived: true } });
        expect(runner.mock.calls.every(([request]) => request.signal?.aborted)).toBe(true);
        expect(await first).toMatchObject({ kind: 'persist-failed' });
        expect(await second).toMatchObject({ kind: 'persist-failed' });
        expect(store.getCanvas('ws', canvas.id)).toEqual(canvas);
        expect(notify).not.toHaveBeenCalled();
    });

    it('removes request listeners and completed runs before later lifecycle events', async () => {
        const runner = vi.fn<OwnerScriptRunner>(async () => success);
        const { mutations, canvas, owner } = setup(runner);
        const controller = new AbortController();
        const add = vi.spyOn(controller.signal, 'addEventListener');
        const remove = vi.spyOn(controller.signal, 'removeEventListener');
        expect(await mutations.runKusto('ws', canvas.id, {}, controller.signal)).toMatchObject({ kind: 'ok' });
        const callback = add.mock.calls.find(([type]) => type === 'abort')![1];
        expect(remove).toHaveBeenCalledWith('abort', callback);
        const scriptSignal = runner.mock.calls[0][0].signal!;
        mutations.onProcessChange({ type: 'process-removed', process: owner });
        mutations.dispose();
        controller.abort();
        expect(scriptSignal.aborted).toBe(false);
        expect(await mutations.runKusto('ws', canvas.id, {})).toMatchObject({
            kind: 'persist-failed', error: 'Kusto canvas service is closed.',
        });
        expect(runner).toHaveBeenCalledOnce();
        expect(notify).toHaveBeenCalledOnce();
    });

    it('fails closed when shutdown happens during the initial owner read', async () => {
        const runner = vi.fn<OwnerScriptRunner>(async () => success);
        const { mutations, canvas } = setup(runner);
        const pending = mutations.runKusto('ws', canvas.id, {});
        mutations.dispose();
        expect(await pending).toMatchObject({ kind: 'persist-failed' });
        expect(runner).not.toHaveBeenCalled();
        expect(store.getCanvas('ws', canvas.id)).toEqual(canvas);
        expect(notify).not.toHaveBeenCalled();
    });

    it.each([null, { success: true, columns: [], rows: [], rowCount: 2, truncated: false }])(
        'stores a clear error for malformed script output without accepting partial results or retrying', async result => {
            const runner = vi.fn<OwnerScriptRunner>(async () => ({ ...success, result }));
            const { mutations, canvas } = setup(runner);
            const run = await mutations.runKusto('ws', canvas.id, {});
            expect(run).toMatchObject({ kind: 'ok', canvas: { revision: canvas.revision + 1 } });
            expect(store.getCanvas('ws', canvas.id)!.content).toContain('Invalid Kusto query tool result');
            expect(runner).toHaveBeenCalledOnce();
            // One notification announces the stored error, never a separate execution write.
            expect(notify).toHaveBeenCalledOnce();
        },
    );
});
