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
 *   GET    /api/workspaces/:wsId/canvases/:canvasId/files         — list the canvas's readable files
 *   GET    /api/workspaces/:wsId/canvases/:canvasId/files/<path>  — read one file (?encoding=base64 to force bytes)
 *   POST   /api/workspaces/:wsId/canvases/:canvasId/capabilities/:name — invoke a capability against the shared state
 *
 * User saves broadcast a `canvas-updated` WebSocket event so other dashboard
 * tabs can refresh. Revision conflicts return 409 with the current record so
 * the client can offer a reload.
 *
 * Capability invocations are SERIALIZED PER CANVAS and re-read the canvas
 * inside the critical section, so two concurrent invocations both land instead
 * of one losing its revision check. A capability the manifest declares
 * `async: true` additionally requires the `features.canvasHostApis` flag; with
 * it off that capability 404s and sync capabilities are unaffected.
 */

import { sendJSON, sendError, parseBody } from '../core/api-handler';
import type { Route } from '../types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import { emitCanvasUpdated } from '../streaming/sse-handler';
import { CanvasStore, isValidCanvasId, isSafeCanvasFilePath, hasEncodedPathEscape } from './canvas-store';
import type { CanvasEdit, CanvasCommentStatus, CanvasRecord, CanvasExtensionManifest } from './canvas-store';
import { runCanvasCapability, isValidCapabilityName } from './canvas-capability-runner';
import type { CapabilityCompleteFn } from './canvas-capability-runner';
import { queueCanvasCapabilityRun } from './canvas-capability-queue';
import { createCanvasCompleteFn } from './canvas-capability-completion';
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
const filesPattern = /^\/api\/workspaces\/([^/]+)\/canvases\/([^/]+)\/files$/;
/** The trailing group is a whole relative path, so it deliberately spans `/`. */
const fileDetailPattern = /^\/api\/workspaces\/([^/]+)\/canvases\/([^/]+)\/files\/(.+)$/;

const COMMENT_STATUSES: readonly CanvasCommentStatus[] = ['open', 'sent', 'resolved'];

/**
 * Whether the manifest declares this capability async. A manifest with no
 * matching entry — or none at all, which every extension written before
 * capability metadata was required looks like — is sync, the legacy path.
 */
function isAsyncCapability(manifest: CanvasExtensionManifest | undefined, capability: string): boolean {
    return manifest?.capabilities?.some(meta => meta?.name === capability && meta.async === true) === true;
}

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
    /**
     * Live gate for the canvas host APIs — async capabilities and the
     * `host.complete` they get access to. When it returns false an invocation
     * of a capability declared `async: true` 404s, exactly as if the feature had
     * never been built. Sync capabilities are untouched by it.
     */
    getCanvasHostApisEnabled?: () => boolean,
    /**
     * Injectable `host.complete` implementation. Overridden in tests so a
     * capability run never reaches a real model.
     */
    completeFactory?: (attribution: { workspaceId: string; canvasId: string; capability: string; processId?: string }) => CapabilityCompleteFn,
): void {
    const store = new CanvasStore(dataDir);

    /** Real `host.complete`: the one-shot AI invoker, bound to who asked for it. */
    const defaultCompleteFactory = (attribution: { workspaceId: string; canvasId: string; capability: string; processId?: string }): CapabilityCompleteFn =>
        createCanvasCompleteFn(dataDir, attribution);

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

    // Read-only canvas files. The scope is the canvas's OWN `files/` directory —
    // not the workspace repo, not the machine — which is what an artifact
    // actually needs: the data it was given. There is deliberately no write
    // route; the canvas state is the write channel, and it is revision-checked
    // and version-snapshotted in a way a file write would not be.
    routes.push({
        method: 'GET',
        pattern: filesPattern,
        handler: async (_req, res, match) => {
            const wsId = decodeURIComponent(match![1]);
            const canvasId = decodeURIComponent(match![2]);
            if (!isValidCanvasId(canvasId)) {
                return sendError(res, 400, 'Invalid canvas ID');
            }
            if (!store.getCanvas(wsId, canvasId)) {
                return sendError(res, 404, 'Canvas not found');
            }
            sendJSON(res, 200, { files: store.listCanvasFiles(wsId, canvasId) });
        },
    });

    routes.push({
        method: 'GET',
        pattern: fileDetailPattern,
        handler: async (req, res, match) => {
            const wsId = decodeURIComponent(match![1]);
            const canvasId = decodeURIComponent(match![2]);
            if (!isValidCanvasId(canvasId)) {
                return sendError(res, 400, 'Invalid canvas ID');
            }

            // The router matches on the RAW (still percent-encoded) pathname, so
            // the check runs on both forms: the raw one refuses `%2e%2e` before
            // it can decode into `..` (and `%252e%252e` before it decodes into
            // `%2e%2e`), the decoded one refuses a literal `..` that was never
            // encoded at all. A path that will not decode is malformed, not
            // merely missing. The store repeats the decoded check — this is not
            // the only caller, and it must not be the only guard.
            const rawPath = match![3];
            if (hasEncodedPathEscape(rawPath)) {
                return sendError(res, 400, 'Invalid file path');
            }
            let filePath: string;
            try {
                filePath = decodeURIComponent(rawPath);
            } catch {
                return sendError(res, 400, 'Invalid file path');
            }
            if (!isSafeCanvasFilePath(filePath)) {
                return sendError(res, 400, 'Invalid file path');
            }

            const encodingParam = new URL(req.url!, 'http://x').searchParams.get('encoding');
            // Only base64 may be forced. Forcing utf-8 onto real bytes hands back
            // silent mojibake, so it is rejected rather than honoured.
            if (encodingParam !== null && encodingParam !== 'base64') {
                return sendError(res, 400, 'encoding must be "base64" when provided');
            }

            const result = store.readCanvasFile(
                wsId,
                canvasId,
                filePath,
                encodingParam === 'base64' ? { encoding: 'base64' } : undefined,
            );
            if (!result.ok) {
                if (result.reason === 'invalid-path') {
                    return sendError(res, 400, 'Invalid file path');
                }
                if (result.reason === 'too-large') {
                    return sendError(res, 413, `File is ${result.size} bytes, over the ${result.limit} byte limit`);
                }
                return sendError(res, 404, 'Canvas file not found');
            }
            sendJSON(res, 200, { file: result.file });
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
            // Fail the flag check before queueing, so a request that can never
            // succeed does not wait behind a 30 s run to be told so.
            if (isAsyncCapability(extension.manifest, capability) && !getCanvasHostApisEnabled?.()) {
                return sendError(res, 404, 'Not found');
            }

            // Serialize per canvas. The read-modify-write below races rarely at
            // the sync path's 1 s budget and reliably at the async path's 30 s,
            // and the re-read INSIDE the critical section is what makes run N+1
            // start from run N's output instead of losing to its revision check.
            const outcome = await queueCanvasCapabilityRun(wsId, canvasId, async () => {
                const fresh = store.getCanvas(wsId, canvasId);
                const freshExtension = store.getExtension(wsId, canvasId);
                if (!fresh || fresh.type !== 'extension' || !freshExtension) {
                    return { kind: 'gone' } as const;
                }
                const isAsync = isAsyncCapability(freshExtension.manifest, capability);
                if (isAsync && !getCanvasHostApisEnabled?.()) {
                    return { kind: 'disabled' } as const;
                }

                const run = await runCanvasCapability(
                    freshExtension.capabilitiesJs,
                    capability,
                    fresh.content,
                    body.params,
                    isAsync
                        ? {
                            async: true,
                            complete: (completeFactory ?? defaultCompleteFactory)({
                                workspaceId: wsId,
                                canvasId,
                                capability,
                                ...(fresh.processId ? { processId: fresh.processId } : {}),
                            }),
                        }
                        : undefined,
                );
                if (!run.ok) {
                    return { kind: 'run-error', error: run.error } as const;
                }

                const result = store.updateCanvas(wsId, canvasId, {
                    content: run.state,
                    expectedRevision: fresh.revision,
                    editor: 'user',
                });
                if (!result.ok) {
                    // A user save landed while the capability ran — caller retries with fresh state.
                    return { kind: 'conflict' } as const;
                }
                return { kind: 'ok', canvas: result.canvas } as const;
            });

            if (outcome.kind === 'gone') {
                return sendError(res, 404, 'Extension canvas not found');
            }
            if (outcome.kind === 'disabled') {
                return sendError(res, 404, 'Not found');
            }
            if (outcome.kind === 'run-error') {
                return sendError(res, 422, outcome.error);
            }
            if (outcome.kind === 'conflict') {
                return sendJSON(res, 409, { error: 'revision-conflict', canvas: store.getCanvas(wsId, canvasId) });
            }

            broadcastCanvasUpdated(wsId, outcome.canvas, 'user');
            sendJSON(res, 200, { canvas: outcome.canvas });
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
