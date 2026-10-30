import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { isValidCanvasId } from '../canvas/canvas-store';
import { readJsonBody, sendError, sendJson } from '../shared/router';
import type { Route } from '../types';
import { discoverCanvasExtensions } from './discovery';
import {
    canvasExtensionFailure, openCanvasExtensionByKey, reopenCanvasExtension, type CanvasExtensionRuntime,
} from './instance-service';

export function registerCanvasExtensionRoutes(routes: Route[], options: {
    dataDir: string;
    processStore: ProcessStore;
    runtime?: CanvasExtensionRuntime;
}): void {
    // Discovery only, for the panel's "+" menu: never starts an extension process.
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/canvas-extensions$/,
        handler: async (_req, res, match) => {
            const runtime = options.runtime;
            res.setHeader('Cache-Control', 'no-store');
            if (!runtime?.config().canvasExtensions?.enabled) return sendJson(res, { extensions: [] });
            const extensions = await discoverCanvasExtensions({
                config: runtime.config(), store: options.processStore, dataDir: options.dataDir,
                workspaceId: decodeURIComponent(match![1]),
            });
            sendJson(res, { extensions: extensions.map(({ extensionKey, name, description }) => ({
                extensionKey, name, ...(description ? { description } : {}),
            })) });
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/canvas-extensions\/open$/,
        handler: async (req, res, match) => {
            const runtime = options.runtime;
            if (!runtime?.config().canvasExtensions?.enabled) return sendError(res, 404, 'Not found');
            const body = await readJsonBody<{ processId?: unknown; extensionKey?: unknown }>(req, 16 * 1024).catch(() => null);
            if (!body || typeof body.processId !== 'string' || !body.processId
                || typeof body.extensionKey !== 'string' || !body.extensionKey) {
                return sendError(res, 400, 'processId and extensionKey are required');
            }
            try {
                const opened = await openCanvasExtensionByKey({
                    ...runtime, dataDir: options.dataDir, processStore: options.processStore,
                    workspaceId: decodeURIComponent(match![1]), processId: body.processId,
                }, body.extensionKey);
                res.setHeader('Cache-Control', 'no-store');
                sendJson(res, opened);
            } catch (error) {
                sendJson(res, canvasExtensionFailure(error), 422);
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/canvases\/([^/]+)\/copilot-extension\/open$/,
        handler: async (_req, res, match) => {
            const runtime = options.runtime;
            if (!runtime?.config().canvasExtensions?.enabled) return sendError(res, 404, 'Not found');
            const workspaceId = decodeURIComponent(match![1]);
            const canvasId = decodeURIComponent(match![2]);
            if (!isValidCanvasId(canvasId)) return sendError(res, 400, 'Invalid canvas ID');
            const canvas = runtime.canvasStore.getCanvas(workspaceId, canvasId);
            if (!canvas || canvas.type !== 'copilot-extension') return sendError(res, 404, 'Canvas not found');
            if (!canvas.processId) return sendError(res, 422, 'Canvas has no owning conversation');
            try {
                const opened = await reopenCanvasExtension({
                    ...runtime, dataDir: options.dataDir, processStore: options.processStore,
                    workspaceId, processId: canvas.processId,
                }, canvasId);
                res.setHeader('Cache-Control', 'no-store');
                sendJson(res, opened);
            } catch (error) {
                sendJson(res, canvasExtensionFailure(error), 422);
            }
        },
    });
}
