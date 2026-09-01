/**
 * HTTP API routes for cron management: CRUD, pause/resume/cancel.
 * Workspace-scoped primary routes at `/api/workspaces/:id/crons`,
 * secondary server-wide route at `/api/crons`.
 */

import type * as http from 'http';
import { sendJSON, sendError } from '../core/api-handler';
import { parseBodyOrReject } from '../shared/handler-utils';
import { logAutomationScopeMismatch } from '../shared/automation-scope';
import type { Route } from '../types';
import type { CronStore } from './cron-store';
import type { CronExecutor, CronEventEmit } from './cron-executor';
import type { CronEntry, CronStatus, CronChangeEvent } from './cron-types';

// ============================================================================
// Types
// ============================================================================

export interface CronRouteContext {
    store: CronStore;
    executor: CronExecutor;
    /** Optional WebSocket emitter for broadcasting cron state changes. */
    emit?: CronEventEmit;
    /**
     * Resolve a process (conversation) ID to its owning workspace. Used as the
     * compatibility path for legacy cron rows created before `workspaceId` was
     * persisted: ownership is derived from the cron's process and backfilled.
     * When omitted, legacy rows without a `workspaceId` are treated as
     * unowned and are unreachable through workspace-scoped item routes.
     */
    resolveWorkspaceId?: (processId: string) => Promise<string | undefined>;
}

/**
 * Resolve a cron by ID, returning it only when it belongs to the requested
 * workspace. Returns `null` (→ 404) for unknown crons and for crons owned by a
 * different workspace, logging a structured warning in the mismatch case.
 *
 * Legacy rows without a persisted `workspaceId` are resolved from their process
 * via `resolveWorkspaceId`; on a match the ownership is backfilled and persisted
 * before the caller mutates the record.
 */
export async function resolveCronForWorkspace(
    ctx: CronRouteContext,
    workspaceId: string,
    cronId: string,
): Promise<CronEntry | null> {
    const cron = ctx.store.getById(cronId);
    if (!cron) return null;

    if (cron.workspaceId != null) {
        if (cron.workspaceId === workspaceId) return cron;
        logAutomationScopeMismatch('cron', cronId, workspaceId, cron.workspaceId);
        return null;
    }

    // Legacy row without a persisted workspaceId — derive ownership from the
    // process record, then backfill so future scope checks are direct.
    if (ctx.resolveWorkspaceId) {
        const resolved = await ctx.resolveWorkspaceId(cron.processId);
        if (resolved === workspaceId) {
            cron.workspaceId = workspaceId;
            ctx.store.update(cron);
            return cron;
        }
        logAutomationScopeMismatch('cron', cronId, workspaceId, resolved);
        return null;
    }

    logAutomationScopeMismatch('cron', cronId, workspaceId, undefined);
    return null;
}

function safeEmit(emit: CronEventEmit | undefined, event: CronChangeEvent): void {
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

function serializeCron(cron: CronEntry): Record<string, unknown> {
    return {
        id: cron.id,
        processId: cron.processId,
        description: cron.description,
        intervalMs: cron.intervalMs,
        status: cron.status,
        createdAt: cron.createdAt,
        lastTickAt: cron.lastTickAt,
        nextTickAt: cron.nextTickAt,
        tickCount: cron.tickCount,
        consecutiveFailures: cron.consecutiveFailures,
        expiresAt: cron.expiresAt,
        pausedReason: cron.pausedReason,
        prompt: cron.prompt,
        model: cron.model,
        ...(cron.workspaceId != null ? { workspaceId: cron.workspaceId } : {}),
    };
}

// ============================================================================
// Validation
// ============================================================================

const VALID_STATUSES: ReadonlySet<string> = new Set<CronStatus>(['active', 'paused', 'cancelled', 'expired']);

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

export function registerCronRoutes(routes: Route[], ctx: CronRouteContext): void {
    const { store, executor, emit } = ctx;

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/crons — List crons for a workspace
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/crons$/,
        handler: async (_req: http.IncomingMessage, res: http.ServerResponse, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const crons = store.getByWorkspace(workspaceId);
            sendJSON(res, 200, { crons: crons.map(serializeCron) });
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/crons/:cronId — Get single cron
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/crons\/([^/]+)$/,
        handler: async (_req: http.IncomingMessage, res: http.ServerResponse, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const cronId = decodeURIComponent(match![2]);
            const cron = await resolveCronForWorkspace(ctx, workspaceId, cronId);
            if (!cron) {
                return sendError(res, 404, 'Cron not found');
            }
            sendJSON(res, 200, { cron: serializeCron(cron) });
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/workspaces/:id/crons/:cronId — Update a cron
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/crons\/([^/]+)$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const cronId = decodeURIComponent(match![2]);
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const validation = validatePatchFields(body);
            if (!validation.valid) {
                return sendError(res, 400, validation.error!);
            }

            const cron = await resolveCronForWorkspace(ctx, workspaceId, cronId);
            if (!cron) {
                return sendError(res, 404, 'Cron not found');
            }

            // Apply patch fields
            if (body.description !== undefined) cron.description = body.description as string;
            if (body.prompt !== undefined) cron.prompt = body.prompt as string;
            if (body.intervalMs !== undefined) cron.intervalMs = body.intervalMs as number;
            if (body.model !== undefined) cron.model = (body.model as string) || null;

            store.update(cron);
            safeEmit(emit, { type: 'cron-updated', cron });
            sendJSON(res, 200, { cron: serializeCron(cron) });
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/workspaces/:id/crons/:cronId — Cancel & delete
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/crons\/([^/]+)$/,
        handler: async (_req: http.IncomingMessage, res: http.ServerResponse, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const cronId = decodeURIComponent(match![2]);
            const cron = await resolveCronForWorkspace(ctx, workspaceId, cronId);
            if (!cron) {
                return sendError(res, 404, 'Cron not found');
            }

            executor.disarmTimer(cronId);
            cron.status = 'cancelled';
            cron.nextTickAt = null;
            store.update(cron);
            safeEmit(emit, { type: 'cron-cancelled', cron });

            sendJSON(res, 200, { deleted: true, cron: serializeCron(cron) });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/crons/:cronId/pause — Pause a cron
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/crons\/([^/]+)\/pause$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const cronId = decodeURIComponent(match![2]);
            const cron = await resolveCronForWorkspace(ctx, workspaceId, cronId);
            if (!cron) {
                return sendError(res, 404, 'Cron not found');
            }
            if (cron.status !== 'active') {
                return sendError(res, 400, `Cannot pause cron in status: ${cron.status}`);
            }

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const reason = typeof body.reason === 'string' ? body.reason : 'user-paused';

            executor.disarmTimer(cronId);
            cron.status = 'paused';
            cron.pausedReason = reason;
            cron.nextTickAt = null;
            store.update(cron);
            safeEmit(emit, { type: 'cron-paused', cron });

            sendJSON(res, 200, { cron: serializeCron(cron) });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/crons/:cronId/resume — Resume a cron
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/crons\/([^/]+)\/resume$/,
        handler: async (_req: http.IncomingMessage, res: http.ServerResponse, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const cronId = decodeURIComponent(match![2]);
            const cron = await resolveCronForWorkspace(ctx, workspaceId, cronId);
            if (!cron) {
                return sendError(res, 404, 'Cron not found');
            }
            if (cron.status !== 'paused') {
                return sendError(res, 400, `Cannot resume cron in status: ${cron.status}`);
            }

            // Check TTL — don't resume expired crons
            if (Date.now() >= new Date(cron.expiresAt).getTime()) {
                cron.status = 'expired';
                cron.nextTickAt = null;
                store.update(cron);
                safeEmit(emit, { type: 'cron-expired', cron });
                return sendError(res, 400, 'Cron has expired and cannot be resumed');
            }

            cron.status = 'active';
            cron.pausedReason = null;
            cron.consecutiveFailures = 0;
            cron.nextTickAt = new Date(Date.now() + cron.intervalMs).toISOString();
            store.update(cron);
            executor.armTimer(cron);
            safeEmit(emit, { type: 'cron-resumed', cron });

            sendJSON(res, 200, { cron: serializeCron(cron) });
        },
    });

    // ==================================================================
    // Server-wide routes (no workspace scope)
    // ==================================================================

    // ------------------------------------------------------------------
    // GET /api/crons — List all crons server-wide
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/crons$/,
        handler: async (_req: http.IncomingMessage, res: http.ServerResponse) => {
            const crons = store.getAll();
            sendJSON(res, 200, { crons: crons.map(serializeCron) });
        },
    });

    // ------------------------------------------------------------------
    // GET /api/crons/:cronId — Get a cron by ID (server-wide)
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/crons\/([^/]+)$/,
        handler: async (_req: http.IncomingMessage, res: http.ServerResponse, match) => {
            const cronId = decodeURIComponent(match![1]);
            const cron = store.getById(cronId);
            if (!cron) {
                return sendError(res, 404, 'Cron not found');
            }
            sendJSON(res, 200, { cron: serializeCron(cron) });
        },
    });
}
