/**
 * Queue image routes (blob retrieval).
 *
 * GET /api/queue/:id/images — Load externalized image blobs for a task
 */

import { sendJSON, sendError } from '../api-handler';
import { ImageBlobStore } from '../queue/image-blob-store';
import type { Route } from '../types';
import type { QueueRouteContext } from './queue-shared';

export function registerQueueImagesRoutes(routes: Route[], ctx: QueueRouteContext): void {
    const { bridge } = ctx;

    // ------------------------------------------------------------------
    // GET /api/queue/:id/images — Load externalized image blobs
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/queue\/([^/]+)\/images$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const task = bridge.findManagerForTask(id)?.getTask(id);
            if (!task) {
                return sendError(res, 404, 'Task not found');
            }

            const filePath = (task.payload as any)?.imagesFilePath;
            if (filePath) {
                try {
                    const images = await ImageBlobStore.loadImages(filePath);
                    return sendJSON(res, 200, { images });
                } catch {
                    return sendJSON(res, 200, { images: [] });
                }
            }
            sendJSON(res, 200, { images: [] });
        },
    });
}
