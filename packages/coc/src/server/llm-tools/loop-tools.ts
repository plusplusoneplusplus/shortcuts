/**
 * Loop & Wakeup LLM Tools
 *
 * Four tool factories:
 * - `createCreateLoopTool`    — create a recurring loop (skill-gated, not in LLM_TOOL_REGISTRY)
 * - `createCancelLoopTool`    — cancel an active loop  (skill-gated)
 * - `createListLoopsTool`     — list loops for a process (skill-gated)
 * - `createScheduleWakeupTool` — one-shot delayed follow-up (always available via registry)
 *
 * Loop tools are injected only when the `/loop` skill is activated.
 * `scheduleWakeup` is registered in LLM_TOOL_REGISTRY and always available.
 */

import * as crypto from 'crypto';
import { defineTool } from '@plusplusoneplusplus/forge';
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

export interface CreateLoopArgs {
    /** Human-readable description of the loop purpose. */
    description: string;
    /** Interval string (e.g. "30s", "5m", "1h") or milliseconds. */
    interval: string | number;
    /** The follow-up prompt to send on each tick. */
    prompt: string;
    /** Optional model override for loop ticks. */
    model?: string;
    /** Optional TTL string (e.g. "3d", "12h"). Defaults to 3 days. */
    ttl?: string;
}

export interface CancelLoopArgs {
    /** The loop ID to cancel. */
    loopId: string;
}

export interface ListLoopsArgs {
    /** Optional: filter by status. */
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
// createLoop tool
// ============================================================================

export function createCreateLoopTool(deps: LoopToolDeps) {
    const tool = defineTool<CreateLoopArgs>('createLoop', {
        description:
            'Create a recurring loop that sends follow-up messages into this conversation at a fixed interval. ' +
            'The first tick fires after one full interval (the current turn is the implicit first run). ' +
            'Use interval strings like "30s", "5m", "1h", "1d" or milliseconds.',
        parameters: {
            type: 'object',
            properties: {
                description: {
                    type: 'string',
                    description: 'Human-readable description of what the loop monitors or does.',
                },
                interval: {
                    type: ['string', 'number'],
                    description: 'Interval between ticks. String like "30s", "5m", "1h" or number of milliseconds.',
                },
                prompt: {
                    type: 'string',
                    description: 'The follow-up prompt to send on each tick.',
                },
                model: {
                    type: 'string',
                    description: 'Optional model override for loop ticks.',
                },
                ttl: {
                    type: 'string',
                    description: 'Optional TTL for the loop (e.g. "3d", "12h"). Defaults to 3 days.',
                },
            },
            required: ['description', 'interval', 'prompt'],
        },
        handler: async (args: CreateLoopArgs) => {
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
        },
    });

    return { tool };
}

// ============================================================================
// cancelLoop tool
// ============================================================================

export function createCancelLoopTool(deps: LoopToolDeps) {
    const tool = defineTool<CancelLoopArgs>('cancelLoop', {
        description:
            'Cancel an active or paused loop by its ID. The loop will stop ticking permanently.',
        parameters: {
            type: 'object',
            properties: {
                loopId: {
                    type: 'string',
                    description: 'The loop ID to cancel.',
                },
            },
            required: ['loopId'],
        },
        handler: async (args: CancelLoopArgs) => {
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
        },
    });

    return { tool };
}

// ============================================================================
// listLoops tool
// ============================================================================

export function createListLoopsTool(deps: LoopToolDeps) {
    const tool = defineTool<ListLoopsArgs>('listLoops', {
        description:
            'List all loops for this conversation, optionally filtered by status.',
        parameters: {
            type: 'object',
            properties: {
                status: {
                    type: 'string',
                    enum: ['active', 'paused', 'cancelled', 'expired'],
                    description: 'Optional: filter loops by status.',
                },
            },
        },
        handler: async (args: ListLoopsArgs) => {
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
            'Schedule a one-shot delayed follow-up message into this conversation. ' +
            'After the delay, the prompt will be sent as a new message. ' +
            'Use delay strings like "5s", "30s", "5m", "1h" or milliseconds. Minimum delay is 1 second.',
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
