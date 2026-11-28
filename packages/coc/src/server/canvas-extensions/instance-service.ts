import { randomUUID } from 'crypto';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { CLIConfig } from '../../config';
import type { CanvasRecord, CanvasStore } from '../canvas/canvas-store';
import { queueCanvasExtensionOperation } from './operation-queue';
import type { CanvasUpdateNotifier } from '../canvas/canvas-update-notifier';
import { resolveOwnerCanvasExtensions, listGeneratedPackages, writeGeneratedPublication } from './generated-packages';
import type { CanvasExtensionHostRegistry, CanvasExtensionOwner } from './host-registry';
import {
    listCanvasExtensionInstances, readCanvasExtensionInstance, type CanvasExtensionInstance, type CanvasExtensionRecord,
} from './instance-records';

export interface CanvasExtensionInstanceDeps extends CanvasExtensionOwner {
    dataDir: string;
    config: () => Pick<CLIConfig, 'canvasExtensions'>;
    processStore: ProcessStore;
    hosts: CanvasExtensionHostRegistry;
    canvasStore: CanvasStore;
    notifier: CanvasUpdateNotifier;
}

export type CanvasExtensionRuntime = Omit<CanvasExtensionInstanceDeps,
    'workspaceId' | 'processId' | 'dataDir' | 'processStore'>;

export interface OpenCanvasExtensionArgs {
    canvasId: string;
    instanceId?: string;
    input?: Record<string, unknown>;
}

export function canvasExtensionFailure(error: unknown) {
    const data = (error as { data?: { code?: unknown; message?: unknown } } | null)?.data;
    return { success: false, error: {
        code: typeof data?.code === 'string' ? data.code : 'canvas-extension-error',
        message: typeof data?.message === 'string' ? data.message : error instanceof Error ? error.message : String(error),
    } };
}

/** Tools and tab reopening share one owner queue, including the durable write. */
export function runCanvasExtensionOperation<T>(deps: CanvasExtensionInstanceDeps, action: () => Promise<T>): Promise<T> {
    return queueCanvasExtensionOperation(deps.workspaceId, `copilot-extension:${deps.processId}`, async () => {
        await assertCanvasExtensionOwner(deps);
        return action();
    });
}

async function assertCanvasExtensionOwner(deps: CanvasExtensionInstanceDeps): Promise<void> {
    if (!deps.config().canvasExtensions?.enabled) throw new Error('Canvas extensions are disabled');
    const process = await deps.processStore.getProcess(deps.processId, deps.workspaceId);
    if (!process || process.archived || process.metadata?.workspaceId !== deps.workspaceId) {
        throw new Error('Canvas conversation is missing, archived or owned by another workspace');
    }
    if (!deps.config().canvasExtensions?.enabled) throw new Error('Canvas extensions are disabled');
}

/** Caller holds the owner operation queue. All open instances share this runtime. */
export async function reloadCanvasExtensionInstances(
    deps: CanvasExtensionInstanceDeps, target: CanvasExtensionRecord, signal?: AbortSignal,
) {
    signal?.throwIfAborted();
    const { instance } = target;
    const affected = listCanvasExtensionInstances(deps.canvasStore, deps).filter(record =>
        record.instance.extensionKey === instance.extensionKey
        && (!record.instance.closed || record.canvas.id === target.canvas.id));
    const extensions = await resolveOwnerCanvasExtensions({
        config: deps.config(), store: deps.processStore, dataDir: deps.dataDir, workspaceId: deps.workspaceId, processId: deps.processId,
    });
    const extension = extensions.find(item => item.extensionKey === instance.extensionKey);
    if (!extension) throw new Error(`Canvas extension is unavailable: ${instance.extensionKey}`);
    signal?.throwIfAborted();
    await deps.hosts.reset(deps, extension);
    const id = randomUUID();
    const results = new Map<string, Awaited<ReturnType<CanvasExtensionHostRegistry['open']>>>();
    try {
        for (const record of affected) {
            signal?.throwIfAborted();
            const { canvasId, instanceId, input } = record.instance;
            results.set(record.canvas.id, await deps.hosts.open(deps, extension, { canvasId, instanceId, input }));
        }
    } catch (error) {
        // A canceled or revoked owner must not publish late failures to its views.
        signal?.throwIfAborted();
        await deps.hosts.reset(deps, extension);
        signal?.throwIfAborted();
        const message = canvasExtensionFailure(error).error.message;
        for (const record of affected) {
            persistCanvasExtensionInstance(deps, {
                ...record.instance, runtimeReload: { id, error: message },
            }, record.canvas, { refreshOnly: true });
        }
        throw error;
    }
    signal?.throwIfAborted();
    await assertCanvasExtensionOwner(deps);
    signal?.throwIfAborted();
    for (const record of affected) {
        persistCanvasExtensionInstance(deps, {
            ...record.instance, closed: undefined,
            title: results.get(record.canvas.id)!.title ?? record.instance.title,
            runtimeReload: { id },
        }, record.canvas, { refreshOnly: true });
    }
    const generated = listGeneratedPackages(deps.dataDir, deps).find(item => item.extension.extensionKey === instance.extensionKey);
    if (generated?.status === 'failed') writeGeneratedPublication(deps.dataDir, deps, { ...generated, status: 'committed' });
    const result = results.get(target.canvas.id)!;
    return {
        success: true, canvasId: target.canvas.id, instanceId: instance.instanceId, reused: true,
        title: result.title ?? instance.title, url: result.url, embed: `canvas://${target.canvas.id}`,
        extensionKey: instance.extensionKey, refreshedCanvasIds: affected.map(record => record.canvas.id),
    };
}

export function persistCanvasExtensionInstance(
    deps: CanvasExtensionInstanceDeps, instance: CanvasExtensionInstance, existing?: CanvasRecord,
    notification?: { refreshOnly?: boolean; silent?: boolean; recordId?: string },
): CanvasRecord {
    const content = JSON.stringify(instance);
    let canvas: CanvasRecord;
    if (existing) {
        const result = deps.canvasStore.updateCanvas(deps.workspaceId, existing.id, {
            title: instance.title, content, expectedRevision: existing.revision, editor: 'ai',
        });
        if (!result.ok) throw new Error(`Canvas persistence failed: ${result.reason}`);
        canvas = result.canvas;
    } else {
        canvas = deps.canvasStore.createCanvas({
            id: notification?.recordId, workspaceId: deps.workspaceId, processId: deps.processId,
            title: instance.title, content, type: 'copilot-extension', editor: 'ai',
        });
    }
    if (!notification?.silent) deps.notifier.canvasUpdated(deps.workspaceId, canvas, 'ai', notification);
    return canvas;
}

export function openCanvasExtension(deps: CanvasExtensionInstanceDeps, args: OpenCanvasExtensionArgs) {
    return runCanvasExtensionOperation(deps, () => openInstance(deps, args));
}

/** The record, not a caller-supplied identity or input, determines what a tab opens. */
export function reopenCanvasExtension(
    deps: CanvasExtensionInstanceDeps, recordId: string, options: { reload?: boolean; signal?: AbortSignal } = {},
) {
    return runCanvasExtensionOperation(deps, async () => {
        options.signal?.throwIfAborted();
        const canvas = deps.canvasStore.getCanvas(deps.workspaceId, recordId);
        if (!canvas || canvas.processId !== deps.processId) throw new Error('Canvas is unavailable in this conversation');
        const instance = readCanvasExtensionInstance(canvas);
        if (options.reload) return reloadCanvasExtensionInstances(deps, { canvas, instance }, options.signal);
        options.signal?.throwIfAborted();
        const opened = await openInstance(deps, {
            canvasId: `${instance.extensionKey}/${instance.canvasId}`,
            instanceId: instance.instanceId,
            input: instance.input,
        }, options.signal, true);
        return { ...opened, extensionKey: instance.extensionKey };
    });
}

/** The "+" menu opens an extension's first declared canvas, always reusing this chat's saved instance. */
export function openCanvasExtensionByKey(deps: CanvasExtensionInstanceDeps, extensionKey: string) {
    return runCanvasExtensionOperation(deps, async () => {
        const extensions = await resolveOwnerCanvasExtensions({
            config: deps.config(), store: deps.processStore, dataDir: deps.dataDir, workspaceId: deps.workspaceId, processId: deps.processId,
        });
        const extension = extensions.find(item => item.extensionKey === extensionKey);
        if (!extension) throw new Error(`Canvas extension is unavailable: ${extensionKey}`);
        const [declaration] = await deps.hosts.declarations({ workspaceId: deps.workspaceId, processId: deps.processId }, extension);
        if (!declaration) throw new Error(`Canvas extension declares no canvas: ${extensionKey}`);
        const reuse = reusableInstance(listCanvasExtensionInstances(deps.canvasStore, deps), extensionKey, declaration.id);
        const opened = await openInstance(deps, {
            canvasId: `${extensionKey}/${declaration.id}`,
            ...(reuse ? { instanceId: reuse.instance.instanceId } : {}),
        });
        return { ...opened, extensionKey };
    });
}

export function isCanvasExtensionSingleton(config: Pick<CLIConfig, 'canvasExtensions'>): boolean {
    return config.canvasExtensions?.singletonPerSession !== false;
}

/**
 * The conversation's instance of one canvas: an open one first, else a closed one,
 * most recently updated first. Older duplicates stay saved and reopenable by ID.
 */
function reusableInstance(saved: CanvasExtensionRecord[], extensionKey: string, canvasId: string) {
    const matches = saved.filter(({ instance }) => instance.extensionKey === extensionKey && instance.canvasId === canvasId);
    return matches.find(({ instance }) => !instance.closed) ?? matches[0];
}

async function openInstance(deps: CanvasExtensionInstanceDeps, args: OpenCanvasExtensionArgs, signal?: AbortSignal, refreshOnly = false) {
    const owner = { workspaceId: deps.workspaceId, processId: deps.processId };
    if (typeof args?.canvasId !== 'string' || !args.canvasId.trim()) throw new Error('canvasId must be a non-empty string');
    if (args.input !== undefined && (!args.input || typeof args.input !== 'object' || Array.isArray(args.input))) {
        throw new Error('input must be an object');
    }
    if (args.instanceId !== undefined && (typeof args.instanceId !== 'string' || !args.instanceId.trim())) {
        throw new Error('instanceId must be a non-empty string');
    }
    const extensions = await resolveOwnerCanvasExtensions({
        config: deps.config(), store: deps.processStore, dataDir: deps.dataDir, workspaceId: deps.workspaceId, processId: deps.processId,
    });
    const extension = extensions.find(item => args.canvasId.startsWith(`${item.extensionKey}/`));
    signal?.throwIfAborted();
    if (!extension) throw new Error(`Unknown canvas: ${args.canvasId}`);
    const canvasId = args.canvasId.slice(extension.extensionKey.length + 1);
    const declarations = await deps.hosts.declarations(owner, extension);
    signal?.throwIfAborted();
    const declaration = declarations.find(item => item.id === canvasId);
    if (!declaration) throw new Error(`Unknown canvas: ${args.canvasId}`);
    const saved = listCanvasExtensionInstances(deps.canvasStore, deps);
    let existing = args.instanceId === undefined ? undefined : saved.find(record => record.instance.instanceId === args.instanceId);
    if (existing && (existing.instance.extensionKey !== extension.extensionKey || existing.instance.canvasId !== canvasId)) {
        throw new Error('Canvas instance belongs to another canvas');
    }
    // Singleton mode: a new or unknown instance ID resolves to this chat's saved instance.
    if (!existing && isCanvasExtensionSingleton(deps.config())) existing = reusableInstance(saved, extension.extensionKey, canvasId);
    const instanceId = existing?.instance.instanceId ?? args.instanceId ?? randomUUID();
    const input = args.input ?? existing?.instance.input;
    const result = await deps.hosts.open(owner, extension, { canvasId, instanceId, ...(input ? { input } : {}) });
    const title = result.title ?? existing?.instance.title ?? declaration.displayName;
    let canvas: CanvasRecord;
    try {
        signal?.throwIfAborted();
        canvas = persistCanvasExtensionInstance(deps, { extensionKey: extension.extensionKey, canvasId, instanceId, input, title,
            ...(existing?.instance.runtimeReload ? { runtimeReload: existing.instance.runtimeReload } : {}),
        }, existing?.canvas, refreshOnly ? { refreshOnly: true } : undefined);
    } catch (error) {
        // An instance without a durable record cannot be found to close later.
        if (!existing) await deps.hosts.close(owner, extension, instanceId).catch(() => {});
        throw error;
    }
    const generated = listGeneratedPackages(deps.dataDir, deps).find(item => item.extension.extensionKey === extension.extensionKey);
    if (generated?.status === 'failed') writeGeneratedPublication(deps.dataDir, deps, { ...generated, status: 'committed' });
    return { success: true, canvasId: canvas.id, instanceId, reused: Boolean(existing), title, url: result.url, embed: `canvas://${canvas.id}` };
}
