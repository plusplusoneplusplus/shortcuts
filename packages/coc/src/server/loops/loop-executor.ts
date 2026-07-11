/**
 * Loop Executor
 *
 * Owns the per-tick lifecycle of loop entries:
 * - Schedules timer ticks via `ScheduleTimerRegistry`
 * - On tick: checks process status, skips if process is running, checks TTL/circuit breakers
 * - Enqueues follow-up tasks via `TaskQueueManager` (chat with processId)
 * - Tracks execution results, updates store
 * - Reschedules next tick after execution
 * - Handles server shutdown (disarm timers without mutating persisted loops)
 *
 * Pure execution — no CRUD or REST knowledge.
 */

import * as crypto from 'crypto';
import type { ProcessStore, TaskQueueManager, QueuedTask } from '@plusplusoneplusplus/forge';
import { toTaskId, toQueueProcessId, getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import type { ScheduleTimerRegistry } from '../schedule/schedule-timer-registry';
import { PeriodicEntryScheduler } from '../schedule/periodic-entry-scheduler';
import type { LoopStore } from './loop-store';
import type { LoopEntry, LoopChangeEvent } from './loop-types';
import { MAX_CONSECUTIVE_FAILURES, MAX_CONSECUTIVE_WAKEUPS_PER_PROCESS } from './loop-types';
import { resolveFollowUpMode } from '../executors/follow-up-mode';

// ============================================================================
// Types
// ============================================================================

export type LoopEventEmit = (event: LoopChangeEvent) => void;

/**
 * Dependencies injected into the executor.
 * Avoids tight coupling to the server's wiring.
 */
export interface LoopExecutorDeps {
    store: LoopStore;
    processStore: ProcessStore;
    timerRegistry: ScheduleTimerRegistry;
    queueManager: TaskQueueManager | null;
    emit: LoopEventEmit;
    /** Resolve the repo/workspace ID for a given processId. */
    resolveWorkspaceId: (processId: string) => Promise<string | undefined>;
}

// ============================================================================
// LoopExecutor
// ============================================================================

export class LoopExecutor {
    private readonly deps: LoopExecutorDeps;

    /**
     * Per-process consecutive wakeup counter.
     * Resets when a manual user message is received (called externally).
     */
    private readonly wakeupCounts = new Map<string, number>();

    /**
     * Set of processIds that currently have a loop tick in-flight
     * (enqueued or running). Prevents double-firing.
     */
    private readonly inflight = new Set<string>();

    /** Shared timer-arming lifecycle kernel (delay/overdue/reschedule/shutdown). */
    private readonly scheduler: PeriodicEntryScheduler<LoopEntry>;

    constructor(deps: LoopExecutorDeps) {
        this.deps = deps;
        this.scheduler = new PeriodicEntryScheduler<LoopEntry>({
            timerRegistry: deps.timerRegistry,
            getFallbackIntervalMs: loop => loop.intervalMs,
            persist: loop => this.deps.store.update(loop),
            onTick: id => this.onTick(id),
            logLabel: 'LoopExecutor',
            onShutdownCleanup: () => this.inflight.clear(),
        });
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Arm timers for all active loops.
     * Called once at server startup after loops are loaded from the DB.
     */
    armAll(): void {
        this.scheduler.armAll(this.deps.store.getActive());
    }

    /**
     * Arm the timer for a single loop. Computes the delay from `nextTickAt`
     * (or falls back to `intervalMs` from now).
     */
    armTimer(loop: LoopEntry): void {
        this.scheduler.arm(loop);
    }

    /**
     * Cancel the timer for a loop and remove it from the inflight set.
     */
    disarmTimer(loopId: string): void {
        this.scheduler.disarm(loopId);
    }

    /**
     * Disarm active loop timers during server shutdown without mutating
     * persisted loop state. Active loops are re-armed on the next startup.
     */
    shutdownAll(): void {
        this.scheduler.shutdownAll();
    }

    /**
     * Reset the wakeup counter for a process.
     * Should be called when a manual user message is received on the process.
     */
    resetWakeupCount(processId: string): void {
        this.wakeupCounts.delete(processId);
    }

    /**
     * Check whether a process has a loop tick currently in-flight.
     */
    isInflight(processId: string): boolean {
        return this.inflight.has(processId);
    }

    /**
     * Mark a tick execution as complete (success or failure).
     * Called by the task completion callback after the enqueued follow-up finishes.
     */
    async onTickComplete(loopId: string, success: boolean): Promise<void> {
        const loop = this.deps.store.getById(loopId);
        if (!loop) return;

        this.inflight.delete(loop.processId);

        if (loop.status !== 'active') return;

        if (success) {
            loop.consecutiveFailures = 0;
            loop.tickCount += 1;
            loop.lastTickAt = new Date().toISOString();
        } else {
            loop.consecutiveFailures += 1;

            // Circuit breaker: auto-pause after MAX_CONSECUTIVE_FAILURES
            if (loop.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                this.pauseLoop(loop, `auto-paused: ${MAX_CONSECUTIVE_FAILURES} consecutive failures`);
                return;
            }
        }

        // Schedule next tick (advance nextTickAt, persist, re-arm).
        this.scheduler.reschedule(loop);

        this.deps.emit({ type: 'loop-tick', loop });
    }

    // ========================================================================
    // Internal: tick handler
    // ========================================================================

    /**
     * Fired by the timer registry when a loop's interval elapses.
     */
    private async onTick(loopId: string): Promise<void> {
        const logger = getLogger();
        const loop = this.deps.store.getById(loopId);

        if (!loop) {
            logger.warn(LogCategory.AI, `[LoopExecutor] Tick for unknown loop ${loopId}`);
            return;
        }

        // Guard: only fire active loops
        if (loop.status !== 'active') {
            logger.debug(LogCategory.AI, `[LoopExecutor] Skipping tick for non-active loop ${loopId} (status: ${loop.status})`);
            return;
        }

        // TTL check
        if (this.isExpired(loop)) {
            this.expireLoop(loop);
            return;
        }

        // Per-process wakeup limit
        const wakeupCount = this.wakeupCounts.get(loop.processId) ?? 0;
        if (wakeupCount >= MAX_CONSECUTIVE_WAKEUPS_PER_PROCESS) {
            this.pauseLoop(loop, `auto-paused: ${MAX_CONSECUTIVE_WAKEUPS_PER_PROCESS} consecutive wakeups on process`);
            return;
        }

        // Concurrency guard: skip if process already has an in-flight tick
        if (this.inflight.has(loop.processId)) {
            logger.debug(LogCategory.AI, `[LoopExecutor] Skipping tick for loop ${loopId}: process ${loop.processId} already has in-flight tick`);
            this.rescheduleAfterSkip(loop);
            return;
        }

        // Check process status — auto-pause if cancelled or failed
        const proc = await this.deps.processStore.getProcess(loop.processId);
        if (proc) {
            const status = proc.status;
            if (status === 'cancelled' || status === 'failed') {
                this.pauseLoop(loop, `auto-paused: process ${status}`);
                return;
            }

            // Skip if process is currently running — don't queue overlapping work
            if (status === 'running') {
                logger.debug(LogCategory.AI, `[LoopExecutor] Skipping tick for loop ${loopId}: process is running`);
                this.rescheduleAfterSkip(loop);
                return;
            }
        }

        // Enqueue follow-up
        try {
            this.inflight.add(loop.processId);
            this.wakeupCounts.set(loop.processId, wakeupCount + 1);
            await this.enqueueFollowUp(loop);
        } catch (err) {
            this.inflight.delete(loop.processId);
            logger.error(LogCategory.AI, `[LoopExecutor] Failed to enqueue tick for loop ${loopId}: ${err instanceof Error ? err.message : String(err)}`);
            // Count as a failure
            await this.onTickComplete(loopId, false);
        }
    }

    // ========================================================================
    // Internal: enqueue
    // ========================================================================

    private async enqueueFollowUp(loop: LoopEntry): Promise<void> {
        const queueManager = this.deps.queueManager;
        if (!queueManager) {
            throw new Error('TaskQueueManager not available');
        }

        const logger = getLogger();

        // Find the existing task for this process so we can requeue it
        const taskId = toTaskId(loop.processId);
        const existingTask = queueManager.getTask(taskId);

        if (existingTask && existingTask.status === 'completed') {
            // Requeue from history with the loop prompt.
            // Re-resolve mode (don't trust stale value on the existing task —
            // the process's metadata.mode may have changed since the original
            // turn was enqueued).
            const mode = await resolveFollowUpMode(this.deps.processStore, loop.processId);
            queueManager.updateTask(taskId, {
                displayName: `[Loop] ${loop.description || loop.prompt.substring(0, 40)}`,
                payload: {
                    ...existingTask.payload,
                    mode,
                    prompt: loop.prompt,
                    processId: loop.processId,
                    ...(loop.model ? { model: loop.model } : {}),
                    context: {
                        ...((existingTask.payload as Record<string, unknown>).context as Record<string, unknown> ?? {}),
                        loopId: loop.id,
                        source: 'loop',
                    },
                },
            });
            if (!queueManager.requeueFromHistory(taskId)) {
                // Fall through to enqueue new task
                await this.enqueueNewFollowUpTask(loop);
            }
        } else if (!existingTask || existingTask.status === 'cancelled') {
            // No existing task in queue or cancelled — enqueue a new follow-up
            await this.enqueueNewFollowUpTask(loop);
        } else {
            // Task exists but is queued/running — shouldn't happen due to guards,
            // but handle gracefully
            logger.warn(LogCategory.AI, `[LoopExecutor] Unexpected task status for loop ${loop.id}: ${existingTask.status}`);
            throw new Error(`Process task in unexpected state: ${existingTask.status}`);
        }
    }

    private async enqueueNewFollowUpTask(loop: LoopEntry): Promise<void> {
        const queueManager = this.deps.queueManager!;
        const workspaceId = await this.deps.resolveWorkspaceId(loop.processId);
        const mode = await resolveFollowUpMode(this.deps.processStore, loop.processId);

        queueManager.enqueue({
            type: 'chat',
            priority: 'normal',
            payload: {
                kind: 'chat',
                mode,
                prompt: loop.prompt,
                processId: loop.processId,
                ...(loop.model ? { model: loop.model } : {}),
                context: {
                    loopId: loop.id,
                    source: 'loop',
                },
            },
            config: { ...(loop.model ? { model: loop.model } : {}) },
            displayName: `[Loop] ${loop.description || loop.prompt.substring(0, 40)}`,
            repoId: workspaceId,
        });
    }

    // ========================================================================
    // Internal: state transitions
    // ========================================================================

    private pauseLoop(loop: LoopEntry, reason: string): void {
        const logger = getLogger();
        logger.info(LogCategory.AI, `[LoopExecutor] Pausing loop ${loop.id}: ${reason}`);

        this.disarmTimer(loop.id);
        loop.status = 'paused';
        loop.pausedReason = reason;
        loop.nextTickAt = null;
        this.deps.store.update(loop);

        this.deps.emit({ type: 'loop-paused', loop });
    }

    private expireLoop(loop: LoopEntry): void {
        const logger = getLogger();
        logger.info(LogCategory.AI, `[LoopExecutor] Expiring loop ${loop.id} (TTL exceeded)`);

        this.disarmTimer(loop.id);
        loop.status = 'expired';
        loop.nextTickAt = null;
        this.deps.store.update(loop);

        this.deps.emit({ type: 'loop-expired', loop });
    }

    private isExpired(loop: LoopEntry): boolean {
        return Date.now() >= new Date(loop.expiresAt).getTime();
    }

    /**
     * Reschedule a loop after a skipped tick.
     * Uses the full interval to avoid rapid retry loops.
     */
    private rescheduleAfterSkip(loop: LoopEntry): void {
        this.scheduler.reschedule(loop);
    }
}
