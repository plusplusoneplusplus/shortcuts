import { sendJSON, sendError, parseBody } from '../core/api-handler';
import type { Route } from '../types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import { CanvasStore, isValidCanvasId } from './canvas-store';
import type { CanvasEdit, CanvasCommentStatus } from './canvas-store';
import { createCanvasUpdateNotifier } from './canvas-update-notifier';
import { CanvasMutationService } from './canvas-mutation-service';
import type { OwnerScriptRunner } from '../executors/owner-script-runner';

const listPattern = /^\/api\/workspaces\/([^/]+)\/canvases$/;
const detailPattern = /^\/api\/workspaces\/([^/]+)\/canvases\/([^/]+)$/;
const versionsPattern = /^\/api\/workspaces\/([^/]+)\/canvases\/([^/]+)\/versions$/;
const versionDetailPattern = /^\/api\/workspaces\/([^/]+)\/canvases\/([^/]+)\/versions\/(\d+)$/;
const commentsPattern = /^\/api\/workspaces\/([^/]+)\/canvases\/([^/]+)\/comments$/;
const commentDetailPattern = /^\/api\/workspaces\/([^/]+)\/canvases\/([^/]+)\/comments\/([^/]+)$/;
const runPattern = /^\/api\/workspaces\/([^/]+)\/canvases\/([^/]+)\/run$/;
/** The trailing group is a whole relative path, so it deliberately spans `/`. */

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
    /** Internal owner runner for built-in Kusto Run; independent of optional canvas script flags. */
    getOwnerScriptRunner?: () => OwnerScriptRunner | undefined,
): CanvasMutationService {
    const store = new CanvasStore(dataDir);

    // One notifier, one mutation service: every canvas write in this file goes
    // through `mutations`, and every success it returns has already announced
    // itself on both realtime channels. No route emits an event on its own.
    const mutations = new CanvasMutationService({
        store,
        notifier: createCanvasUpdateNotifier({
            ...(getWsServer ? { getWsServer } : {}),
            ...(processStore ? { processStore } : {}),
        }),
        getOwnerScriptRunner, processStore, getKustoEnabled,
    });

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
            const canvas = mutations.createKustoCanvas(wsId, {
                title: typeof body.title === 'string' && body.title.trim() ? body.title : 'Kusto Query',
                content: body.content,
                ...(typeof body.processId === 'string' ? { processId: body.processId } : {}),
            });
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

            const outcome = mutations.saveCanvas(wsId, canvasId, {
                content: body.content,
                edits: body.edits,
                expectedRevision: body.expectedRevision,
                title: body.title,
            });

            if (outcome.kind === 'not-found') {
                return sendError(res, 404, 'Canvas not found');
            }
            if (outcome.kind === 'revision-conflict') {
                return sendJSON(res, 409, {
                    error: 'revision-conflict',
                    currentRevision: outcome.currentRevision,
                    canvas: outcome.canvas,
                });
            }
            if (outcome.kind === 'invalid') {
                return sendError(res, 400, outcome.error);
            }

            sendJSON(res, 200, { canvas: outcome.canvas });
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

            const controller = new AbortController();
            const cancel = () => controller.abort(new Error('Kusto run request disconnected'));
            res.once('close', cancel);
            let outcome;
            try {
                outcome = await mutations.runKusto(wsId, canvasId, overrides, controller.signal);
            } finally {
                res.off('close', cancel);
            }

            if (outcome.kind === 'not-found') {
                return sendError(res, 404, 'Kusto canvas not found');
            }
            if (outcome.kind === 'wrong-type') {
                return sendError(res, 400, 'Canvas is not a Kusto canvas');
            }
            if (outcome.kind === 'revision-conflict') {
                return sendJSON(res, 409, {
                    error: 'revision-conflict',
                    currentRevision: outcome.currentRevision,
                    canvas: outcome.canvas,
                });
            }
            if (outcome.kind === 'persist-failed') {
                return sendError(res, 500, `Failed to persist run: ${outcome.error}`);
            }

            sendJSON(res, 200, { canvas: outcome.canvas });
        },
    });
    return mutations;
}
