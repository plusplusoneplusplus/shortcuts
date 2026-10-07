/** Shared trigger creation for REST and server-owned tools. */
import * as crypto from 'crypto';
import type { TriggerStore } from './trigger-store';
import type { TriggerManager, TriggerEventEmit } from './trigger-manager';
import type { Trigger, TriggerEvent, TriggerAction } from './trigger-types';
import { DEFAULT_TRIGGER_TTL_MS, DEFAULT_CI_POLL_INTERVAL_MS, MIN_POLL_INTERVAL_MS } from './trigger-types';

export interface CreateTriggerContext {
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
    /**
     * Resolve a process (conversation) ID to its owning workspace. Used on
     * create to verify that `processId` and `action.processId` belong to the
     * route workspace, so a trigger cannot be stored under one workspace while
     * firing follow-ups into another. When omitted, cross-workspace process
     * verification is skipped.
     */
    resolveWorkspaceId?: (processId: string) => Promise<string | undefined>;
}

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

export class CreateTriggerError extends Error {
    constructor(readonly statusCode: number, message: string) {
        super(message);
        this.name = 'CreateTriggerError';
    }
}

export type CreateTriggerFn = (
    workspaceId: string,
    body: Record<string, unknown>,
    reuseCiMonitor?: boolean,
) => Promise<Trigger>;

/** Validate ownership, persist, schedule and broadcast on the owning server. */
export async function createTrigger(
    ctx: CreateTriggerContext,
    workspaceId: string,
    body: Record<string, unknown>,
    reuseCiMonitor = false,
): Promise<Trigger> {
    if (!ctx.enabled) {
        throw new CreateTriggerError(403, 'Triggers are disabled (triggers.enabled is off)');
    }
    const validation = validateCreateTriggerBody(body);
    if (!validation.valid) {
        throw new CreateTriggerError(400, validation.error!);
    }
    const processId = body.processId as string;
    const action = body.action as Record<string, unknown> | undefined;
    const actionProcessId = action?.processId as string | undefined;
    if (ctx.resolveWorkspaceId) {
        for (const id of new Set([processId, actionProcessId ?? processId])) {
            const owner = await ctx.resolveWorkspaceId(id);
            if (owner !== undefined && owner !== workspaceId) {
                throw new CreateTriggerError(400, `${id === processId ? 'processId' : 'action.processId'} belongs to a different workspace`);
            }
        }
    }
    const now = ctx.now ?? Date.now;
    const candidate = buildTriggerFromCreateRequest(workspaceId, body, now);
    // No awaits between lookup and insertion: concurrent retries cannot insert duplicates.
    if (reuseCiMonitor) {
        const existing = ctx.store.getByWorkspace(workspaceId).find(t =>
            (t.status === 'active' || t.status === 'paused') && Date.parse(t.expiresAt) > now()
            && t.processId === processId && t.action.processId === candidate.action.processId
            && t.event.type === 'condition-monitor' && t.event.monitor === 'ci-failure'
            && t.event.originId === candidate.event.originId && t.event.prId === candidate.event.prId);
        if (existing) {
            if (existing.status === 'paused') {
                const paused = { ...existing };
                existing.status = 'active';
                existing.nextTickAt = candidate.nextTickAt;
                ctx.store.update(existing);
                try { ctx.manager.arm(existing); } catch (err) {
                    ctx.store.update(paused);
                    throw err;
                }
                try { ctx.emit?.({ type: 'trigger-updated', trigger: existing }); } catch { /* best-effort */ }
            }
            return existing;
        }
    }
    try { ctx.store.insert(candidate); } catch (err) {
        throw new CreateTriggerError(409, err instanceof Error ? err.message : String(err));
    }
    try { ctx.manager.arm(candidate); } catch (err) {
        ctx.store.delete(candidate.id);
        throw err;
    }
    try { ctx.emit?.({ type: 'trigger-created', trigger: candidate }); } catch { /* best-effort */ }
    return candidate;
}
