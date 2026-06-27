/**
 * Trigger REST API Handler
 *
 * HTTP API routes for the generic `event → action` trigger framework.
 * Workspace-scoped primary routes at `/api/workspaces/:id/triggers`, plus a
 * secondary server-wide route at `/api/triggers`.
 *
 * Mirrors `loop-handler.ts` (same in-process route shape, validation, and
 * best-effort emit). Only the `condition-monitor` / `ci-failure` event and the
 * `send-message` action are implemented this iteration.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 */

import * as crypto from 'crypto';
import type * as http from 'http';
import { sendJSON, sendError } from '../core/api-handler';
import { parseBodyOrReject } from '../shared/handler-utils';
import type { Route } from '../types';
import type { TriggerStore } from './trigger-store';
import type { TriggerManager, TriggerEventEmit } from './trigger-manager';
import type {
    Trigger,
    TriggerEvent,
    TriggerAction,
    TriggerChangeEvent,
} from './trigger-types';
import {
    DEFAULT_TRIGGER_TTL_MS,
    DEFAULT_CI_POLL_INTERVAL_MS,
    MIN_POLL_INTERVAL_MS,
} from './trigger-types';

// ============================================================================
// Types
// ============================================================================

export interface TriggerRouteContext {
    store: TriggerStore;
    manager: TriggerManager;
    /** Optional WebSocket emitter for broadcasting trigger state changes. */
    emit?: TriggerEventEmit;
    /**
     * Feature-flag gate (`triggers.enabled`). When false, mutating endpoints
     * (create) are rejected so the API is a no-op while the flag is off.
     */
    enabled: boolean;
    /** Clock injection for deterministic tests. Defaults to `Date.now`. */
    now?: () => number;
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
    };
}

// ============================================================================
// Validation & construction
// ============================================================================

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

export interface CreateTriggerValidation {
    valid: boolean;
    error?: string;
}

/**
 * Validate the body of a create-trigger request. Only the
 * `condition-monitor` / `ci-failure` event and `send-message` action are
 * accepted this iteration.
 */
export function validateCreateTriggerBody(body: Record<string, unknown>): CreateTriggerValidation {
    if (!isNonEmptyString(body.processId)) {
        return { valid: false, error: 'processId must be a non-empty string' };
    }

    const event = body.event as Record<string, unknown> | undefined;
    if (!event || typeof event !== 'object') {
        return { valid: false, error: 'event is required' };
    }
    if (event.type !== 'condition-monitor') {
        return { valid: false, error: `Unsupported event.type: ${String(event.type)}. Only 'condition-monitor' is supported` };
    }
    if (event.monitor !== 'ci-failure') {
        return { valid: false, error: `Unsupported event.monitor: ${String(event.monitor)}. Only 'ci-failure' is supported` };
    }
    if (!isNonEmptyString(event.originId)) {
        return { valid: false, error: 'event.originId must be a non-empty string' };
    }
    if (!isNonEmptyString(event.prId)) {
        return { valid: false, error: 'event.prId must be a non-empty string' };
    }
    if (event.pollIntervalMs !== undefined) {
        if (typeof event.pollIntervalMs !== 'number' || event.pollIntervalMs < MIN_POLL_INTERVAL_MS) {
            return { valid: false, error: `event.pollIntervalMs must be a number ≥ ${MIN_POLL_INTERVAL_MS}` };
        }
    }

    const action = body.action as Record<string, unknown> | undefined;
    if (action !== undefined) {
        if (typeof action !== 'object' || action === null) {
            return { valid: false, error: 'action must be an object' };
        }
        if (action.type !== undefined && action.type !== 'send-message') {
            return { valid: false, error: `Unsupported action.type: ${String(action.type)}. Only 'send-message' is supported` };
        }
        if (action.mode !== undefined && action.mode !== 'autopilot') {
            return { valid: false, error: `Unsupported action.mode: ${String(action.mode)}. Only 'autopilot' is supported` };
        }
        if (action.prompt !== undefined && typeof action.prompt !== 'string') {
            return { valid: false, error: 'action.prompt must be a string' };
        }
        if (action.processId !== undefined && !isNonEmptyString(action.processId)) {
            return { valid: false, error: 'action.processId must be a non-empty string' };
        }
    }

    return { valid: true };
}

/**
 * Build a full `Trigger` record from a validated create request. Exposed for
 * unit testing. Fills server-owned fields (id, status, timestamps, TTL,
 * suppression guard, and the initial `nextTickAt`).
 */
export function buildTriggerFromCreateRequest(
    workspaceId: string,
    body: Record<string, unknown>,
    now: () => number = Date.now,
): Trigger {
    const nowMs = now();
    const eventBody = body.event as Record<string, unknown>;
    const actionBody = (body.action as Record<string, unknown> | undefined) ?? {};

    const pollIntervalMs = typeof eventBody.pollIntervalMs === 'number'
        ? Math.max(MIN_POLL_INTERVAL_MS, eventBody.pollIntervalMs)
        : DEFAULT_CI_POLL_INTERVAL_MS;

    const processId = body.processId as string;

    const event: TriggerEvent = {
        type: 'condition-monitor',
        monitor: 'ci-failure',
        originId: eventBody.originId as string,
        prId: String(eventBody.prId),
        pollIntervalMs,
        lastSeenChecks: {},
    };

    const action: TriggerAction = {
        type: 'send-message',
        processId: isNonEmptyString(actionBody.processId) ? actionBody.processId : processId,
        prompt: typeof actionBody.prompt === 'string' ? actionBody.prompt : '',
        mode: 'autopilot',
    };

    return {
        id: `trigger_${crypto.randomUUID()}`,
        workspaceId,
        processId,
        status: 'active',
        event,
        action,
        inFlight: false,
        createdAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + DEFAULT_TRIGGER_TTL_MS).toISOString(),
        lastTickAt: null,
        nextTickAt: new Date(nowMs + pollIntervalMs).toISOString(),
    };
}

const VALID_PATCH_STATUSES = new Set(['active', 'paused', 'disarmed']);

// ============================================================================
// Route Registration
// ============================================================================

export function registerTriggerRoutes(routes: Route[], ctx: TriggerRouteContext): void {
    const { store, manager, emit, enabled } = ctx;
    const now = ctx.now ?? Date.now;

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/triggers — Create & arm a trigger
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/triggers$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match) => {
            if (!enabled) {
                return sendError(res, 403, 'Triggers are disabled (triggers.enabled is off)');
            }
            const workspaceId = decodeURIComponent(match![1]);
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const validation = validateCreateTriggerBody(body);
            if (!validation.valid) {
                return sendError(res, 400, validation.error!);
            }

            const trigger = buildTriggerFromCreateRequest(workspaceId, body, now);
            try {
                store.insert(trigger);
            } catch (err) {
                return sendError(res, 409, err instanceof Error ? err.message : String(err));
            }
            manager.arm(trigger);
            safeEmit(emit, { type: 'trigger-created', trigger });
            sendJSON(res, 201, { trigger: serializeTrigger(trigger) });
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
            const triggers = store.getByWorkspace(workspaceId);
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
            const triggerId = decodeURIComponent(match![2]);
            const trigger = store.getById(triggerId);
            if (!trigger) {
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
            const triggerId = decodeURIComponent(match![2]);
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (body.status === undefined) {
                return sendError(res, 400, 'status is required');
            }
            if (typeof body.status !== 'string' || !VALID_PATCH_STATUSES.has(body.status)) {
                return sendError(res, 400, `Invalid status: ${String(body.status)}. Valid values: active, paused, disarmed`);
            }

            const trigger = store.getById(triggerId);
            if (!trigger) {
                return sendError(res, 404, 'Trigger not found');
            }

            const target = body.status as 'active' | 'paused' | 'disarmed';

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
                if (now() >= new Date(trigger.expiresAt).getTime()) {
                    manager.disarm(triggerId);
                    trigger.status = 'expired';
                    trigger.nextTickAt = null;
                    store.update(trigger);
                    safeEmit(emit, { type: 'trigger-expired', trigger });
                    return sendError(res, 400, 'Trigger has expired and cannot be resumed');
                }
                trigger.status = 'active';
                trigger.inFlight = false;
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
            const triggerId = decodeURIComponent(match![2]);
            const trigger = store.getById(triggerId);
            if (!trigger) {
                return sendError(res, 404, 'Trigger not found');
            }

            manager.disarm(triggerId);
            trigger.status = 'disarmed';
            trigger.nextTickAt = null;
            store.delete(triggerId);
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
            const triggers = store.getAll();
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
