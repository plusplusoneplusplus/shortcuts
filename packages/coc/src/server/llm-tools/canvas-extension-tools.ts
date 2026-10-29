import { randomUUID } from 'crypto';
import { defineTool, type Tool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { CLIConfig } from '../../config';
import type { CanvasStore, CanvasRecord } from '../canvas/canvas-store';
import { queueCanvasCapabilityRun } from '../canvas/canvas-capability-queue';
import type { CanvasUpdateNotifier } from '../canvas/canvas-update-notifier';
import { discoverCanvasExtensions } from '../canvas-extensions/discovery';
import type { CanvasExtensionHostRegistry, CanvasExtensionOwner } from '../canvas-extensions/host-registry';
import { listCanvasExtensionInstances, type CanvasExtensionInstance } from '../canvas-extensions/instance-records';

export interface CanvasExtensionToolsDeps extends CanvasExtensionOwner {
    dataDir: string;
    config: () => Pick<CLIConfig, 'canvasExtensions'>;
    processStore: ProcessStore;
    hosts: CanvasExtensionHostRegistry;
    canvasStore: CanvasStore;
    notifier: CanvasUpdateNotifier;
}

interface OpenArgs { canvasId: string; instanceId?: string; input?: Record<string, unknown> }
interface InvokeArgs { instanceId: string; actionName: string; input?: Record<string, unknown> }
interface CloseArgs { instanceId: string }

function requiredString(value: unknown, name: string): asserts value is string {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`);
}

function validateInput(input: unknown): void {
    if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) {
        throw new Error('input must be an object');
    }
}

/** Fixed tools for every provider; the live gate also revokes already-created handlers. */
export function createCanvasExtensionTools(deps: CanvasExtensionToolsDeps): Tool<unknown>[] {
    if (!deps.config().canvasExtensions?.enabled) return [];
    const owner = { workspaceId: deps.workspaceId, processId: deps.processId };
    const discover = () => discoverCanvasExtensions({
        config: deps.config(), store: deps.processStore, dataDir: deps.dataDir, workspaceId: owner.workspaceId,
    });
    const records = () => listCanvasExtensionInstances(deps.canvasStore, owner);
    const findInstance = (instanceId: string) => {
        requiredString(instanceId, 'instanceId');
        const found = records().find(record => record.instance.instanceId === instanceId);
        if (!found) throw new Error(`Unknown canvas instance: ${instanceId}`);
        return found;
    };
    const extensionFor = async (extensionKey: string) => {
        const extension = (await discover()).find(item => item.extensionKey === extensionKey);
        if (!extension) throw new Error(`Canvas extension is unavailable: ${extensionKey}`);
        return extension;
    };
    const persist = (instance: CanvasExtensionInstance, existing?: CanvasRecord) => {
        const content = JSON.stringify(instance);
        let canvas: CanvasRecord;
        if (existing) {
            const result = deps.canvasStore.updateCanvas(owner.workspaceId, existing.id, {
                title: instance.title, content, expectedRevision: existing.revision, editor: 'ai',
            });
            if (!result.ok) throw new Error(`Canvas persistence failed: ${result.reason}`);
            canvas = result.canvas;
        } else {
            canvas = deps.canvasStore.createCanvas({
                ...owner, title: instance.title, content, type: 'copilot-extension', editor: 'ai',
            });
        }
        deps.notifier.canvasUpdated(owner.workspaceId, canvas, 'ai');
        return canvas;
    };
    // One owner queue across factory invocations prevents duplicate instance records and
    // close/open races. The prefix cannot collide with a filesystem-safe canvas ID.
    const guarded = <T>(action: (args: T) => Promise<unknown>) => async (args: T) => {
        try {
            return await queueCanvasCapabilityRun(owner.workspaceId, `copilot-extension:${owner.processId}`, async () => {
                if (!deps.config().canvasExtensions?.enabled) throw new Error('Canvas extensions are disabled');
                const process = await deps.processStore.getProcess(owner.processId, owner.workspaceId);
                if (!process || process.archived || process.metadata?.workspaceId !== owner.workspaceId) {
                    throw new Error('Canvas conversation is missing, archived or owned by another workspace');
                }
                return action(args);
            });
        } catch (error) {
            const data = (error as { data?: { code?: unknown; message?: unknown } } | null)?.data;
            return { success: false, error: {
                code: typeof data?.code === 'string' ? data.code : 'canvas-extension-error',
                message: typeof data?.message === 'string' ? data.message : error instanceof Error ? error.message : String(error),
            } };
        }
    };

    return [
        defineTool('list_canvas_capabilities', {
            description: 'List installed canvas extensions and their declared canvases and actions.',
            parameters: { type: 'object', properties: {}, required: [] },
            handler: guarded(async () => {
                const canvases = [];
                for (const extension of await discover()) {
                    for (const declaration of await deps.hosts.declarations(owner, extension)) {
                        canvases.push({ ...declaration, id: `${extension.extensionKey}/${declaration.id}`, extensionKey: extension.extensionKey });
                    }
                }
                return { success: true, canvases };
            }),
        }),
        defineTool<OpenArgs>('open_canvas', {
            description: 'Open an installed canvas by its qualified canvasId. Supply instanceId to reopen an existing instance.',
            parameters: { type: 'object', properties: {
                canvasId: { type: 'string' }, input: { type: 'object' }, instanceId: { type: 'string' },
            }, required: ['canvasId'] },
            handler: guarded(async args => {
                requiredString(args?.canvasId, 'canvasId');
                validateInput(args.input);
                if (args.instanceId !== undefined) requiredString(args.instanceId, 'instanceId');
                const extensions = await discover();
                const extension = extensions.find(item => args.canvasId.startsWith(`${item.extensionKey}/`));
                if (!extension) throw new Error(`Unknown canvas: ${args.canvasId}`);
                const canvasId = args.canvasId.slice(extension.extensionKey.length + 1);
                const declarations = await deps.hosts.declarations(owner, extension);
                const declaration = declarations.find(item => item.id === canvasId);
                if (!declaration) throw new Error(`Unknown canvas: ${args.canvasId}`);
                const instanceId = args.instanceId ?? randomUUID();
                const existing = records().find(record => record.instance.instanceId === instanceId);
                if (existing && (existing.instance.extensionKey !== extension.extensionKey || existing.instance.canvasId !== canvasId)) {
                    throw new Error('Canvas instance belongs to another canvas');
                }
                const input = args.input ?? existing?.instance.input;
                const result = await deps.hosts.open(owner, extension, { canvasId, instanceId, ...(input ? { input } : {}) });
                const title = result.title ?? existing?.instance.title ?? declaration.displayName;
                let canvas: CanvasRecord;
                try {
                    canvas = persist({ extensionKey: extension.extensionKey, canvasId, instanceId, input, title }, existing?.canvas);
                } catch (error) {
                    // A newly opened instance with no durable record cannot be found to close later.
                    if (!existing) await deps.hosts.close(owner, extension, instanceId).catch(() => {});
                    throw error;
                }
                return { success: true, canvasId: canvas.id, instanceId, title, url: result.url, embed: `canvas://${canvas.id}` };
            }),
        }),
        defineTool<InvokeArgs>('invoke_canvas_action', {
            description: 'Invoke a declared action on an open canvas instance.',
            parameters: { type: 'object', properties: {
                instanceId: { type: 'string' }, actionName: { type: 'string' }, input: { type: 'object' },
            }, required: ['instanceId', 'actionName'] },
            handler: guarded(async args => {
                requiredString(args?.actionName, 'actionName');
                validateInput(args.input);
                const { instance } = findInstance(args.instanceId);
                if (instance.closed) throw new Error('Canvas instance is closed; reopen it with open_canvas');
                const result = await deps.hosts.invoke(owner, await extensionFor(instance.extensionKey), args);
                return { success: true, result };
            }),
        }),
        defineTool<CloseArgs>('close_canvas', {
            description: 'Close a canvas instance. Its saved record remains available to reopen.',
            parameters: { type: 'object', properties: { instanceId: { type: 'string' } }, required: ['instanceId'] },
            handler: guarded(async args => {
                const { canvas, instance } = findInstance(args?.instanceId);
                if (!instance.closed) {
                    await deps.hosts.close(owner, await extensionFor(instance.extensionKey), instance.instanceId);
                    persist({ ...instance, closed: true }, canvas);
                }
                return { success: true, instanceId: instance.instanceId };
            }),
        }),
    ] as Tool<unknown>[];
}
