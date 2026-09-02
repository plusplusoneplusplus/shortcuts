/**
 * Two tool factories:
 * - `createCronTool`           — single `cron` tool with an `action` switch
 *                                (create | cancel | list); skill-gated, not in
 *                                LLM_TOOL_REGISTRY
 * - `createScheduleWakeupTool` — one-shot delayed follow-up (always available via registry)
 *
 * The `cron` tool is injected only when the `/cron` skill is activated.
 * `scheduleWakeup` is registered in LLM_TOOL_REGISTRY and always available.
 */

import * as crypto from 'crypto';
import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { CronEntry, CronChangeEvent } from '../cron/cron-types';
import {
    MIN_CRON_INTERVAL_MS,
    MIN_WAKEUP_DELAY_MS,
    DEFAULT_CRON_TTL_MS,
} from '../cron/cron-types';
import type { CronStore } from '../cron/cron-store';
import type { CronExecutor, CronEventEmit } from '../cron/cron-executor';

// ============================================================================
// Shared deps type
// ============================================================================

export interface CronToolDeps {
    store: CronStore;
    executor: CronExecutor;
    /** The processId of the current conversation. */
    processId: string;
    /** Resolve workspace ID for the process (used at cron creation time). */
    resolveWorkspaceId: (processId: string) => Promise<string | undefined>;
    /** Optional emitter for broadcasting cron state changes via WebSocket. */
    emit?: CronEventEmit;
}

export interface WakeupToolDeps {
    executor: CronExecutor;
    /** The processId of the current conversation. */
    processId: string;
    /** Resolve workspace ID for the process. */
    resolveWorkspaceId: (processId: string) => Promise<string | undefined>;
    /** Enqueue a one-shot follow-up via TaskQueueManager. */
    enqueueWakeup: (opts: {
        processId: string;
        prompt: string;
        delayMs: number;
        wakeupId: string;
        model?: string;
        workspaceId?: string;
    }) => void;
}

// ============================================================================
// Args types
// ============================================================================

export type CronAction = 'create' | 'cancel' | 'list';

export interface CronToolArgs {
    /** Which cron operation to perform. */
    action: CronAction;
    /** create: human-readable description of the cron purpose. */
    description?: string;
    /** create: interval string (e.g. "30s", "5m", "1h") or milliseconds. */
    interval?: string | number;
    /** create: the follow-up prompt to send on each tick. */
    prompt?: string;
    /** create: optional model override for cron ticks. */
    model?: string;
    /** create: optional TTL string (e.g. "3d", "12h"). Defaults to 3 days. */
    ttl?: string;
    /** cancel: the cron ID to cancel. */
    cronId?: string;
    /** list: optional status filter. */
    status?: 'active' | 'paused' | 'cancelled' | 'expired';
}

export interface ScheduleWakeupArgs {
    /** The follow-up prompt to send after the delay. */
    prompt: string;
    /** Delay string (e.g. "30s", "5m", "1h") or milliseconds. */
    delay: string | number;
    /** Optional model override. */
    model?: string;
}

function safeEmit(emit: CronEventEmit | undefined, event: CronChangeEvent): void {
    if (!emit) return;
    try {
        emit(event);
    } catch {
        // Best-effort broadcast — never fail the tool call.
    }
}

// ============================================================================
// Interval/delay parsing
// ============================================================================

/**
 * Parse a human-friendly duration string into milliseconds.
 * Supports: "30s", "5m", "2h", "1d", "1.5h", or raw number (ms).
 */
export function parseDuration(input: string | number): number {
    if (typeof input === 'number') return Math.round(input);

    const trimmed = input.trim().toLowerCase();
    const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|ms|milliseconds?)$/);
    if (!match) {
        const num = Number(trimmed);
        if (!isNaN(num) && num > 0) return Math.round(num);
        throw new Error(`Invalid duration: "${input}". Use formats like "30s", "5m", "2h", "1d" or a number of milliseconds.`);
    }

    const value = parseFloat(match[1]);
    const unit = match[2];

    if (unit === 'ms' || unit.startsWith('millisecond')) return Math.round(value);
    if (unit === 's' || unit.startsWith('sec')) return Math.round(value * 1000);
    if (unit === 'm' || unit.startsWith('min')) return Math.round(value * 60 * 1000);
    if (unit === 'h' || unit.startsWith('hr') || unit.startsWith('hour')) return Math.round(value * 60 * 60 * 1000);
    if (unit === 'd' || unit.startsWith('day')) return Math.round(value * 24 * 60 * 60 * 1000);

    throw new Error(`Unknown duration unit: "${unit}"`);
}

// ============================================================================
// cron tool (create | cancel | list)
// ============================================================================

async function handleCreateCron(deps: CronToolDeps, args: CronToolArgs) {
    if (typeof args.description !== 'string' || !args.description.trim()
        || args.interval === undefined
        || typeof args.prompt !== 'string' || !args.prompt.trim()) {
        return { error: 'action "create" requires `description`, `interval`, and `prompt`.' };
    }

    let intervalMs: number;
    try {
        intervalMs = parseDuration(args.interval);
    } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }

    if (intervalMs < MIN_CRON_INTERVAL_MS) {
        return { error: `Minimum cron interval is ${MIN_CRON_INTERVAL_MS / 1000} seconds. Got ${intervalMs / 1000}s.` };
    }

    let ttlMs = DEFAULT_CRON_TTL_MS;
    if (args.ttl) {
        try {
            ttlMs = parseDuration(args.ttl);
        } catch (err) {
            return { error: `Invalid TTL: ${err instanceof Error ? err.message : String(err)}` };
        }
    }

    const now = new Date();
    const workspaceId = await deps.resolveWorkspaceId(deps.processId);
    const cron: CronEntry = {
        id: `cron_${crypto.randomUUID().replace(/-/g, '').substring(0, 12)}`,
        processId: deps.processId,
        description: args.description,
        intervalMs,
        status: 'active',
        createdAt: now.toISOString(),
        lastTickAt: null,
        nextTickAt: new Date(now.getTime() + intervalMs).toISOString(),
        tickCount: 0,
        consecutiveFailures: 0,
        expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
        pausedReason: null,
        prompt: args.prompt,
        model: args.model ?? null,
        workspaceId,
    };

    try {
        deps.store.insert(cron);
    } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }

    deps.executor.armTimer(cron);
    safeEmit(deps.emit, { type: 'cron-created', cron });

    return {
        created: true,
        cronId: cron.id,
        description: cron.description,
        intervalMs: cron.intervalMs,
        nextTickAt: cron.nextTickAt,
        expiresAt: cron.expiresAt,
    };
}

async function handleCancelCron(deps: CronToolDeps, args: CronToolArgs) {
    if (typeof args.cronId !== 'string' || !args.cronId.trim()) {
        return { error: 'action "cancel" requires `cronId`.' };
    }

    const cron = deps.store.getById(args.cronId);
    if (!cron) {
        return { error: `Cron not found: ${args.cronId}` };
    }

    if (cron.processId !== deps.processId) {
        return { error: `Cron ${args.cronId} belongs to a different conversation.` };
    }

    if (cron.status === 'cancelled') {
        return { alreadyCancelled: true, cronId: cron.id };
    }

    deps.executor.disarmTimer(cron.id);
    cron.status = 'cancelled';
    cron.nextTickAt = null;
    deps.store.update(cron);
    safeEmit(deps.emit, { type: 'cron-cancelled', cron });

    return { cancelled: true, cronId: cron.id };
}

async function handleListCrons(deps: CronToolDeps, args: CronToolArgs) {
    let crons = deps.store.getByProcess(deps.processId);
    if (args.status) {
        crons = crons.filter(l => l.status === args.status);
    }

    return {
        crons: crons.map(l => ({
            id: l.id,
            description: l.description,
            status: l.status,
            intervalMs: l.intervalMs,
            tickCount: l.tickCount,
            lastTickAt: l.lastTickAt,
            nextTickAt: l.nextTickAt,
            expiresAt: l.expiresAt,
            pausedReason: l.pausedReason,
        })),
        total: crons.length,
    };
}

export function createCronTool(deps: CronToolDeps) {
    const tool = defineTool<CronToolArgs>('cron', {
        description:
            'Manage recurring crons that send a follow-up prompt into this conversation at a fixed interval. ' +
            'action "create" makes a new cron (requires `description`, `interval`, `prompt`; the first tick fires ' +
            'after one full interval — the current turn is the implicit first run), "cancel" permanently stops a ' +
            'cron by `cronId`, and "list" shows this conversation\'s crons (optional `status` filter).',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['create', 'cancel', 'list'],
                    description: 'The cron operation to perform.',
                },
                description: {
                    type: 'string',
                    description: 'create: what the cron monitors or does.',
                },
                interval: {
                    type: ['string', 'number'],
                    description: 'create: interval between ticks. String like "30s", "5m", "1h" or milliseconds.',
                },
                prompt: {
                    type: 'string',
                    description: 'create: the follow-up prompt to send on each tick.',
                },
                model: {
                    type: 'string',
                    description: 'create: optional model override for cron ticks.',
                },
                ttl: {
                    type: 'string',
                    description: 'create: optional TTL (e.g. "3d", "12h"). Defaults to 3 days.',
                },
                cronId: {
                    type: 'string',
                    description: 'cancel: the cron ID to cancel.',
                },
                status: {
                    type: 'string',
                    enum: ['active', 'paused', 'cancelled', 'expired'],
                    description: 'list: optional status filter.',
                },
            },
            required: ['action'],
        },
        handler: async (args: CronToolArgs) => {
            switch (args.action) {
                case 'create':
                    return handleCreateCron(deps, args);
                case 'cancel':
                    return handleCancelCron(deps, args);
                case 'list':
                    return handleListCrons(deps, args);
                default:
                    return { error: `Unknown cron action: '${String(args.action)}'. Valid actions: create, cancel, list.` };
            }
        },
    });

    return { tool };
}

// ============================================================================
// scheduleWakeup tool
// ============================================================================

export function createScheduleWakeupTool(deps: WakeupToolDeps) {
    const tool = defineTool<ScheduleWakeupArgs>('scheduleWakeup', {
        description:
            'Schedule a one-shot delayed follow-up: after the delay, the prompt is sent into this conversation ' +
            'as a new message. Minimum delay is 1 second.',
        parameters: {
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: 'The follow-up prompt to send after the delay.',
                },
                delay: {
                    type: ['string', 'number'],
                    description: 'Delay before sending. String like "5s", "30s", "5m" or number of milliseconds.',
                },
                model: {
                    type: 'string',
                    description: 'Optional model override for the follow-up.',
                },
            },
            required: ['prompt', 'delay'],
        },
        handler: async (args: ScheduleWakeupArgs) => {
            let delayMs: number;
            try {
                delayMs = parseDuration(args.delay);
            } catch (err) {
                return { error: err instanceof Error ? err.message : String(err) };
            }

            if (delayMs < MIN_WAKEUP_DELAY_MS) {
                return { error: `Minimum wakeup delay is ${MIN_WAKEUP_DELAY_MS / 1000} second(s). Got ${delayMs / 1000}s.` };
            }

            const wakeupId = `wakeup_${crypto.randomUUID().replace(/-/g, '').substring(0, 12)}`;
            const workspaceId = await deps.resolveWorkspaceId(deps.processId);

            deps.enqueueWakeup({
                processId: deps.processId,
                prompt: args.prompt,
                delayMs,
                wakeupId,
                model: args.model,
                workspaceId,
            });

            return {
                scheduled: true,
                wakeupId,
                delayMs,
                firesAt: new Date(Date.now() + delayMs).toISOString(),
            };
        },
    });

    return { tool };
}
