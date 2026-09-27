/**
 * `POST /api/workspaces/:workspaceId/decisions/evaluate`
 *
 * Workspace-scoped: the workspace is resolved through the process store and its
 * root becomes the backend `cwd`. The request carries all decision state; this
 * route never reads repository files.
 */

import type * as http from 'http';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { Route } from '../types';
import { sendJSON } from '../core/api-handler';
import { APIError, handleAPIError, notFound } from '../errors';
import { DecisionBackendError } from './decision-backend';
import { DECISION_LIMITS } from './decision-validation';
import type { DecisionService } from './decision-service';

export interface DecisionRouteContext {
    routes: Route[];
    store: Pick<ProcessStore, 'getWorkspaces'>;
    service: DecisionService;
    maxBodyBytes?: number;
}

function tooLarge(limit: number): APIError {
    return new APIError(413, `Request body exceeds ${limit} bytes`, 'DECISION_REQUEST_TOO_LARGE');
}

/** Read a JSON body, rejecting with `413` past `limit` bytes (the shared `parseBody()` has no limit). */
function readLimitedJson(req: http.IncomingMessage, limit: number): Promise<unknown> {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
        req.resume();
        return Promise.reject(tooLarge(limit));
    }
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let exceeded = false;
        req.on('data', (chunk: Buffer) => {
            if (exceeded) return;
            size += chunk.length;
            if (size > limit) {
                exceeded = true;
                chunks.length = 0;
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (exceeded) {
                reject(tooLarge(limit));
                return;
            }
            const raw = Buffer.concat(chunks).toString('utf-8').trim();
            if (!raw) {
                reject(new APIError(400, 'Request body is required', 'DECISION_INVALID_REQUEST'));
                return;
            }
            try {
                resolve(JSON.parse(raw));
            } catch {
                reject(new APIError(400, 'Invalid JSON body', 'INVALID_JSON'));
            }
        });
        req.on('error', reject);
    });
}

export function registerDecisionRoutes(ctx: DecisionRouteContext): void {
    const maxBodyBytes = ctx.maxBodyBytes ?? DECISION_LIMITS.maxBodyBytes;

    ctx.routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/decisions\/evaluate$/,
        handler: async (req, res, match) => {
            const controller = new AbortController();
            res.on('close', () => {
                if (!res.writableFinished) controller.abort(new Error('Client disconnected'));
            });
            try {
                const workspaceId = decodeURIComponent(match![1]);
                const body = await readLimitedJson(req, maxBodyBytes);
                const workspace = (await ctx.store.getWorkspaces()).find(ws => ws.id === workspaceId);
                if (!workspace) throw notFound(`Workspace '${workspaceId}'`);

                const response = await ctx.service.evaluate(body, {
                    workspaceId,
                    workingDirectory: workspace.rootPath,
                    signal: controller.signal,
                });
                if (!controller.signal.aborted) sendJSON(res, 200, response);
            } catch (error) {
                if (controller.signal.aborted) return;
                handleAPIError(res, error instanceof DecisionBackendError
                    ? new APIError(error.status, error.message, error.code, error.details)
                    : error);
            }
        },
    });
}
