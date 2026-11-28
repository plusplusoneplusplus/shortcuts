import { defineTool, type Tool, type ToolInvocation } from '@plusplusoneplusplus/coc-agent-sdk';
import { discoverCanvasExtensions } from '../canvas-extensions/discovery';
import { listCanvasExtensionInstances } from '../canvas-extensions/instance-records';
import {
    canvasExtensionFailure, isCanvasExtensionSingleton, openCanvasExtension, persistCanvasExtensionInstance, reloadCanvasExtensionInstances, runCanvasExtensionOperation,
    type CanvasExtensionInstanceDeps, type OpenCanvasExtensionArgs,
} from '../canvas-extensions/instance-service';

export type CanvasExtensionToolsDeps = CanvasExtensionInstanceDeps;

export type { CanvasExtensionRuntime } from '../canvas-extensions/instance-service';

interface InvokeArgs { instanceId: string; actionName: string; input?: Record<string, unknown> }
type ManageArgs = { action: 'open' | 'close' | 'reload' } & Partial<OpenCanvasExtensionArgs>;

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
    const toolResult = <T>(action: (args: T, signal?: AbortSignal) => Promise<unknown>) => async (args: T, invocation?: ToolInvocation) => {
        try {
            return await action(args, invocation?.signal);
        } catch (error) {
            const failure = canvasExtensionFailure(error);
            return { resultType: 'failure', textResultForLlm: JSON.stringify(failure) };
        }
    };
    const guarded = <T>(action: (args: T) => Promise<unknown>) =>
        toolResult((args: T) => runCanvasExtensionOperation(deps, () => action(args)));

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
        defineTool<ManageArgs>('manage_canvas', {
            description: 'Open, close or reload an installed canvas instance. action "open" needs a qualified canvasId '
                + '(from list_canvas_capabilities) and takes optional input; supply instanceId to reopen a saved instance. '
                + (isCanvasExtensionSingleton(deps.config())
                    ? 'Each canvas has one instance per chat: open reuses the saved instance (result reused: true, with its instanceId); '
                        + 'input, when given, replaces its saved input and is sent to the extension, otherwise the saved input is kept. '
                    : '')
                + 'action "close" needs instanceId; the saved record remains available to reopen. '
                + 'action "reload" needs an open instanceId and rejects canvasId/input. It restarts this extension in this chat '
                + 'even when only local imports changed, reopens all its open instances with saved input, and refreshes their visible views. '
                + 'Unsaved page input and runtime memory may be lost; session files are kept. Running actions finish first; no action is replayed.',
            parameters: { type: 'object', properties: {
                action: { type: 'string', enum: ['open', 'close', 'reload'] },
                canvasId: { type: 'string' }, input: { type: 'object' }, instanceId: { type: 'string' },
            }, required: ['action'] },
            handler: toolResult(async (args, signal) => args?.action === 'open'
                ? openCanvasExtension(deps, args as OpenCanvasExtensionArgs)
                : runCanvasExtensionOperation(deps, async () => {
                    if (args?.action !== 'close' && args?.action !== 'reload') throw new Error('action must be "open", "close" or "reload"');
                    for (const name of ['canvasId', 'input'] as const) {
                        if (args[name] !== undefined) throw new Error(`${name} is not supported for action "${args.action}"`);
                    }
                    const { canvas, instance } = findInstance(args.instanceId as string);
                    if (args.action === 'reload') {
                        signal?.throwIfAborted();
                        if (instance.closed) throw new Error('Canvas instance is closed; reopen it before reloading');
                        return reloadCanvasExtensionInstances(deps, { canvas, instance }, signal);
                    }
                    if (!instance.closed) {
                        await deps.hosts.close(owner, await extensionFor(instance.extensionKey), instance.instanceId);
                        persistCanvasExtensionInstance(deps, { ...instance, closed: true }, canvas);
                    }
                    return { success: true, instanceId: instance.instanceId };
                })),
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
                if (instance.closed) throw new Error('Canvas instance is closed; reopen it with manage_canvas action "open"');
                const result = await deps.hosts.invoke(owner, await extensionFor(instance.extensionKey), args);
                return { success: true, result };
            }),
        }),
    ] as Tool<unknown>[];
}
