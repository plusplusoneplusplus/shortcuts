import { defineTool, type Tool } from '@plusplusoneplusplus/coc-agent-sdk';
import { discoverCanvasExtensions } from '../canvas-extensions/discovery';
import { listCanvasExtensionInstances } from '../canvas-extensions/instance-records';
import {
    canvasExtensionFailure, openCanvasExtension, persistCanvasExtensionInstance, runCanvasExtensionOperation,
    type CanvasExtensionInstanceDeps, type OpenCanvasExtensionArgs,
} from '../canvas-extensions/instance-service';

export type CanvasExtensionToolsDeps = CanvasExtensionInstanceDeps;

export type { CanvasExtensionRuntime } from '../canvas-extensions/instance-service';

interface InvokeArgs { instanceId: string; actionName: string; input?: Record<string, unknown> }
type ManageArgs = { action: 'open' | 'close' } & Partial<OpenCanvasExtensionArgs>;

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
    const toolResult = <T>(action: (args: T) => Promise<unknown>) => async (args: T) => {
        try {
            return await action(args);
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
            description: 'Open or close an installed canvas instance. action "open" needs a qualified canvasId '
                + '(from list_canvas_capabilities) and takes optional input; supply instanceId to reopen a saved instance. '
                + 'action "close" needs instanceId; the saved record remains available to reopen.',
            parameters: { type: 'object', properties: {
                action: { type: 'string', enum: ['open', 'close'] },
                canvasId: { type: 'string' }, input: { type: 'object' }, instanceId: { type: 'string' },
            }, required: ['action'] },
            handler: toolResult(async args => args?.action === 'open'
                ? openCanvasExtension(deps, args as OpenCanvasExtensionArgs)
                : runCanvasExtensionOperation(deps, async () => {
                    if (args?.action !== 'close') throw new Error('action must be "open" or "close"');
                    for (const name of ['canvasId', 'input'] as const) {
                        if (args[name] !== undefined) throw new Error(`${name} is not supported for action "close"`);
                    }
                    const { canvas, instance } = findInstance(args.instanceId as string);
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
