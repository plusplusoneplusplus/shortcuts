/**
 * CanvasMutationService — every write to a canvas, behind one typed contract.
 *
 * The four ways a canvas changes (a user save, a capability invocation, a Kusto
 * run, a manual Kusto create) each used to be written inline in
 * `canvas-routes.ts`, mixed in with body parsing and HTTP status selection. That
 * is how the notification drift got in: one of the four emitted its own
 * WebSocket event instead of calling the shared fanout, and nothing could notice.
 *
 * Here every mutation returns a typed outcome and — on success and only on
 * success — notifies exactly once through `CanvasUpdateNotifier`. Routes are
 * left with what they are actually for: validating the request and mapping an
 * outcome to a status code. Adding a fifth mutation means adding a method here,
 * which cannot forget to notify.
 *
 * The outcome unions deliberately mirror the statuses the routes already
 * returned, so the HTTP surface is unchanged by the extraction.
 */

import { CanvasStore } from './canvas-store';
import type { CanvasEdit, CanvasRecord, CanvasExtensionManifest } from './canvas-store';
import type { CanvasUpdateNotifier } from './canvas-update-notifier';
import { runCanvasCapability } from './canvas-capability-runner';
import type { CapabilityCompleteFn, RunCanvasCapabilityOptions } from './canvas-capability-runner';
import type { CanvasRunScriptFactory } from './canvas-script-bridge';
import { queueCanvasCapabilityRun } from './canvas-capability-queue';
import { runKustoCanvas } from '../kusto/kusto-service';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { OwnerScriptRunner } from '../executors/owner-script-runner';
import { runOwnerToolScript } from './owner-tool-script-service';
import { readKustoQueryToolResult } from '../kusto/kusto-query-tool-result';

/** Who `host.complete` bills a capability's model call to. */
export interface CapabilityAttribution {
    workspaceId: string;
    canvasId: string;
    capability: string;
    processId?: string;
}

/** A user save: 200, 404, 409 with the current record, or 400. */
export type CanvasSaveOutcome =
    | { kind: 'ok'; canvas: CanvasRecord }
    | { kind: 'not-found' }
    | { kind: 'revision-conflict'; currentRevision: number | undefined; canvas: CanvasRecord | null }
    | { kind: 'invalid'; error: string };

/** A capability run: 200, 404 (gone/flag-disabled), 422, or 409. */
export type CanvasCapabilityOutcome =
    | { kind: 'ok'; canvas: CanvasRecord }
    | { kind: 'gone' }
    | { kind: 'disabled' }
    | { kind: 'run-error'; error: string }
    | { kind: 'conflict'; canvas: CanvasRecord | null };

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
    /**
     * Live gate for the canvas host APIs — async capabilities and the
     * `host.complete` they get access to. When it returns false an invocation of
     * a capability declared `async: true` is `disabled` (404), exactly as if the
     * feature had never been built. Sync capabilities are untouched by it.
     */
    getCanvasHostApisEnabled?: () => boolean;
    /** Builds the `host.complete` a given async capability run gets. */
    completeFactory: (attribution: CapabilityAttribution) => CapabilityCompleteFn;
    /** Builds the `host.runScript` a given async capability run gets. Absent → `disabled`. */
    runScriptFactory?: CanvasRunScriptFactory;
    /** Built-in Run uses the same internal runner as extension scripts, without extension identity. */
    getOwnerScriptRunner?: () => OwnerScriptRunner | undefined;
    processStore?: Pick<ProcessStore, 'getProcess'>;
    getKustoEnabled?: () => boolean;
}

/**
 * Whether the manifest declares this capability async. A manifest with no
 * matching entry — or none at all, which every extension written before
 * capability metadata was required looks like — is sync, the legacy path.
 */
export function isAsyncCapability(manifest: CanvasExtensionManifest | undefined, capability: string): boolean {
    return manifest?.capabilities?.some(meta => meta?.name === capability && meta.async === true) === true;
}

/**
 * Run options for one capability invocation: `undefined` (the sync path) unless
 * the manifest declares it async, in which case the run gets `host.complete`,
 * `host.runScript` and `host.tools`, all attributed to the canvas's owner chat.
 * Shared by the REST/UI path and the `extension_canvas` run path.
 */
export function buildCapabilityRunOptions(input: {
    manifest: CanvasExtensionManifest | undefined;
    attribution: CapabilityAttribution;
    completeFactory: (attribution: CapabilityAttribution) => CapabilityCompleteFn;
    runScriptFactory?: CanvasRunScriptFactory;
}): RunCanvasCapabilityOptions | undefined {
    if (!isAsyncCapability(input.manifest, input.attribution.capability)) return undefined;
    const tools = input.manifest?.tools ?? [];
    return {
        async: true,
        complete: input.completeFactory(input.attribution),
        ...(input.runScriptFactory ? { runScript: input.runScriptFactory({ ...input.attribution, tools }) } : {}),
        tools,
    };
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

    /**
     * Run a declared capability against the canvas's shared state.
     *
     * SERIALIZED PER CANVAS, and the canvas is re-read INSIDE the critical
     * section: the read-modify-write races rarely at the sync path's 1 s budget
     * and reliably at the async path's 30 s, and the re-read is what makes run
     * N+1 start from run N's output instead of losing to its revision check.
     */
    async invokeCapability(
        workspaceId: string,
        canvasId: string,
        capability: string,
        params: unknown,
    ): Promise<CanvasCapabilityOutcome> {
        const outcome = await queueCanvasCapabilityRun(workspaceId, canvasId, async (): Promise<CanvasCapabilityOutcome> => {
            const fresh = this.store.getCanvas(workspaceId, canvasId);
            const freshExtension = this.store.getExtension(workspaceId, canvasId);
            if (!fresh || fresh.type !== 'extension' || !freshExtension) {
                return { kind: 'gone' };
            }
            const isAsync = isAsyncCapability(freshExtension.manifest, capability);
            if (isAsync && !this.deps.getCanvasHostApisEnabled?.()) {
                return { kind: 'disabled' };
            }

            const run = await runCanvasCapability(
                freshExtension.capabilitiesJs,
                capability,
                fresh.content,
                params,
                buildCapabilityRunOptions({
                    manifest: freshExtension.manifest,
                    attribution: {
                        workspaceId,
                        canvasId,
                        capability,
                        ...(fresh.processId ? { processId: fresh.processId } : {}),
                    },
                    completeFactory: this.deps.completeFactory,
                    runScriptFactory: this.deps.runScriptFactory,
                }),
            );
            if (!run.ok) {
                return { kind: 'run-error', error: run.error };
            }

            const result = this.store.updateCanvas(workspaceId, canvasId, {
                content: run.state,
                expectedRevision: fresh.revision,
                editor: 'user',
            });
            if (!result.ok) {
                // A user save landed while the capability ran — caller retries with fresh state.
                return { kind: 'conflict', canvas: this.store.getCanvas(workspaceId, canvasId) ?? null };
            }
            return { kind: 'ok', canvas: result.canvas };
        });

        // Notified outside the queue, but only for the run that actually landed.
        if (outcome.kind === 'ok') {
            this.notifier.canvasUpdated(workspaceId, outcome.canvas, 'user');
        }
        return outcome;
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
