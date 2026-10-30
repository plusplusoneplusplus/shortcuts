import { randomUUID } from 'crypto';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { CLIConfig } from '../../config';
import type { CanvasRecord, CanvasStore } from '../canvas/canvas-store';
import { queueCanvasCapabilityRun } from '../canvas/canvas-capability-queue';
import type { CanvasUpdateNotifier } from '../canvas/canvas-update-notifier';
import { discoverCanvasExtensions } from './discovery';
import type { CanvasExtensionHostRegistry, CanvasExtensionOwner } from './host-registry';
import { listCanvasExtensionInstances, readCanvasExtensionInstance, type CanvasExtensionInstance } from './instance-records';

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
    return queueCanvasCapabilityRun(deps.workspaceId, `copilot-extension:${deps.processId}`, async () => {
        if (!deps.config().canvasExtensions?.enabled) throw new Error('Canvas extensions are disabled');
        const process = await deps.processStore.getProcess(deps.processId, deps.workspaceId);
        if (!process || process.archived || process.metadata?.workspaceId !== deps.workspaceId) {
            throw new Error('Canvas conversation is missing, archived or owned by another workspace');
        }
        return action();
    });
}

export function persistCanvasExtensionInstance(
    deps: CanvasExtensionInstanceDeps, instance: CanvasExtensionInstance, existing?: CanvasRecord,
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
            workspaceId: deps.workspaceId, processId: deps.processId,
            title: instance.title, content, type: 'copilot-extension', editor: 'ai',
        });
    }
    deps.notifier.canvasUpdated(deps.workspaceId, canvas, 'ai');
    return canvas;
}

export function openCanvasExtension(deps: CanvasExtensionInstanceDeps, args: OpenCanvasExtensionArgs) {
    return runCanvasExtensionOperation(deps, () => openInstance(deps, args));
}

/** The record, not a caller-supplied identity or input, determines what a tab opens. */
export function reopenCanvasExtension(deps: CanvasExtensionInstanceDeps, recordId: string) {
    return runCanvasExtensionOperation(deps, async () => {
        const canvas = deps.canvasStore.getCanvas(deps.workspaceId, recordId);
        if (!canvas || canvas.processId !== deps.processId) throw new Error('Canvas is unavailable in this conversation');
        const instance = readCanvasExtensionInstance(canvas);
        const opened = await openInstance(deps, {
            canvasId: `${instance.extensionKey}/${instance.canvasId}`,
            instanceId: instance.instanceId,
            input: instance.input,
        });
        return { ...opened, extensionKey: instance.extensionKey };
    });
}

/**
 * The "+" menu opens an extension by key: its first declared canvas, reusing this
 * chat's saved instance of it (an open one first) so repeated picks focus one panel.
 */
export function openCanvasExtensionByKey(deps: CanvasExtensionInstanceDeps, extensionKey: string) {
    return runCanvasExtensionOperation(deps, async () => {
        const extensions = await discoverCanvasExtensions({
            config: deps.config(), store: deps.processStore, dataDir: deps.dataDir, workspaceId: deps.workspaceId,
        });
        const extension = extensions.find(item => item.extensionKey === extensionKey);
        if (!extension) throw new Error(`Canvas extension is unavailable: ${extensionKey}`);
        const [declaration] = await deps.hosts.declarations({ workspaceId: deps.workspaceId, processId: deps.processId }, extension);
        if (!declaration) throw new Error(`Canvas extension declares no canvas: ${extensionKey}`);
        const saved = listCanvasExtensionInstances(deps.canvasStore, deps)
            .filter(({ instance }) => instance.extensionKey === extensionKey && instance.canvasId === declaration.id);
        const reuse = saved.find(({ instance }) => !instance.closed) ?? saved[0];
        const opened = await openInstance(deps, {
            canvasId: `${extensionKey}/${declaration.id}`,
            ...(reuse ? { instanceId: reuse.instance.instanceId } : {}),
        });
        return { ...opened, extensionKey };
    });
}

async function openInstance(deps: CanvasExtensionInstanceDeps, args: OpenCanvasExtensionArgs) {
    const owner = { workspaceId: deps.workspaceId, processId: deps.processId };
    if (typeof args?.canvasId !== 'string' || !args.canvasId.trim()) throw new Error('canvasId must be a non-empty string');
    if (args.input !== undefined && (!args.input || typeof args.input !== 'object' || Array.isArray(args.input))) {
        throw new Error('input must be an object');
    }
    if (args.instanceId !== undefined && (typeof args.instanceId !== 'string' || !args.instanceId.trim())) {
        throw new Error('instanceId must be a non-empty string');
    }
    const extensions = await discoverCanvasExtensions({
        config: deps.config(), store: deps.processStore, dataDir: deps.dataDir, workspaceId: deps.workspaceId,
    });
    const extension = extensions.find(item => args.canvasId.startsWith(`${item.extensionKey}/`));
    if (!extension) throw new Error(`Unknown canvas: ${args.canvasId}`);
    const canvasId = args.canvasId.slice(extension.extensionKey.length + 1);
    const declarations = await deps.hosts.declarations(owner, extension);
    const declaration = declarations.find(item => item.id === canvasId);
    if (!declaration) throw new Error(`Unknown canvas: ${args.canvasId}`);
    const instanceId = args.instanceId ?? randomUUID();
    const existing = listCanvasExtensionInstances(deps.canvasStore, deps)
        .find(record => record.instance.instanceId === instanceId);
    if (existing && (existing.instance.extensionKey !== extension.extensionKey || existing.instance.canvasId !== canvasId)) {
        throw new Error('Canvas instance belongs to another canvas');
    }
    const input = args.input ?? existing?.instance.input;
    const result = await deps.hosts.open(owner, extension, { canvasId, instanceId, ...(input ? { input } : {}) });
    const title = result.title ?? existing?.instance.title ?? declaration.displayName;
    let canvas: CanvasRecord;
    try {
        canvas = persistCanvasExtensionInstance(deps, { extensionKey: extension.extensionKey, canvasId, instanceId, input, title }, existing?.canvas);
    } catch (error) {
        // An instance without a durable record cannot be found to close later.
        if (!existing) await deps.hosts.close(owner, extension, instanceId).catch(() => {});
        throw error;
    }
    return { success: true, canvasId: canvas.id, instanceId, title, url: result.url, embed: `canvas://${canvas.id}` };
}
