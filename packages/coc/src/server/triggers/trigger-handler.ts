/**
 * HTTP API routes for the generic `event → action` trigger framework.
 * Workspace-scoped primary routes at `/api/workspaces/:id/triggers`, plus a
 * secondary server-wide route at `/api/triggers`.
 *
 * Mirrors `cron-handler.ts` (same in-process route shape, validation, and
 * best-effort emit). These routes manage CI monitors. Bound Sentinel To-do
 * rules use their own owner/process-scoped routes and shared authoring service.
 */

import type * as http from 'http';
import { sendJSON, sendError } from '../core/api-handler';
import { parseBodyOrReject } from '../shared/handler-utils';
import { logAutomationScopeMismatch } from '../shared/automation-scope';
import type { Route } from '../types';
import type { TriggerStore } from './trigger-store';
import type { TriggerEventEmit } from './trigger-manager';
import type {
    Trigger,
    TriggerEvent,
    TriggerChangeEvent,
} from './trigger-types';
import { DEFAULT_CI_POLL_INTERVAL_MS, isTriggerExpired } from './trigger-types';
import { createTrigger, CreateTriggerError, type CreateTriggerContext } from './create-trigger-service';
export { validateCreateTriggerBody, buildTriggerFromCreateRequest, type CreateTriggerValidation } from './create-trigger-service';

// ============================================================================
// Types
// ============================================================================

export type TriggerRouteContext = CreateTriggerContext;

/**
 * Resolve a trigger by ID, returning it only when it belongs to the requested
 * workspace. Returns `null` (→ 404) for unknown triggers and for triggers owned
 * by a different workspace, logging a structured warning on mismatch.
 */
export function resolveTriggerForWorkspace(
    store: TriggerStore,
    workspaceId: string,
    triggerId: string,
): Trigger | null {
    const trigger = store.getById(triggerId);
    if (!trigger || trigger.binding?.removedAt) return null;
    if (trigger.workspaceId === workspaceId) return trigger;
    logAutomationScopeMismatch('trigger', triggerId, workspaceId, trigger.workspaceId);
    return null;
}

function safeEmit(emit: TriggerEventEmit | undefined, event: TriggerChangeEvent): void {
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

function serializeTrigger(trigger: Trigger): Record<string, unknown> {
    return {
        id: trigger.id,
        workspaceId: trigger.workspaceId,
        processId: trigger.processId,
        status: trigger.status,
        event: trigger.event,
        action: trigger.action,
        inFlight: trigger.inFlight,
        createdAt: trigger.createdAt,
        expiresAt: trigger.expiresAt,
        lastTickAt: trigger.lastTickAt,
        nextTickAt: trigger.nextTickAt,
        revision: trigger.revision,
        ...(trigger.binding ? { binding: trigger.binding } : {}),
        ...(trigger.outcome ? { outcome: trigger.outcome } : {}),
        ...(trigger.outcomeReason ? { outcomeReason: trigger.outcomeReason } : {}),
        ...(trigger.delivery ? { delivery: trigger.delivery } : {}),
    };
}

// ============================================================================
// Validation & construction
// ============================================================================

const VALID_PATCH_STATUSES = new Set(['active', 'paused', 'disarmed']);

// ============================================================================
// Route Registration
// ============================================================================

export function registerTriggerRoutes(routes: Route[], ctx: TriggerRouteContext): void {
    const { store, manager, emit } = ctx;
    const now = ctx.now ?? Date.now;

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/triggers — Create & arm a trigger
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/triggers$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            let trigger: Trigger;
            try {
                trigger = await createTrigger(ctx, workspaceId, body, true);
            } catch (err) {
                return sendError(res, err instanceof CreateTriggerError ? err.statusCode : 500,
                    err instanceof Error ? err.message : String(err));
            }
            sendJSON(res, 201, { trigger: serializeTrigger(trigger) });
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/triggers\/repair$/,
        handler: async (req, res, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const body = await parseBodyOrReject(req, res);
            if (!body) return;
            // Manual CI repair does not grant conflict authority or opt into polling.
            const event = body.event;
            if (!event || typeof event !== 'object' || Array.isArray(event)) return sendError(res, 400, 'event is required');
            try {
                const trigger = await createTrigger(ctx, workspaceId, {
                    ...body, event: { ...event, repairScope: 'ci' },
                }, true, false);
                await manager.repairNow(trigger.id);
                sendJSON(res, 200, { trigger: serializeTrigger(store.getById(trigger.id) ?? trigger) });
            } catch (error) {
                sendError(res, error instanceof CreateTriggerError ? error.statusCode : 409,
                    error instanceof Error ? error.message : String(error));
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/triggers — List triggers for a workspace
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/triggers$/,
        handler: async (_req: http.IncomingMessage, res: http.ServerResponse, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const triggers = store.getByWorkspace(workspaceId).filter(trigger => !trigger.binding);
            sendJSON(res, 200, { triggers: triggers.map(serializeTrigger) });
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/triggers/:triggerId — Get single trigger
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/triggers\/([^/]+)$/,
        handler: async (_req: http.IncomingMessage, res: http.ServerResponse, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const triggerId = decodeURIComponent(match![2]);
            const trigger = resolveTriggerForWorkspace(store, workspaceId, triggerId);
            if (!trigger || trigger.binding) {
                return sendError(res, 404, 'Trigger not found');
            }
            sendJSON(res, 200, { trigger: serializeTrigger(trigger) });
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/workspaces/:id/triggers/:triggerId — Update status
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/triggers\/([^/]+)$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const triggerId = decodeURIComponent(match![2]);
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (body.status === undefined) {
                return sendError(res, 400, 'status is required');
            }
            if (typeof body.status !== 'string' || !VALID_PATCH_STATUSES.has(body.status)) {
                return sendError(res, 400, `Invalid status: ${String(body.status)}. Valid values: active, paused, disarmed`);
            }

            const trigger = resolveTriggerForWorkspace(store, workspaceId, triggerId);
            if (!trigger) {
                return sendError(res, 404, 'Trigger not found');
            }

            const target = body.status as 'active' | 'paused' | 'disarmed';
            if (trigger.binding) {
                return sendError(res, 409, 'Use the owner-scoped Sentinel To-do trigger API');
            }
            trigger.revision += 1;

            if (target === 'paused') {
                manager.disarm(triggerId);
                trigger.status = 'paused';
                trigger.nextTickAt = null;
                store.update(trigger);
                safeEmit(emit, { type: 'trigger-paused', trigger });
            } else if (target === 'disarmed') {
                manager.disarm(triggerId);
                trigger.status = 'disarmed';
                trigger.nextTickAt = null;
                store.update(trigger);
                safeEmit(emit, { type: 'trigger-disarmed', trigger });
            } else {
                // Resume (→ active). Reject if the TTL already elapsed.
                if (isTriggerExpired(trigger, now())) {
                    manager.disarm(triggerId);
                    trigger.status = 'expired';
                    trigger.nextTickAt = null;
                    store.update(trigger);
                    safeEmit(emit, { type: 'trigger-expired', trigger });
                    return sendError(res, 400, 'Trigger has expired and cannot be resumed');
                }
                trigger.status = 'active';
                trigger.nextTickAt = new Date(now() + getPollInterval(trigger.event)).toISOString();
                store.update(trigger);
                manager.arm(trigger);
                safeEmit(emit, { type: 'trigger-updated', trigger });
            }
            sendJSON(res, 200, { trigger: serializeTrigger(trigger) });
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/workspaces/:id/triggers/:triggerId — Disarm & delete
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/triggers\/([^/]+)$/,
        handler: async (_req: http.IncomingMessage, res: http.ServerResponse, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const triggerId = decodeURIComponent(match![2]);
            const trigger = resolveTriggerForWorkspace(store, workspaceId, triggerId);
            if (!trigger) {
                return sendError(res, 404, 'Trigger not found');
            }
            if (trigger.binding) {
                return sendError(res, 409, 'Use the owner-scoped Sentinel To-do trigger API');
            }

            manager.disarm(triggerId);
            trigger.status = 'disarmed';
            trigger.revision += 1;
            trigger.nextTickAt = null;
            // Keep the writer receipt until a queued/running repair completes.
            if (trigger.inFlight) store.update(trigger);
            else store.delete(triggerId);
            safeEmit(emit, { type: 'trigger-disarmed', trigger });

            sendJSON(res, 200, { deleted: true, trigger: serializeTrigger(trigger) });
        },
    });

    // ==================================================================
    // Server-wide routes (no workspace scope)
    // ==================================================================

    // ------------------------------------------------------------------
    // GET /api/triggers — List all triggers server-wide
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/triggers$/,
        handler: async (_req: http.IncomingMessage, res: http.ServerResponse) => {
            const triggers = store.getAll().filter(trigger => !trigger.binding);
            sendJSON(res, 200, { triggers: triggers.map(serializeTrigger) });
        },
    });
}

// ============================================================================
// Helpers
// ============================================================================

function getPollInterval(event: TriggerEvent): number {
    if (event.type === 'condition-monitor') return event.pollIntervalMs;
    return DEFAULT_CI_POLL_INTERVAL_MS;
}
