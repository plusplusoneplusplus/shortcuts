import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { isValidCanvasId } from '../canvas/canvas-store';
import { sendError, sendJson } from '../shared/router';
import type { Route } from '../types';
import { canvasExtensionFailure, reopenCanvasExtension, type CanvasExtensionRuntime } from './instance-service';

export function registerCanvasExtensionRoutes(routes: Route[], options: {
    dataDir: string;
    processStore: ProcessStore;
    runtime?: CanvasExtensionRuntime;
}): void {
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
