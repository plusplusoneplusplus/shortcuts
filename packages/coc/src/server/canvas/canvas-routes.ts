/**
 * Canvas REST Routes
 *
 * Workspace-scoped canvas API consumed by the dashboard canvas side panel:
 *   GET    /api/workspaces/:wsId/canvases?processId=...           — list descriptors
 *   GET    /api/workspaces/:wsId/canvases/:canvasId               — full record
 *   PUT    /api/workspaces/:wsId/canvases/:canvasId               — user save (revision-checked)
 *   GET    /api/workspaces/:wsId/canvases/:canvasId/versions      — version snapshot metadata
 *   GET    /api/workspaces/:wsId/canvases/:canvasId/versions/:rev — one full version snapshot
 *   GET    /api/workspaces/:wsId/canvases/:canvasId/comments      — anchored comments (?status= filter)
 *   POST   /api/workspaces/:wsId/canvases/:canvasId/comments      — add a comment
 *   PATCH  /api/workspaces/:wsId/canvases/:canvasId/comments/:cid — set comment status
 *   DELETE /api/workspaces/:wsId/canvases/:canvasId/comments/:cid — delete a comment
 *   GET    /api/workspaces/:wsId/canvases/:canvasId/extension     — extension documents (manifest + ui + capabilities)
 *   POST   /api/workspaces/:wsId/canvases/:canvasId/capabilities/:name — invoke a capability against the shared state
 *
 * User saves broadcast a `canvas-updated` WebSocket event so other dashboard
 * tabs can refresh. Revision conflicts return 409 with the current record so
 * the client can offer a reload.
 */

import { sendJSON, sendError, parseBody } from '../core/api-handler';
import type { Route } from '../types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import { emitCanvasUpdated } from '../streaming/sse-handler';
import { CanvasStore, isValidCanvasId } from './canvas-store';
import type { CanvasEdit, CanvasCommentStatus, CanvasRecord } from './canvas-store';
import { runCanvasCapability, isValidCapabilityName } from './canvas-capability-runner';
import { runKustoCanvas } from '../kusto/kusto-service';
import type { KustoClientFactory } from '../kusto/kusto-exec';

const listPattern = /^\/api\/workspaces\/([^/]+)\/canvases$/;
const detailPattern = /^\/api\/workspaces\/([^/]+)\/canvases\/([^/]+)$/;
const versionsPattern = /^\/api\/workspaces\/([^/]+)\/canvases\/([^/]+)\/versions$/;
const versionDetailPattern = /^\/api\/workspaces\/([^/]+)\/canvases\/([^/]+)\/versions\/(\d+)$/;
const commentsPattern = /^\/api\/workspaces\/([^/]+)\/canvases\/([^/]+)\/comments$/;
const commentDetailPattern = /^\/api\/workspaces\/([^/]+)\/canvases\/([^/]+)\/comments\/([^/]+)$/;
const extensionPattern = /^\/api\/workspaces\/([^/]+)\/canvases\/([^/]+)\/extension$/;
const capabilityPattern = /^\/api\/workspaces\/([^/]+)\/canvases\/([^/]+)\/capabilities\/([^/]+)$/;
const runPattern = /^\/api\/workspaces\/([^/]+)\/canvases\/([^/]+)\/run$/;

const COMMENT_STATUSES: readonly CanvasCommentStatus[] = ['open', 'sent', 'resolved'];

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
    processStore?: ProcessStore,
    /** Live gate for the Kusto feature (AC-08). When it returns false the Run route 404s. */
    getKustoEnabled?: () => boolean,
    /** Injectable Kusto client factory; defaults to the real SDK. Overridden in tests. */
    kustoClientFactory?: KustoClientFactory,
): void {
    const store = new CanvasStore(dataDir);

    const broadcastCanvasUpdated = (wsId: string, canvas: CanvasRecord, editor: 'ai' | 'user'): void => {
        getWsServer?.()?.broadcastProcessEvent({
            type: 'canvas-updated',
            workspaceId: wsId,
            canvasId: canvas.id,
            processId: canvas.processId,
            title: canvas.title,
            revision: canvas.revision,
            editor,
            timestamp: Date.now(),
        });
        if (processStore && canvas.processId) {
            emitCanvasUpdated(processStore, canvas.processId, {
                canvasId: canvas.id,
                title: canvas.title,
                revision: canvas.revision,
                editor,
            });
        }
    };

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

    // AC-07 — manual Kusto create. Gated on the Kusto feature flag so the route
    // is unreachable when disabled (AC-08); only `kusto` canvases may be created
    // here (the AI creates other types via its tools).
    routes.push({
        method: 'POST',
        pattern: listPattern,
        handler: async (req, res, match) => {
            if (!getKustoEnabled?.()) {
                return sendError(res, 404, 'Not found');
            }
            const wsId = decodeURIComponent(match![1]);
            let body: { type?: string; title?: string; content?: string; processId?: string };
            try {
                body = (await parseBody(req)) as typeof body;
            } catch {
                return sendError(res, 400, 'Invalid JSON body');
            }
            if (body.type !== 'kusto') {
                return sendError(res, 400, 'Only Kusto canvases can be created here');
            }
            if (typeof body.content !== 'string') {
                return sendError(res, 400, 'content is required');
            }
            const canvas = store.createCanvas({
                workspaceId: wsId,
                type: 'kusto',
                title: typeof body.title === 'string' && body.title.trim() ? body.title : 'Kusto Query',
                content: body.content,
                ...(typeof body.processId === 'string' ? { processId: body.processId } : {}),
                editor: 'user',
            });
            broadcastCanvasUpdated(wsId, canvas, 'user');
            sendJSON(res, 201, { canvas });
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

    routes.push({
        method: 'GET',
        pattern: versionsPattern,
        handler: async (_req, res, match) => {
            const wsId = decodeURIComponent(match![1]);
            const canvasId = decodeURIComponent(match![2]);
            if (!isValidCanvasId(canvasId)) {
                return sendError(res, 400, 'Invalid canvas ID');
            }
            sendJSON(res, 200, { versions: store.listVersions(wsId, canvasId) });
        },
    });

    routes.push({
        method: 'GET',
        pattern: versionDetailPattern,
        handler: async (_req, res, match) => {
            const wsId = decodeURIComponent(match![1]);
            const canvasId = decodeURIComponent(match![2]);
            const revision = Number(match![3]);
            if (!isValidCanvasId(canvasId)) {
                return sendError(res, 400, 'Invalid canvas ID');
            }
            const version = store.getVersion(wsId, canvasId, revision);
            if (!version) {
                return sendError(res, 404, 'Canvas version not found');
            }
            sendJSON(res, 200, { version });
        },
    });

    routes.push({
        method: 'GET',
        pattern: commentsPattern,
        handler: async (req, res, match) => {
            const wsId = decodeURIComponent(match![1]);
            const canvasId = decodeURIComponent(match![2]);
            if (!isValidCanvasId(canvasId)) {
                return sendError(res, 400, 'Invalid canvas ID');
            }
            const status = new URL(req.url!, 'http://x').searchParams.get('status');
            if (status && !COMMENT_STATUSES.includes(status as CanvasCommentStatus)) {
                return sendError(res, 400, 'Invalid comment status filter');
            }
            const comments = store.listComments(wsId, canvasId, status ? { status: status as CanvasCommentStatus } : undefined);
            sendJSON(res, 200, { comments });
        },
    });

    routes.push({
        method: 'POST',
        pattern: commentsPattern,
        handler: async (req, res, match) => {
            const wsId = decodeURIComponent(match![1]);
            const canvasId = decodeURIComponent(match![2]);
            if (!isValidCanvasId(canvasId)) {
                return sendError(res, 400, 'Invalid canvas ID');
            }
            let body: { anchorText?: string; body?: string };
            try {
                body = await parseBody(req) as { anchorText?: string; body?: string };
            } catch {
                return sendError(res, 400, 'Invalid JSON body');
            }
            if (typeof body.anchorText !== 'string' || !body.anchorText.trim()) {
                return sendError(res, 400, 'anchorText is required');
            }
            if (typeof body.body !== 'string' || !body.body.trim()) {
                return sendError(res, 400, 'body is required');
            }
            const comment = store.addComment(wsId, canvasId, { anchorText: body.anchorText, body: body.body });
            if (!comment) {
                return sendError(res, 404, 'Canvas not found');
            }
            sendJSON(res, 201, { comment });
        },
    });

    routes.push({
        method: 'PATCH',
        pattern: commentDetailPattern,
        handler: async (req, res, match) => {
            const wsId = decodeURIComponent(match![1]);
            const canvasId = decodeURIComponent(match![2]);
            const commentId = decodeURIComponent(match![3]);
            if (!isValidCanvasId(canvasId)) {
                return sendError(res, 400, 'Invalid canvas ID');
            }
            let body: { status?: string };
            try {
                body = await parseBody(req) as { status?: string };
            } catch {
                return sendError(res, 400, 'Invalid JSON body');
            }
            if (!body.status || !COMMENT_STATUSES.includes(body.status as CanvasCommentStatus)) {
                return sendError(res, 400, 'status must be one of: open, sent, resolved');
            }
            const comment = store.setCommentStatus(wsId, canvasId, commentId, body.status as CanvasCommentStatus);
            if (!comment) {
                return sendError(res, 404, 'Comment not found');
            }
            sendJSON(res, 200, { comment });
        },
    });

    routes.push({
        method: 'DELETE',
        pattern: commentDetailPattern,
        handler: async (_req, res, match) => {
            const wsId = decodeURIComponent(match![1]);
            const canvasId = decodeURIComponent(match![2]);
            const commentId = decodeURIComponent(match![3]);
            if (!isValidCanvasId(canvasId)) {
                return sendError(res, 400, 'Invalid canvas ID');
            }
            if (!store.deleteComment(wsId, canvasId, commentId)) {
                return sendError(res, 404, 'Comment not found');
            }
            sendJSON(res, 200, { deleted: true });
        },
    });

    routes.push({
        method: 'GET',
        pattern: extensionPattern,
        handler: async (_req, res, match) => {
            const wsId = decodeURIComponent(match![1]);
            const canvasId = decodeURIComponent(match![2]);
            if (!isValidCanvasId(canvasId)) {
                return sendError(res, 400, 'Invalid canvas ID');
            }
            const extension = store.getExtension(wsId, canvasId);
            if (!extension) {
                return sendError(res, 404, 'Canvas extension not found');
            }
            sendJSON(res, 200, { extension });
        },
    });

    routes.push({
        method: 'POST',
        pattern: capabilityPattern,
        handler: async (req, res, match) => {
            const wsId = decodeURIComponent(match![1]);
            const canvasId = decodeURIComponent(match![2]);
            const capability = decodeURIComponent(match![3]);
            if (!isValidCanvasId(canvasId)) {
                return sendError(res, 400, 'Invalid canvas ID');
            }
            if (!isValidCapabilityName(capability)) {
                return sendError(res, 400, 'Invalid capability name');
            }

            let body: { params?: unknown };
            try {
                body = await parseBody(req) as { params?: unknown };
            } catch {
                return sendError(res, 400, 'Invalid JSON body');
            }

            const canvas = store.getCanvas(wsId, canvasId);
            if (!canvas || canvas.type !== 'extension') {
                return sendError(res, 404, 'Extension canvas not found');
            }
            const extension = store.getExtension(wsId, canvasId);
            if (!extension) {
                return sendError(res, 404, 'Canvas extension not found');
            }

            const run = runCanvasCapability(extension.capabilitiesJs, capability, canvas.content, body.params);
            if (!run.ok) {
                return sendError(res, 422, run.error);
            }

            const result = store.updateCanvas(wsId, canvasId, {
                content: run.state,
                expectedRevision: canvas.revision,
                editor: 'user',
            });
            if (!result.ok) {
                // Concurrent edit between read and write — caller retries with fresh state
                return sendJSON(res, 409, { error: 'revision-conflict', canvas: store.getCanvas(wsId, canvasId) });
            }

            broadcastCanvasUpdated(wsId, result.canvas, 'user');
            sendJSON(res, 200, { canvas: result.canvas });
        },
    });

    // AC-02 — run a Kusto canvas's query server-side (no AI turn). Gated on the
    // Kusto feature flag so the route is unreachable when disabled (AC-08).
    routes.push({
        method: 'POST',
        pattern: runPattern,
        handler: async (req, res, match) => {
            if (!getKustoEnabled?.()) {
                return sendError(res, 404, 'Not found');
            }
            const wsId = decodeURIComponent(match![1]);
            const canvasId = decodeURIComponent(match![2]);
            if (!isValidCanvasId(canvasId)) {
                return sendError(res, 400, 'Invalid canvas ID');
            }

            let body: { query?: string; clusterUrl?: string; database?: string };
            try {
                body = (await parseBody(req)) as { query?: string; clusterUrl?: string; database?: string };
            } catch {
                return sendError(res, 400, 'Invalid JSON body');
            }

            const overrides: { query?: string; clusterUrl?: string; database?: string } = {};
            if (typeof body.query === 'string') overrides.query = body.query;
            if (typeof body.clusterUrl === 'string') overrides.clusterUrl = body.clusterUrl;
            if (typeof body.database === 'string') overrides.database = body.database;

            const outcome = await runKustoCanvas(store, wsId, canvasId, {
                overrides,
                editor: 'user',
                ...(kustoClientFactory ? { clientFactory: kustoClientFactory } : {}),
            });

            if (!outcome.ok) {
                if (outcome.reason === 'not-found') {
                    return sendError(res, 404, 'Kusto canvas not found');
                }
                if (outcome.reason === 'wrong-type') {
                    return sendError(res, 400, 'Canvas is not a Kusto canvas');
                }
                return sendError(res, 500, `Failed to persist run: ${outcome.error}`);
            }

            broadcastCanvasUpdated(wsId, outcome.canvas, 'user');
            sendJSON(res, 200, { canvas: outcome.canvas });
        },
    });
}
