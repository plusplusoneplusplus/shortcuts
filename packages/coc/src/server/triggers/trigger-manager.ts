/**
 * Trigger Manager
 *
 * Owns the per-trigger lifecycle of the generic `event → action` framework:
 *  - Arms/disarms timers via `ScheduleTimerRegistry` (no new timer plumbing).
 *  - On each tick, evaluates the trigger's event through a pluggable
 *    `EventEvaluator` (resolved by event type/monitor) and decides whether to
 *    fire the action.
 *  - Fires the action through a pluggable `ActionExecutor` (which reuses the
 *    `TaskQueueManager` / `FollowUpExecutor` follow-up path).
 *  - Enforces one-in-flight-fix-at-a-time suppression, TTL expiry, and
 *    evaluator-requested auto-disarm (e.g. PR merged/closed).
 *  - Re-arms active triggers from persisted `nextTickAt` on server startup.
 *
 * The manager is intentionally generic: it knows nothing about CI checks or
 * follow-up delivery specifics. Those live in the injected evaluator/executor.
 */

import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import type { ScheduleTimerRegistry } from '../schedule/schedule-timer-registry';
import { PeriodicEntryScheduler } from '../schedule/periodic-entry-scheduler';
import type { TriggerStore } from './trigger-store';
import type {
    Trigger,
    TriggerAction,
    TriggerEvent,
    TriggerChangeEvent,
    TriggerStatus,
} from './trigger-types';
import { DEFAULT_CI_POLL_INTERVAL_MS } from './trigger-types';

// ============================================================================
// Pluggable interfaces
// ============================================================================

/**
 * Result of evaluating a trigger's event on a tick.
 */
export interface EvaluationOutcome {
    /** Whether the action should fire now. */
    fire: boolean;
    /**
     * Updated event state to persist (e.g. refreshed `lastSeenChecks`). When
     * the manager suppresses a fire (in-flight), it deliberately does NOT
     * persist this so the pending transition is re-detected later.
     */
    event: TriggerEvent;
    /**
     * If set, the trigger should terminally stop with this status/reason
     * (e.g. PR merged/closed → `disarmed`). No further ticks are scheduled.
     */
    autoDisarm?: { status: Extract<TriggerStatus, 'disarmed' | 'expired'>; reason: string };
    /**
     * Optional prompt override for the action (e.g. a message naming the
     * failing checks). Falls back to `trigger.action.prompt` when absent.
     */
    actionPrompt?: string;
    /**
     * Set by an evaluator when a fire was withheld because the per-head-SHA
     * retry cap was reached (AC-05, {@link MAX_CI_FIX_ATTEMPTS}). The manager
     * surfaces this once as a human-facing notice (log + `trigger-updated`
     * change event). Cleared automatically once a new commit resets the count.
     */
    retryLimitReached?: boolean;
}

/** Evaluates a trigger's event each tick. One per event kind. */
export interface EventEvaluator {
    evaluate(trigger: Trigger): Promise<EvaluationOutcome>;
}

/**
 * Delivers a trigger's action. The default implementation enqueues a follow-up
 * via the `TaskQueueManager`; completion is reported back asynchronously
 * through {@link TriggerManager.onActionComplete}.
 */
export interface ActionExecutor {
    execute(trigger: Trigger, action: TriggerAction, prompt: string): Promise<void>;
}

export type TriggerEventEmit = (event: TriggerChangeEvent) => void;

export interface TriggerManagerDeps {
    store: TriggerStore;
    timerRegistry: ScheduleTimerRegistry;
    /** Resolve the evaluator for a given event (by type/monitor). */
    resolveEvaluator: (event: TriggerEvent) => EventEvaluator | undefined;
    actionExecutor: ActionExecutor;
    emit?: TriggerEventEmit;
    /** Clock injection for deterministic tests. Defaults to `Date.now`. */
    now?: () => number;
}

// ============================================================================
// TriggerManager
// ============================================================================

export class TriggerManager {
    private readonly deps: TriggerManagerDeps;
    private readonly now: () => number;

    /** Shared timer-arming lifecycle kernel (delay/overdue/reschedule/shutdown). */
    private readonly scheduler: PeriodicEntryScheduler<Trigger>;

    constructor(deps: TriggerManagerDeps) {
        this.deps = deps;
        this.now = deps.now ?? Date.now;
        this.scheduler = new PeriodicEntryScheduler<Trigger>({
            timerRegistry: deps.timerRegistry,
            getFallbackIntervalMs: trigger => getPollInterval(trigger.event),
            persist: trigger => this.deps.store.update(trigger),
            onTick: id => { void this.onTick(id); },
            logLabel: 'TriggerManager',
            now: this.now,
        });
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Arm timers for all active triggers. Called once at server startup after
     * triggers are loaded from the DB.
     */
    armAll(): void {
        this.scheduler.armAll(this.deps.store.getActive());
    }

    /**
     * Arm the timer for a single trigger. Computes the delay from `nextTickAt`
     * (or falls back to the event's poll cadence from now).
     */
    arm(trigger: Trigger): void {
        this.scheduler.arm(trigger);
    }

    /** Cancel the timer for a trigger (does not mutate persisted state). */
    disarm(triggerId: string): void {
        this.scheduler.disarm(triggerId);
    }

    /**
     * Disarm all active trigger timers during shutdown without mutating
     * persisted state. Active triggers re-arm on the next startup.
     */
    shutdownAll(): void {
        this.scheduler.shutdownAll();
    }

    /**
     * Report that an in-flight action finished (success or failure). Clears the
     * suppression guard so the next failing transition can fire again — subject
     * to the per-head-SHA retry cap enforced by the CI-failure evaluator
     * ({@link MAX_CI_FIX_ATTEMPTS}). The trigger keeps polling either way.
     */
    onActionComplete(triggerId: string, _success: boolean): void {
        const trigger = this.deps.store.getById(triggerId);
        if (!trigger) return;
        if (!trigger.inFlight) return;
        trigger.inFlight = false;
        this.deps.store.update(trigger);
        this.emit({ type: 'trigger-updated', trigger });
    }

    // ========================================================================
    // Internal: tick handler
    // ========================================================================

    private async onTick(triggerId: string): Promise<void> {
        const logger = getLogger();
        const trigger = this.deps.store.getById(triggerId);
        if (!trigger) {
            logger.warn(LogCategory.AI, `[TriggerManager] Tick for unknown trigger ${triggerId}`);
            return;
        }
        if (trigger.status !== 'active') return;

        // TTL expiry → terminal auto-disarm.
        if (this.now() >= new Date(trigger.expiresAt).getTime()) {
            this.terminate(trigger, 'expired', 'TTL exceeded');
            return;
        }

        const evaluator = this.deps.resolveEvaluator(trigger.event);
        if (!evaluator) {
            logger.warn(LogCategory.AI, `[TriggerManager] No evaluator for event type ${trigger.event.type}; rescheduling`);
            this.reschedule(trigger);
            return;
        }

        let outcome: EvaluationOutcome;
        try {
            outcome = await evaluator.evaluate(trigger);
        } catch (err) {
            logger.warn(LogCategory.AI, `[TriggerManager] Evaluator error for ${triggerId}: ${err instanceof Error ? err.message : String(err)}`);
            this.reschedule(trigger);
            return;
        }

        // Re-read in case state changed during the async evaluate (e.g. the
        // in-flight action completed and cleared the guard).
        const current = this.deps.store.getById(triggerId);
        if (!current || current.status !== 'active') return;
        current.lastTickAt = new Date(this.now()).toISOString();

        // Evaluator-requested terminal auto-disarm (e.g. PR merged/closed).
        if (outcome.autoDisarm) {
            this.terminate(current, outcome.autoDisarm.status, outcome.autoDisarm.reason);
            return;
        }

        if (outcome.fire && !current.inFlight) {
            // Fire: advance state, set the suppression guard, reschedule, then
            // enqueue the action.
            current.inFlight = true;
            current.event = outcome.event;
            this.reschedule(current);
            this.emit({ type: 'trigger-fired', trigger: current });

            const prompt = outcome.actionPrompt ?? current.action.prompt;
            try {
                await this.deps.actionExecutor.execute(current, current.action, prompt);
            } catch (err) {
                logger.error(LogCategory.AI, `[TriggerManager] Action execute failed for ${triggerId}: ${err instanceof Error ? err.message : String(err)}`);
                // Roll back the guard so a later tick can retry.
                this.onActionComplete(triggerId, false);
            }
            return;
        }

        if (outcome.fire && current.inFlight) {
            // Suppressed: a fix is already in flight. Deliberately do NOT
            // persist the advanced event state, so the pending failing
            // transition is re-detected once the in-flight fix completes.
            logger.debug(LogCategory.AI, `[TriggerManager] Suppressing fire for ${triggerId} (fix in flight)`);
            this.reschedule(current);
            return;
        }

        // No fire: track the latest observed state and keep polling.
        current.event = outcome.event;
        this.reschedule(current);

        // Surface a one-time human-facing notice when the per-head-SHA retry cap
        // is first reached (AC-05). The trigger stays armed so a new commit can
        // reset the cap and resume auto-fixing.
        if (outcome.retryLimitReached) {
            logger.warn(
                LogCategory.AI,
                `[TriggerManager] CI auto-fix retry limit reached for ${triggerId}; pausing auto-fixes until a new commit`,
            );
            this.emit({ type: 'trigger-updated', trigger: current });
        }
    }

    // ========================================================================
    // Internal: state transitions
    // ========================================================================

    /** Persist `nextTickAt` and (re)arm the timer at the event's poll cadence. */
    private reschedule(trigger: Trigger): void {
        this.scheduler.reschedule(trigger);
    }

    /** Terminally stop a trigger (expired/disarmed) and cancel its timer. */
    private terminate(trigger: Trigger, status: Extract<TriggerStatus, 'disarmed' | 'expired'>, reason: string): void {
        getLogger().info(LogCategory.AI, `[TriggerManager] ${status} trigger ${trigger.id}: ${reason}`);
        this.disarm(trigger.id);
        trigger.status = status;
        trigger.nextTickAt = null;
        this.deps.store.update(trigger);
        this.emit({ type: status === 'expired' ? 'trigger-expired' : 'trigger-disarmed', trigger });
    }

    private emit(event: TriggerChangeEvent): void {
        if (!this.deps.emit) return;
        try {
            this.deps.emit(event);
        } catch {
            // Best-effort broadcast — never let a listener break the tick.
        }
    }
}

// ============================================================================
// Helpers
// ============================================================================

/** Poll cadence for an event. Only `condition-monitor` exists this iteration. */
function getPollInterval(event: TriggerEvent): number {
    if (event.type === 'condition-monitor') return event.pollIntervalMs;
    return DEFAULT_CI_POLL_INTERVAL_MS;
}
