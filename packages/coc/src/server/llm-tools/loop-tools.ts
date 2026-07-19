/**
 * Loop & Wakeup LLM Tools
 *
 * Two tool factories:
 * - `createLoopTool`           — single `loop` tool with an `action` switch
 *                                (create | cancel | list); skill-gated, not in
 *                                LLM_TOOL_REGISTRY
 * - `createScheduleWakeupTool` — one-shot delayed follow-up (always available via registry)
 *
 * The `loop` tool is injected only when the `/loop` skill is activated.
 * `scheduleWakeup` is registered in LLM_TOOL_REGISTRY and always available.
 */

import * as crypto from 'crypto';
import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { LoopEntry, LoopChangeEvent } from '../loops/loop-types';
import {
    MIN_LOOP_INTERVAL_MS,
    MIN_WAKEUP_DELAY_MS,
    DEFAULT_LOOP_TTL_MS,
} from '../loops/loop-types';
import type { LoopStore } from '../loops/loop-store';
import type { LoopExecutor, LoopEventEmit } from '../loops/loop-executor';

// ============================================================================
// Shared deps type
// ============================================================================

export interface LoopToolDeps {
    store: LoopStore;
    executor: LoopExecutor;
    /** The processId of the current conversation. */
    processId: string;
    /** Resolve workspace ID for the process (used at loop creation time). */
    resolveWorkspaceId: (processId: string) => Promise<string | undefined>;
    /** Optional emitter for broadcasting loop state changes via WebSocket. */
    emit?: LoopEventEmit;
}

export interface WakeupToolDeps {
    executor: LoopExecutor;
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

export type LoopAction = 'create' | 'cancel' | 'list';

export interface LoopToolArgs {
    /** Which loop operation to perform. */
    action: LoopAction;
    /** create: human-readable description of the loop purpose. */
    description?: string;
    /** create: interval string (e.g. "30s", "5m", "1h") or milliseconds. */
    interval?: string | number;
    /** create: the follow-up prompt to send on each tick. */
    prompt?: string;
    /** create: optional model override for loop ticks. */
    model?: string;
    /** create: optional TTL string (e.g. "3d", "12h"). Defaults to 3 days. */
    ttl?: string;
    /** cancel: the loop ID to cancel. */
    loopId?: string;
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

function safeEmit(emit: LoopEventEmit | undefined, event: LoopChangeEvent): void {
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
// loop tool (create | cancel | list)
// ============================================================================

async function handleCreateLoop(deps: LoopToolDeps, args: LoopToolArgs) {
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

    if (intervalMs < MIN_LOOP_INTERVAL_MS) {
        return { error: `Minimum loop interval is ${MIN_LOOP_INTERVAL_MS / 1000} seconds. Got ${intervalMs / 1000}s.` };
    }

    let ttlMs = DEFAULT_LOOP_TTL_MS;
    if (args.ttl) {
        try {
            ttlMs = parseDuration(args.ttl);
        } catch (err) {
            return { error: `Invalid TTL: ${err instanceof Error ? err.message : String(err)}` };
        }
    }

    const now = new Date();
    const workspaceId = await deps.resolveWorkspaceId(deps.processId);
    const loop: LoopEntry = {
        id: `loop_${crypto.randomUUID().replace(/-/g, '').substring(0, 12)}`,
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
        deps.store.insert(loop);
    } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }

    deps.executor.armTimer(loop);
    safeEmit(deps.emit, { type: 'loop-created', loop });

    return {
        created: true,
        loopId: loop.id,
        description: loop.description,
        intervalMs: loop.intervalMs,
        nextTickAt: loop.nextTickAt,
        expiresAt: loop.expiresAt,
    };
}

async function handleCancelLoop(deps: LoopToolDeps, args: LoopToolArgs) {
    if (typeof args.loopId !== 'string' || !args.loopId.trim()) {
        return { error: 'action "cancel" requires `loopId`.' };
    }

    const loop = deps.store.getById(args.loopId);
    if (!loop) {
        return { error: `Loop not found: ${args.loopId}` };
    }

    if (loop.processId !== deps.processId) {
        return { error: `Loop ${args.loopId} belongs to a different conversation.` };
    }

    if (loop.status === 'cancelled') {
        return { alreadyCancelled: true, loopId: loop.id };
    }

    deps.executor.disarmTimer(loop.id);
    loop.status = 'cancelled';
    loop.nextTickAt = null;
    deps.store.update(loop);
    safeEmit(deps.emit, { type: 'loop-cancelled', loop });

    return { cancelled: true, loopId: loop.id };
}

async function handleListLoops(deps: LoopToolDeps, args: LoopToolArgs) {
    let loops = deps.store.getByProcess(deps.processId);
    if (args.status) {
        loops = loops.filter(l => l.status === args.status);
    }

    return {
        loops: loops.map(l => ({
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
        total: loops.length,
    };
}

export function createLoopTool(deps: LoopToolDeps) {
    const tool = defineTool<LoopToolArgs>('loop', {
        description:
            'Manage recurring loops that send a follow-up prompt into this conversation at a fixed interval. ' +
            'action "create" makes a new loop (requires `description`, `interval`, `prompt`; the first tick fires ' +
            'after one full interval — the current turn is the implicit first run), "cancel" permanently stops a ' +
            'loop by `loopId`, and "list" shows this conversation\'s loops (optional `status` filter).',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['create', 'cancel', 'list'],
                    description: 'The loop operation to perform.',
                },
                description: {
                    type: 'string',
                    description: 'create: what the loop monitors or does.',
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
                    description: 'create: optional model override for loop ticks.',
                },
                ttl: {
                    type: 'string',
                    description: 'create: optional TTL (e.g. "3d", "12h"). Defaults to 3 days.',
                },
                loopId: {
                    type: 'string',
                    description: 'cancel: the loop ID to cancel.',
                },
                status: {
                    type: 'string',
                    enum: ['active', 'paused', 'cancelled', 'expired'],
                    description: 'list: optional status filter.',
                },
            },
            required: ['action'],
        },
        handler: async (args: LoopToolArgs) => {
            switch (args.action) {
                case 'create':
                    return handleCreateLoop(deps, args);
                case 'cancel':
                    return handleCancelLoop(deps, args);
                case 'list':
                    return handleListLoops(deps, args);
                default:
                    return { error: `Unknown loop action: '${String(args.action)}'. Valid actions: create, cancel, list.` };
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
