/**
 * Cron Executor
 *
 * Owns the per-tick lifecycle of cron entries:
 * - Schedules timer ticks via `ScheduleTimerRegistry`
 * - On tick: checks process status, skips if process is running, checks TTL/circuit breakers
 * - Enqueues follow-up tasks via `TaskQueueManager` (chat with processId)
 * - Tracks execution results, updates store
 * - Reschedules next tick after execution
 * - Handles server shutdown (disarm timers without mutating persisted crons)
 *
 * Pure execution — no CRUD or REST knowledge.
 */

import * as crypto from 'crypto';
import type { ProcessStore, TaskQueueManager, QueuedTask } from '@plusplusoneplusplus/forge';
import { toTaskId, toQueueProcessId, getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import type { ScheduleTimerRegistry } from '../schedule/schedule-timer-registry';
import { PeriodicEntryScheduler } from '../schedule/periodic-entry-scheduler';
import type { CronStore } from './cron-store';
import type { CronEntry, CronChangeEvent } from './cron-types';
import { MAX_CONSECUTIVE_FAILURES, MAX_CONSECUTIVE_WAKEUPS_PER_PROCESS } from './cron-types';
import { resolveFollowUpMode } from '../executors/follow-up-mode';

// ============================================================================
// Types
// ============================================================================

export type CronEventEmit = (event: CronChangeEvent) => void;

/**
 * Dependencies injected into the executor.
 * Avoids tight coupling to the server's wiring.
 */
export interface CronExecutorDeps {
    store: CronStore;
    processStore: ProcessStore;
    timerRegistry: ScheduleTimerRegistry;
    queueManager: TaskQueueManager | null;
    emit: CronEventEmit;
    /** Resolve the repo/workspace ID for a given processId. */
    resolveWorkspaceId: (processId: string) => Promise<string | undefined>;
}

// ============================================================================
// CronExecutor
// ============================================================================

export class CronExecutor {
    private readonly deps: CronExecutorDeps;

    /**
     * Per-process consecutive wakeup counter.
     * Resets when a manual user message is received (called externally).
     */
    private readonly wakeupCounts = new Map<string, number>();

    /**
     * Set of processIds that currently have a cron tick in-flight
     * (enqueued or running). Prevents double-firing.
     */
    private readonly inflight = new Set<string>();

    /** Shared timer-arming lifecycle kernel (delay/overdue/reschedule/shutdown). */
    private readonly scheduler: PeriodicEntryScheduler<CronEntry>;

    constructor(deps: CronExecutorDeps) {
        this.deps = deps;
        this.scheduler = new PeriodicEntryScheduler<CronEntry>({
            timerRegistry: deps.timerRegistry,
            getFallbackIntervalMs: cron => cron.intervalMs,
            persist: cron => this.deps.store.update(cron),
            onTick: id => this.onTick(id),
            logLabel: 'CronExecutor',
            onShutdownCleanup: () => this.inflight.clear(),
        });
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Arm timers for all active crons.
     * Called once at server startup after crons are loaded from the DB.
     */
    armAll(): void {
        this.scheduler.armAll(this.deps.store.getActive());
    }

    /**
     * Arm the timer for a single cron. Computes the delay from `nextTickAt`
     * (or falls back to `intervalMs` from now).
     */
    armTimer(cron: CronEntry): void {
        this.scheduler.arm(cron);
    }

    /**
     * Cancel the timer for a cron and remove it from the inflight set.
     */
    disarmTimer(cronId: string): void {
        this.scheduler.disarm(cronId);
    }

    /**
     * Disarm active cron timers during server shutdown without mutating
     * persisted cron state. Active crons are re-armed on the next startup.
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
     * Check whether a process has a cron tick currently in-flight.
     */
    isInflight(processId: string): boolean {
        return this.inflight.has(processId);
    }

    /**
     * Mark a tick execution as complete (success or failure).
     * Called by the task completion callback after the enqueued follow-up finishes.
     */
    async onTickComplete(cronId: string, success: boolean): Promise<void> {
        const cron = this.deps.store.getById(cronId);
        if (!cron) return;

        this.inflight.delete(cron.processId);

        if (cron.status !== 'active') return;

        if (success) {
            cron.consecutiveFailures = 0;
            cron.tickCount += 1;
            cron.lastTickAt = new Date().toISOString();
        } else {
            cron.consecutiveFailures += 1;

            // Circuit breaker: auto-pause after MAX_CONSECUTIVE_FAILURES
            if (cron.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                this.pauseCron(cron, `auto-paused: ${MAX_CONSECUTIVE_FAILURES} consecutive failures`);
                return;
            }
        }

        // Schedule next tick (advance nextTickAt, persist, re-arm).
        this.scheduler.reschedule(cron);

        this.deps.emit({ type: 'cron-tick', cron });
    }

    // ========================================================================
    // Internal: tick handler
    // ========================================================================

    /**
     * Fired by the timer registry when a cron's interval elapses.
     */
    private async onTick(cronId: string): Promise<void> {
        const logger = getLogger();
        const cron = this.deps.store.getById(cronId);

        if (!cron) {
            logger.warn(LogCategory.AI, `[CronExecutor] Tick for unknown cron ${cronId}`);
            return;
        }

        // Guard: only fire active crons
        if (cron.status !== 'active') {
            logger.debug(LogCategory.AI, `[CronExecutor] Skipping tick for non-active cron ${cronId} (status: ${cron.status})`);
            return;
        }

        // TTL check
        if (this.isExpired(cron)) {
            this.expireCron(cron);
            return;
        }

        // Per-process wakeup limit
        const wakeupCount = this.wakeupCounts.get(cron.processId) ?? 0;
        if (wakeupCount >= MAX_CONSECUTIVE_WAKEUPS_PER_PROCESS) {
            this.pauseCron(cron, `auto-paused: ${MAX_CONSECUTIVE_WAKEUPS_PER_PROCESS} consecutive wakeups on process`);
            return;
        }

        // Concurrency guard: skip if process already has an in-flight tick
        if (this.inflight.has(cron.processId)) {
            logger.debug(LogCategory.AI, `[CronExecutor] Skipping tick for cron ${cronId}: process ${cron.processId} already has in-flight tick`);
            this.rescheduleAfterSkip(cron);
            return;
        }

        // Check process status — auto-pause if cancelled or failed
        const proc = await this.deps.processStore.getProcess(cron.processId);
        if (proc) {
            const status = proc.status;
            if (status === 'cancelled' || status === 'failed') {
                this.pauseCron(cron, `auto-paused: process ${status}`);
                return;
            }

            // Skip if process is currently running — don't queue overlapping work
            if (status === 'running') {
                logger.debug(LogCategory.AI, `[CronExecutor] Skipping tick for cron ${cronId}: process is running`);
                this.rescheduleAfterSkip(cron);
                return;
            }
        }

        // Enqueue follow-up
        try {
            this.inflight.add(cron.processId);
            this.wakeupCounts.set(cron.processId, wakeupCount + 1);
            await this.enqueueFollowUp(cron);
        } catch (err) {
            this.inflight.delete(cron.processId);
            logger.error(LogCategory.AI, `[CronExecutor] Failed to enqueue tick for cron ${cronId}: ${err instanceof Error ? err.message : String(err)}`);
            // Count as a failure
            await this.onTickComplete(cronId, false);
        }
    }

    // ========================================================================
    // Internal: enqueue
    // ========================================================================

    private async enqueueFollowUp(cron: CronEntry): Promise<void> {
        const queueManager = this.deps.queueManager;
        if (!queueManager) {
            throw new Error('TaskQueueManager not available');
        }

        const logger = getLogger();

        // Find the existing task for this process so we can requeue it
        const taskId = toTaskId(cron.processId);
        const existingTask = queueManager.getTask(taskId);

        if (existingTask && existingTask.status === 'completed') {
            // Requeue from history with the cron prompt.
            // Re-resolve mode (don't trust stale value on the existing task —
            // the process's metadata.mode may have changed since the original
            // turn was enqueued).
            const mode = await resolveFollowUpMode(this.deps.processStore, cron.processId);
            queueManager.updateTask(taskId, {
                displayName: `[Cron] ${cron.description || cron.prompt.substring(0, 40)}`,
                payload: {
                    ...existingTask.payload,
                    mode,
                    prompt: cron.prompt,
                    processId: cron.processId,
                    ...(cron.model ? { model: cron.model } : {}),
                    context: {
                        ...((existingTask.payload as Record<string, unknown>).context as Record<string, unknown> ?? {}),
                        cronId: cron.id,
                        source: 'cron',
                    },
                },
            });
            if (!queueManager.requeueFromHistory(taskId)) {
                await this.enqueueNewFollowUpTask(cron);
            }
        } else if (!existingTask || existingTask.status === 'cancelled') {
            // No existing task in queue or cancelled — enqueue a new follow-up
            await this.enqueueNewFollowUpTask(cron);
        } else {
            // Task exists but is queued/running — shouldn't happen due to guards,
            // but handle gracefully
            logger.warn(LogCategory.AI, `[CronExecutor] Unexpected task status for cron ${cron.id}: ${existingTask.status}`);
            throw new Error(`Process task in unexpected state: ${existingTask.status}`);
        }
    }

    private async enqueueNewFollowUpTask(cron: CronEntry): Promise<void> {
        const queueManager = this.deps.queueManager!;
        const workspaceId = await this.deps.resolveWorkspaceId(cron.processId);
        const mode = await resolveFollowUpMode(this.deps.processStore, cron.processId);

        queueManager.enqueue({
            type: 'chat',
            priority: 'normal',
            payload: {
                kind: 'chat',
                mode,
                prompt: cron.prompt,
                processId: cron.processId,
                ...(cron.model ? { model: cron.model } : {}),
                context: {
                    cronId: cron.id,
                    source: 'cron',
                },
            },
            config: { ...(cron.model ? { model: cron.model } : {}) },
            displayName: `[Cron] ${cron.description || cron.prompt.substring(0, 40)}`,
            repoId: workspaceId,
        });
    }

    // ========================================================================
    // Internal: state transitions
    // ========================================================================

    private pauseCron(cron: CronEntry, reason: string): void {
        const logger = getLogger();
        logger.info(LogCategory.AI, `[CronExecutor] Pausing cron ${cron.id}: ${reason}`);

        this.disarmTimer(cron.id);
        cron.status = 'paused';
        cron.pausedReason = reason;
        cron.nextTickAt = null;
        this.deps.store.update(cron);

        this.deps.emit({ type: 'cron-paused', cron });
    }

    private expireCron(cron: CronEntry): void {
        const logger = getLogger();
        logger.info(LogCategory.AI, `[CronExecutor] Expiring cron ${cron.id} (TTL exceeded)`);

        this.disarmTimer(cron.id);
        cron.status = 'expired';
        cron.nextTickAt = null;
        this.deps.store.update(cron);

        this.deps.emit({ type: 'cron-expired', cron });
    }

    private isExpired(cron: CronEntry): boolean {
        return Date.now() >= new Date(cron.expiresAt).getTime();
    }

    /**
     * Reschedule a cron after a skipped tick.
     * Uses the full interval to avoid rapid retry crons.
     */
    private rescheduleAfterSkip(cron: CronEntry): void {
        this.scheduler.reschedule(cron);
    }
}
