import type { CanvasRecord, CanvasStore } from '../canvas/canvas-store';
import type { CanvasExtensionOwner } from './host-registry';
import type { CanvasInstanceRequest } from './extension-host';

/** Durable identity and reopen input. Runtime URLs are intentionally ephemeral. */
export interface CanvasExtensionInstance extends CanvasInstanceRequest {
    extensionKey: string;
    title: string;
    closed?: boolean;
}

export function readCanvasExtensionInstance(canvas: CanvasRecord): CanvasExtensionInstance {
    if (canvas.type !== 'copilot-extension') throw new Error('Not a Copilot extension canvas');
    const value = JSON.parse(canvas.content) as CanvasExtensionInstance;
    if (!value || typeof value.extensionKey !== 'string' || !value.extensionKey
        || typeof value.canvasId !== 'string' || !value.canvasId
        || typeof value.instanceId !== 'string' || !value.instanceId
        || typeof value.title !== 'string'
        || (value.closed !== undefined && typeof value.closed !== 'boolean')
        || (value.input !== undefined && (!value.input || typeof value.input !== 'object' || Array.isArray(value.input)))) {
        throw new Error(`Invalid canvas extension record: ${canvas.id}`);
    }
    return value;
}

export function listCanvasExtensionInstances(store: CanvasStore, owner: CanvasExtensionOwner) {
    return store.listCanvases(owner.workspaceId, { processId: owner.processId })
        .filter(canvas => canvas.type === 'copilot-extension')
        .map(descriptor => {
            const canvas = store.getCanvas(owner.workspaceId, descriptor.id);
            if (!canvas) throw new Error(`Canvas disappeared: ${descriptor.id}`);
            return { canvas, instance: readCanvasExtensionInstance(canvas) };
        });
}

/** Registry hydration restores open instances only, scoped to the exact conversation. */
export function loadCanvasExtensionInstances(store: CanvasStore, owner: CanvasExtensionOwner, extensionKey: string): CanvasInstanceRequest[] {
    return listCanvasExtensionInstances(store, owner)
        .filter(({ instance }) => instance.extensionKey === extensionKey && !instance.closed)
        .map(({ instance: { canvasId, instanceId, input } }) => ({ canvasId, instanceId, ...(input ? { input } : {}) }));
}
