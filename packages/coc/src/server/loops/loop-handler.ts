/**
 * Loop REST API Handler
 *
 * HTTP API routes for loop management: CRUD, pause/resume/cancel.
 * Workspace-scoped primary routes at `/api/workspaces/:id/loops`,
 * secondary server-wide route at `/api/loops`.
 *
 * Pure Node.js; uses only built-in modules.
 */

import type * as http from 'http';
import { sendJSON, sendError } from '../core/api-handler';
import { parseBodyOrReject } from '../shared/handler-utils';
import type { Route } from '../types';
import type { LoopStore } from './loop-store';
import type { LoopExecutor, LoopEventEmit } from './loop-executor';
import type { LoopEntry, LoopStatus, LoopChangeEvent } from './loop-types';

// ============================================================================
// Types
// ============================================================================

export interface LoopRouteContext {
    store: LoopStore;
    executor: LoopExecutor;
    /** Optional WebSocket emitter for broadcasting loop state changes. */
    emit?: LoopEventEmit;
}

function safeEmit(emit: LoopEventEmit | undefined, event: LoopChangeEvent): void {
    if (!emit) return;
    try {
        emit(event);
    } catch {
        // Best-effort broadcast — never fail the REST response.
    }
}

// ============================================================================
// Serialisation
// ============================================================================

function serializeLoop(loop: LoopEntry): Record<string, unknown> {
    return {
        id: loop.id,
        processId: loop.processId,
        description: loop.description,
        intervalMs: loop.intervalMs,
        status: loop.status,
        createdAt: loop.createdAt,
        lastTickAt: loop.lastTickAt,
        nextTickAt: loop.nextTickAt,
        tickCount: loop.tickCount,
        consecutiveFailures: loop.consecutiveFailures,
        expiresAt: loop.expiresAt,
        pausedReason: loop.pausedReason,
        prompt: loop.prompt,
        model: loop.model,
        ...(loop.workspaceId != null ? { workspaceId: loop.workspaceId } : {}),
    };
}

// ============================================================================
// Validation
// ============================================================================

const VALID_STATUSES: ReadonlySet<string> = new Set<LoopStatus>(['active', 'paused', 'cancelled', 'expired']);

function validatePatchFields(body: Record<string, unknown>): { valid: boolean; error?: string } {
    if (body.status !== undefined) {
        if (typeof body.status !== 'string' || !VALID_STATUSES.has(body.status)) {
            return { valid: false, error: `Invalid status: ${body.status}. Valid values: active, paused, cancelled, expired` };
        }
    }
    if (body.intervalMs !== undefined) {
        if (typeof body.intervalMs !== 'number' || body.intervalMs < 10_000) {
            return { valid: false, error: 'intervalMs must be a number ≥ 10000' };
        }
    }
    if (body.description !== undefined && typeof body.description !== 'string') {
        return { valid: false, error: 'description must be a string' };
    }
    if (body.prompt !== undefined) {
        if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
            return { valid: false, error: 'prompt must be a non-empty string' };
        }
    }
    return { valid: true };
}

// ============================================================================
// Route Registration
// ============================================================================

export function registerLoopRoutes(routes: Route[], ctx: LoopRouteContext): void {
    const { store, executor, emit } = ctx;

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/loops — List loops for a workspace
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/loops$/,
        handler: async (_req: http.IncomingMessage, res: http.ServerResponse, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const loops = store.getByWorkspace(workspaceId);
            sendJSON(res, 200, { loops: loops.map(serializeLoop) });
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/loops/:loopId — Get single loop
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/loops\/([^/]+)$/,
        handler: async (_req: http.IncomingMessage, res: http.ServerResponse, match) => {
            const loopId = decodeURIComponent(match![2]);
            const loop = store.getById(loopId);
            if (!loop) {
                return sendError(res, 404, 'Loop not found');
            }
            sendJSON(res, 200, { loop: serializeLoop(loop) });
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/workspaces/:id/loops/:loopId — Update a loop
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/loops\/([^/]+)$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match) => {
            const loopId = decodeURIComponent(match![2]);
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const validation = validatePatchFields(body);
            if (!validation.valid) {
                return sendError(res, 400, validation.error!);
            }

            const loop = store.getById(loopId);
            if (!loop) {
                return sendError(res, 404, 'Loop not found');
            }

            // Apply patch fields
            if (body.description !== undefined) loop.description = body.description as string;
            if (body.prompt !== undefined) loop.prompt = body.prompt as string;
            if (body.intervalMs !== undefined) loop.intervalMs = body.intervalMs as number;
            if (body.model !== undefined) loop.model = (body.model as string) || null;

            store.update(loop);
            safeEmit(emit, { type: 'loop-updated', loop });
            sendJSON(res, 200, { loop: serializeLoop(loop) });
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/workspaces/:id/loops/:loopId — Cancel & delete
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/loops\/([^/]+)$/,
        handler: async (_req: http.IncomingMessage, res: http.ServerResponse, match) => {
            const loopId = decodeURIComponent(match![2]);
            const loop = store.getById(loopId);
            if (!loop) {
                return sendError(res, 404, 'Loop not found');
            }

            executor.disarmTimer(loopId);
            loop.status = 'cancelled';
            loop.nextTickAt = null;
            store.update(loop);
            safeEmit(emit, { type: 'loop-cancelled', loop });

            sendJSON(res, 200, { deleted: true, loop: serializeLoop(loop) });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/loops/:loopId/pause — Pause a loop
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/loops\/([^/]+)\/pause$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match) => {
            const loopId = decodeURIComponent(match![2]);
            const loop = store.getById(loopId);
            if (!loop) {
                return sendError(res, 404, 'Loop not found');
            }
            if (loop.status !== 'active') {
                return sendError(res, 400, `Cannot pause loop in status: ${loop.status}`);
            }

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const reason = typeof body.reason === 'string' ? body.reason : 'user-paused';

            executor.disarmTimer(loopId);
            loop.status = 'paused';
            loop.pausedReason = reason;
            loop.nextTickAt = null;
            store.update(loop);
            safeEmit(emit, { type: 'loop-paused', loop });

            sendJSON(res, 200, { loop: serializeLoop(loop) });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/loops/:loopId/resume — Resume a loop
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/loops\/([^/]+)\/resume$/,
        handler: async (_req: http.IncomingMessage, res: http.ServerResponse, match) => {
            const loopId = decodeURIComponent(match![2]);
            const loop = store.getById(loopId);
            if (!loop) {
                return sendError(res, 404, 'Loop not found');
            }
            if (loop.status !== 'paused') {
                return sendError(res, 400, `Cannot resume loop in status: ${loop.status}`);
            }

            // Check TTL — don't resume expired loops
            if (Date.now() >= new Date(loop.expiresAt).getTime()) {
                loop.status = 'expired';
                loop.nextTickAt = null;
                store.update(loop);
                safeEmit(emit, { type: 'loop-expired', loop });
                return sendError(res, 400, 'Loop has expired and cannot be resumed');
            }

            loop.status = 'active';
            loop.pausedReason = null;
            loop.consecutiveFailures = 0;
            loop.nextTickAt = new Date(Date.now() + loop.intervalMs).toISOString();
            store.update(loop);
            executor.armTimer(loop);
            safeEmit(emit, { type: 'loop-resumed', loop });

            sendJSON(res, 200, { loop: serializeLoop(loop) });
        },
    });

    // ==================================================================
    // Server-wide routes (no workspace scope)
    // ==================================================================

    // ------------------------------------------------------------------
    // GET /api/loops — List all loops server-wide
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/loops$/,
        handler: async (_req: http.IncomingMessage, res: http.ServerResponse) => {
            const loops = store.getAll();
            sendJSON(res, 200, { loops: loops.map(serializeLoop) });
        },
    });

    // ------------------------------------------------------------------
    // GET /api/loops/:loopId — Get a loop by ID (server-wide)
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/loops\/([^/]+)$/,
        handler: async (_req: http.IncomingMessage, res: http.ServerResponse, match) => {
            const loopId = decodeURIComponent(match![1]);
            const loop = store.getById(loopId);
            if (!loop) {
                return sendError(res, 404, 'Loop not found');
            }
            sendJSON(res, 200, { loop: serializeLoop(loop) });
        },
    });
}
