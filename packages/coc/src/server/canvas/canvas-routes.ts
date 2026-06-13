/**
 * Canvas REST Routes
 *
 * Workspace-scoped canvas API consumed by the dashboard canvas side panel:
 *   GET  /api/workspaces/:wsId/canvases?processId=...  — list descriptors
 *   GET  /api/workspaces/:wsId/canvases/:canvasId      — full record
 *   PUT  /api/workspaces/:wsId/canvases/:canvasId      — user save (revision-checked)
 *
 * User saves broadcast a `canvas-updated` WebSocket event so other dashboard
 * tabs can refresh. Revision conflicts return 409 with the current record so
 * the client can offer a reload.
 */

import { sendJSON, sendError, parseBody } from '../core/api-handler';
import type { Route } from '../types';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import { CanvasStore, isValidCanvasId } from './canvas-store';
import type { CanvasEdit } from './canvas-store';

const listPattern = /^\/api\/workspaces\/([^/]+)\/canvases$/;
const detailPattern = /^\/api\/workspaces\/([^/]+)\/canvases\/([^/]+)$/;

interface SaveCanvasBody {
    content?: string;
    edits?: CanvasEdit[];
    expectedRevision?: number;
    title?: string;
}

export function registerCanvasRoutes(
    routes: Route[],
    dataDir: string,
    getWsServer?: () => ProcessWebSocketServer | undefined,
): void {
    const store = new CanvasStore(dataDir);

    routes.push({
        method: 'GET',
        pattern: listPattern,
        handler: async (req, res, match) => {
            const wsId = decodeURIComponent(match![1]);
            const processId = new URL(req.url!, 'http://x').searchParams.get('processId') ?? undefined;
            try {
                const canvases = store.listCanvases(wsId, processId ? { processId } : undefined);
                sendJSON(res, 200, { canvases });
            } catch {
                sendError(res, 500, 'Failed to list canvases');
            }
        },
    });

    routes.push({
        method: 'GET',
        pattern: detailPattern,
        handler: async (_req, res, match) => {
            const wsId = decodeURIComponent(match![1]);
            const canvasId = decodeURIComponent(match![2]);
            if (!isValidCanvasId(canvasId)) {
                return sendError(res, 400, 'Invalid canvas ID');
            }
            const canvas = store.getCanvas(wsId, canvasId);
            if (!canvas) {
                return sendError(res, 404, 'Canvas not found');
            }
            sendJSON(res, 200, { canvas });
        },
    });

    routes.push({
        method: 'PUT',
        pattern: detailPattern,
        handler: async (req, res, match) => {
            const wsId = decodeURIComponent(match![1]);
            const canvasId = decodeURIComponent(match![2]);
            if (!isValidCanvasId(canvasId)) {
                return sendError(res, 400, 'Invalid canvas ID');
            }

            let body: SaveCanvasBody;
            try {
                body = await parseBody(req) as SaveCanvasBody;
            } catch {
                return sendError(res, 400, 'Invalid JSON body');
            }
            if (body.content === undefined && (!Array.isArray(body.edits) || body.edits.length === 0) && body.title === undefined) {
                return sendError(res, 400, 'Provide content, edits, or title');
            }

            const result = store.updateCanvas(wsId, canvasId, {
                content: body.content,
                edits: body.edits,
                expectedRevision: body.expectedRevision,
                title: body.title,
                editor: 'user',
            });

            if (!result.ok) {
                if (result.reason === 'not-found') {
                    return sendError(res, 404, 'Canvas not found');
                }
                if (result.reason === 'revision-conflict') {
                    return sendJSON(res, 409, {
                        error: 'revision-conflict',
                        currentRevision: result.currentRevision,
                        canvas: store.getCanvas(wsId, canvasId),
                    });
                }
                return sendError(res, 400, result.error);
            }

            getWsServer?.()?.broadcastProcessEvent({
                type: 'canvas-updated',
                workspaceId: wsId,
                canvasId,
                processId: result.canvas.processId,
                title: result.canvas.title,
                revision: result.canvas.revision,
                editor: 'user',
                timestamp: Date.now(),
            });

            sendJSON(res, 200, { canvas: result.canvas });
        },
    });
}
