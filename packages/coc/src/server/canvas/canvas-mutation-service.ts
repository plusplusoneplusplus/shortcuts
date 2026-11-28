import type { CanvasEdit, CanvasRecord } from './canvas-store';
import { CanvasStore } from './canvas-store';
import type { CanvasUpdateNotifier } from './canvas-update-notifier';
import { runKustoCanvas } from '../kusto/kusto-service';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { OwnerScriptRunner } from '../executors/owner-script-runner';
import { runOwnerToolScript } from './owner-tool-script-service';
import { readKustoQueryToolResult } from '../kusto/kusto-query-tool-result';

/** A user save: 200, 404, 409 with the current record, or 400. */
export type CanvasSaveOutcome =
    | { kind: 'ok'; canvas: CanvasRecord }
    | { kind: 'not-found' }
    | { kind: 'revision-conflict'; currentRevision: number | undefined; canvas: CanvasRecord | null }
    | { kind: 'invalid'; error: string };

/** A Kusto run: 200, 404, 400, 409, or 500. */
export type CanvasKustoRunOutcome =
    | { kind: 'ok'; canvas: CanvasRecord }
    | { kind: 'not-found' }
    | { kind: 'wrong-type' }
    | { kind: 'revision-conflict'; currentRevision: number; canvas: CanvasRecord | null }
    | { kind: 'persist-failed'; error: string };

export interface CanvasSaveInput {
    content?: string;
    edits?: CanvasEdit[];
    expectedRevision?: number;
    title?: string;
}

export interface CanvasKustoCreateInput {
    title: string;
    content: string;
    processId?: string;
}

export interface CanvasMutationServiceDeps {
    store: CanvasStore;
    notifier: CanvasUpdateNotifier;
    /** Built-in Run uses the same internal runner as extension scripts, without extension identity. */
    getOwnerScriptRunner?: () => OwnerScriptRunner | undefined;
    processStore?: Pick<ProcessStore, 'getProcess'>;
    getKustoEnabled?: () => boolean;
}

export class CanvasMutationService {
    private readonly store: CanvasStore;
    private readonly notifier: CanvasUpdateNotifier;
    private readonly deps: CanvasMutationServiceDeps;

    private readonly kustoRuns = new Set<{ canvas?: CanvasRecord; controller: AbortController }>();
    private disposed = false;

    constructor(deps: CanvasMutationServiceDeps) {
        this.store = deps.store;
        this.notifier = deps.notifier;
        this.deps = deps;
    }

    /** Manual Kusto canvas creation (AC-07). Always succeeds or throws. */
    createKustoCanvas(workspaceId: string, input: CanvasKustoCreateInput): CanvasRecord {
        const canvas = this.store.createCanvas({
            workspaceId,
            type: 'kusto',
            title: input.title,
            content: input.content,
            ...(input.processId ? { processId: input.processId } : {}),
            editor: 'user',
        });
        this.notifier.canvasUpdated(workspaceId, canvas, 'user');
        return canvas;
    }

    /** A revision-checked user save from the canvas panel. */
    saveCanvas(workspaceId: string, canvasId: string, input: CanvasSaveInput): CanvasSaveOutcome {
        if (this.store.getCanvas(workspaceId, canvasId)?.type === 'copilot-extension') return { kind: 'invalid', error: 'Runtime canvas identity is read-only' };
        const result = this.store.updateCanvas(workspaceId, canvasId, {
            content: input.content,
            edits: input.edits,
            expectedRevision: input.expectedRevision,
            title: input.title,
            editor: 'user',
        });

        if (!result.ok) {
            if (result.reason === 'not-found') return { kind: 'not-found' };
            if (result.reason === 'revision-conflict') {
                return {
                    kind: 'revision-conflict',
                    currentRevision: result.currentRevision,
                    canvas: this.store.getCanvas(workspaceId, canvasId) ?? null,
                };
            }
            return { kind: 'invalid', error: result.error };
        }

        this.notifier.canvasUpdated(workspaceId, result.canvas, 'user');
        return { kind: 'ok', canvas: result.canvas };
    }

    /** Run a Kusto canvas's query server-side and persist the result (AC-02). */
    async runKusto(
        workspaceId: string,
        canvasId: string,
        overrides: { query?: string; clusterUrl?: string; database?: string },
        requestSignal: AbortSignal = new AbortController().signal,
    ): Promise<CanvasKustoRunOutcome> {
        const controller = new AbortController();
        const cancel = () => controller.abort(requestSignal.reason);
        requestSignal.addEventListener('abort', cancel, { once: true });
        if (requestSignal.aborted) cancel();
        const { signal } = controller;
        const pending: { canvas?: CanvasRecord; controller: AbortController } = { controller };
        this.kustoRuns.add(pending);
        try {
            const outcome = await runKustoCanvas(this.store, workspaceId, canvasId, {
                overrides,
                editor: 'user',
                executeQuery: async (params, canvas) => {
                    pending.canvas = canvas;
                    await this.assertKustoOwner(canvas, signal);
                    const runner = this.deps.getOwnerScriptRunner?.();
                    if (!runner) throw new Error('Kusto tool script runtime is unavailable');
                    const run = await runOwnerToolScript({
                        workspaceId: canvas.workspaceId, processId: canvas.processId!,
                        tools: ['execute_kusto_query'], runner, signal,
                        // Inputs are data, never interpolated script source or caller-supplied code.
                        request: { code: 'return await tools.execute_kusto_query(state);', state: params },
                    });
                    if (!run.ok) throw new Error(run.error ?? 'Kusto tool script failed');
                    return readKustoQueryToolResult(run.result);
                },
                beforePersist: canvas => this.assertKustoOwner(canvas, signal),
            });

            if (!outcome.ok) {
                if (outcome.reason === 'not-found') return { kind: 'not-found' };
                if (outcome.reason === 'wrong-type') return { kind: 'wrong-type' };
                if (outcome.reason === 'revision-conflict') {
                    return {
                        kind: 'revision-conflict', currentRevision: outcome.currentRevision,
                        canvas: this.store.getCanvas(workspaceId, canvasId),
                    };
                }
                return { kind: 'persist-failed', error: outcome.error };
            }

            this.notifier.canvasUpdated(workspaceId, outcome.canvas, 'user');
            return { kind: 'ok', canvas: outcome.canvas };
        } finally {
            this.kustoRuns.delete(pending);
            requestSignal.removeEventListener('abort', cancel);
        }
    }

    /** Composed through the server's existing lifecycle fanout, never replacing store callbacks. */
    onProcessChange(event: Parameters<NonNullable<ProcessStore['onProcessChange']>>[0]): void {
        for (const run of this.kustoRuns) {
            const canvas = run.canvas;
            if (!canvas) continue;
            if (event.type === 'processes-cleared') {
                // Clear may target just one workspace. Recheck each owner rather than cancelling survivors.
                void this.assertKustoOwner(canvas, run.controller.signal).catch(error => run.controller.abort(error));
            } else if (event.process && event.process.id === canvas.processId
                && event.process.metadata?.workspaceId === canvas.workspaceId
                && (event.type === 'process-removed' || event.process.archived)) {
                run.controller.abort(new Error('Kusto canvas owner chat is unavailable.'));
            }
        }
    }

    syncConfig(): void {
        if (!this.deps.getKustoEnabled?.()) this.abortKustoRuns('Kusto is disabled on the server host.');
    }

    dispose(): void {
        this.disposed = true;
        this.abortKustoRuns('Kusto canvas service is closed.');
    }

    private abortKustoRuns(message: string): void {
        for (const run of this.kustoRuns) run.controller.abort(new Error(message));
    }

    /** Recheck after execution too: retired owners and disconnected callers cannot write late results. */
    private async assertKustoOwner(canvas: CanvasRecord, signal: AbortSignal): Promise<void> {
        signal.throwIfAborted();
        if (this.disposed) throw new Error('Kusto canvas service is closed.');
        if (!this.deps.getKustoEnabled?.()) throw new Error('Kusto is disabled on the server host.');
        const owner = canvas.processId
            ? await this.deps.processStore?.getProcess(canvas.processId, canvas.workspaceId)
            : undefined;
        signal.throwIfAborted();
        if (this.disposed) throw new Error('Kusto canvas service is closed.');
        if (!this.deps.getKustoEnabled?.()) throw new Error('Kusto is disabled on the server host.');
        if (!owner || owner.id !== canvas.processId || owner.type !== 'chat' || owner.archived
            || owner.metadata?.workspaceId !== canvas.workspaceId) {
            throw new Error('Kusto canvas owner chat is unavailable; open a canvas linked to a live conversation.');
        }
    }
}
