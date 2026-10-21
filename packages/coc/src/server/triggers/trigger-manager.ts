/**
 * Owns the per-trigger lifecycle of the generic `event → action` framework:
 *  - Arms/disarms timers via `ScheduleTimerRegistry` (no new timer plumbing).
 *  - On each tick, evaluates the trigger's event through a pluggable
 *    `EventEvaluator` (resolved by event type/monitor) and decides whether to
 *    fire the action.
 *  - Fires the action through a pluggable `ActionExecutor` (which reuses the
 *    `TaskQueueManager` / `FollowUpExecutor` follow-up path).
 *  - Hands fires of bound one-shot triggers (Sentinel To-do PR-merge wake
 *    rules) to an injected `OneShotFirer` instead of the action executor.
 *  - Enforces one-in-flight-fix-at-a-time suppression, TTL expiry, and
 *    evaluator-requested auto-disarm (e.g. PR merged/closed).
 *  - Re-arms active triggers from persisted `nextTickAt` on server startup.
 *
 * The manager is intentionally generic: it knows nothing about CI checks or
 * follow-up delivery specifics. Those live in the injected evaluator/executor.
 */

import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import { randomUUID } from 'crypto';
import type { ScheduleTimerRegistry } from '../schedule/schedule-timer-registry';
import { PeriodicEntryScheduler } from '../schedule/periodic-entry-scheduler';
import type { TriggerStore } from './trigger-store';
import type {
    Trigger,
    TriggerAction,
    TriggerEvent,
    TriggerChangeEvent,
    TriggerDelivery,
    TriggerOutcome,
    TriggerStatus,
} from './trigger-types';
import { DEFAULT_CI_POLL_INTERVAL_MS, DEFAULT_PR_MERGE_POLL_INTERVAL_MS, MAX_CONFLICT_FIX_TOTAL, isTriggerExpired } from './trigger-types';
import { getPrMergedPollDelay } from './pr-merged-evaluator';

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
    autoDisarm?: {
        status: Extract<TriggerStatus, 'disarmed' | 'expired'>;
        reason: string;
        /** Terminal one-shot result recorded with the stop (e.g. `closed-unmerged`). */
        outcome?: TriggerOutcome;
    };
    /**
     * Optional prompt override for the action (e.g. a message naming the
     * failing checks). Falls back to `trigger.action.prompt` when absent.
     */
    actionPrompt?: string;
    repairKind?: 'ci' | 'conflict';
    /**
     * Set by an evaluator when a fire was withheld because the per-head-SHA
     * retry cap was reached (AC-05, {@link MAX_CI_FIX_ATTEMPTS}). The manager
     * surfaces this once as a human-facing notice (log + `trigger-updated`
     * change event). Cleared automatically once a new commit resets the count.
     */
    retryLimitReached?: boolean;
    /**
     * The persisted event changed in a way watchers should see (e.g. a merge
     * watch entered or left its read-error state); emits `trigger-updated`.
     */
    changed?: boolean;
}

export interface EvaluationOptions {
    manualCi?: boolean;
    refreshOutcome?: boolean;
}

/** Evaluates a trigger's event each tick. One per event kind. */
export interface EventEvaluator {
    evaluate(trigger: Trigger, options?: EvaluationOptions): Promise<EvaluationOutcome>;
}

/**
 * Delivers a trigger's action. The default implementation enqueues a follow-up
 * via the `TaskQueueManager`; completion is reported back asynchronously
 * through {@link TriggerManager.onActionComplete}.
 */
export interface ActionExecutor {
    execute(trigger: Trigger, action: TriggerAction, prompt: string): Promise<void>;
}

/**
 * Fires a one-shot (Sentinel To-do bound) trigger. Owns the item checks, the
 * durable terminal write and the wake-message delivery, so the manager never
 * calls the action executor for bound triggers. Shared by ticks and Run now.
 */
export interface OneShotFirer {
    fire(triggerId: string, reason: TriggerDelivery['reason'], expectedRevision?: number): Promise<void>;
    deliverPending?(triggerId: string): Promise<void>;
    canRetryDelivery?(trigger: Trigger): boolean;
}

export class OneShotFireConflictError extends Error {}

export type TriggerEventEmit = (event: TriggerChangeEvent) => void;

export interface DependencyPollEntry {
    id: string;
    status: string;
    nextTickAt: string | null;
    dependencyPoll: true;
    owner: { workspaceId: string; processId: string };
}

export interface DependencyPolling {
    entries(): DependencyPollEntry[];
    persist(entry: DependencyPollEntry): void;
    tick(entry: DependencyPollEntry): Promise<void>;
}

export interface PrOutcomeRegistrationEntry {
    id: string;
    status: string;
    nextTickAt: string | null;
    registrationPoll: true;
}

export interface PrOutcomeRegistrationPolling {
    entries(): PrOutcomeRegistrationEntry[];
    persist(entry: PrOutcomeRegistrationEntry): void;
    tick(entry: PrOutcomeRegistrationEntry): Promise<void>;
}

export interface TriggerManagerDeps {
    store: TriggerStore;
    timerRegistry: ScheduleTimerRegistry;
    /** Resolve the evaluator for a given event (by type/monitor). */
    resolveEvaluator: (event: TriggerEvent) => EventEvaluator | undefined;
    actionExecutor: ActionExecutor;
    /** Handles fires of bound one-shot triggers (Sentinel To-do wake rules). */
    oneShotFirer?: OneShotFirer;
    emit?: TriggerEventEmit;
    /** Clock injection for deterministic tests. Defaults to `Date.now`. */
    now?: () => number;
    dateTimeEnabled?: () => boolean;
}

// ============================================================================
// TriggerManager
// ============================================================================

export class TriggerManager {
    private readonly deps: TriggerManagerDeps;
    private readonly now: () => number;
    private stopped = false;
    private readonly ticking = new Set<string>();

    /** Shared timer-arming lifecycle kernel (delay/overdue/reschedule/shutdown). */
    private readonly scheduler: PeriodicEntryScheduler<Trigger | DependencyPollEntry | PrOutcomeRegistrationEntry>;
    private dependencyPolling?: DependencyPolling;
    private registrationPolling?: PrOutcomeRegistrationPolling;

    constructor(deps: TriggerManagerDeps) {
        this.deps = deps;
        this.now = deps.now ?? Date.now;
        this.scheduler = new PeriodicEntryScheduler<Trigger | DependencyPollEntry | PrOutcomeRegistrationEntry>({
            timerRegistry: deps.timerRegistry,
            getFallbackIntervalMs: trigger => !('registrationPoll' in trigger) && !('dependencyPoll' in trigger) && trigger.event.type === 'date-time'
                ? trigger.delivery?.state === 'pending'
                    ? Math.min(30 * 60_000, 60_000 * 2 ** Math.min(trigger.delivery.consecutiveErrors ?? 0, 5))
                    : Math.max(0, Date.parse(trigger.event.firesAt) - this.now())
                : 'registrationPoll' in trigger ? DEFAULT_PR_MERGE_POLL_INTERVAL_MS
                : 'dependencyPoll' in trigger ? DEFAULT_CI_POLL_INTERVAL_MS : trigger.delivery?.state === 'pending' && trigger.event.monitor === 'pr-merged'
                ? getPrMergedPollDelay({ ...trigger.event, consecutiveErrors: trigger.delivery.consecutiveErrors ?? 0 })
                : getPollInterval(trigger.event),
            isActive: trigger => 'registrationPoll' in trigger ? !!this.registrationPolling && trigger.status === 'active'
                : 'dependencyPoll' in trigger ? !!this.dependencyPolling && trigger.status === 'active'
                : this.eventAllowed(trigger) && (trigger.status === 'active' || this.canRetryDelivery(trigger) || hasPendingRepair(trigger)),
            persist: trigger => 'registrationPoll' in trigger ? this.registrationPolling?.persist(trigger)
                : 'dependencyPoll' in trigger ? this.dependencyPolling?.persist(trigger) : this.deps.store.update(trigger),
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
        this.scheduler.armAll(this.deps.store.getAll().filter(trigger =>
            trigger.status === 'active' || this.canRetryDelivery(trigger) || hasPendingRepair(trigger)));
        this.refreshDependencyPolling();
        this.refreshPrOutcomeRegistrationPolling();
    }

    /** Apply owner-server live gating without altering persisted rules or receipts. */
    refreshDateTime(): void {
        for (const trigger of this.deps.store.getAll()) {
            if (trigger.event.type !== 'date-time') continue;
            this.disarm(trigger.id);
            this.arm(trigger.delivery?.state === 'pending' && !trigger.nextTickAt
                ? { ...trigger, nextTickAt: trigger.delivery.firedAt } : trigger);
        }
    }

    private eventAllowed(trigger: Trigger): boolean {
        return trigger.event.type !== 'date-time' || this.deps.dateTimeEnabled?.() === true;
    }

    /** Dependency evidence/transport shares this manager's one existing scheduler. */
    setDependencyPolling(polling: DependencyPolling): () => void {
        this.dependencyPolling = polling;
        this.refreshDependencyPolling();
        return () => {
            for (const entry of polling.entries()) this.scheduler.disarm(entry.id);
            if (this.dependencyPolling === polling) this.dependencyPolling = undefined;
        };
    }

    refreshDependencyPolling(): void {
        if (!this.stopped) for (const entry of this.dependencyPolling?.entries() ?? []) this.scheduler.arm(entry);
    }

    setPrOutcomeRegistrationPolling(polling: PrOutcomeRegistrationPolling): void {
        this.registrationPolling = polling;
        this.refreshPrOutcomeRegistrationPolling();
    }

    refreshPrOutcomeRegistrationPolling(): void {
        if (!this.stopped) for (const entry of this.registrationPolling?.entries() ?? []) this.scheduler.arm(entry);
    }

    /** Reconcile durable wake receipts before ordinary queue processing starts. */
    async reconcilePendingDeliveries(): Promise<void> {
        for (const trigger of this.deps.store.getAll()) {
            if (trigger.delivery?.state === 'pending') await this.retryDelivery(trigger.id);
        }
    }

    schedulePendingDelivery(trigger: Trigger): void {
        if (!this.stopped && this.canRetryDelivery(trigger)) this.reschedule(trigger);
    }

    async checkOutcome(triggerId: string): Promise<void> {
        const trigger = this.deps.store.getById(triggerId);
        if (!trigger?.binding?.delegatedPr) return;
        if (trigger.status === 'active') return this.onTick(triggerId);
        const evaluator = this.deps.resolveEvaluator(trigger.event);
        if (!evaluator) throw new Error('Native PR outcome evaluator is unavailable');
        const result = await evaluator.evaluate(trigger, { refreshOutcome: true });
        const current = this.deps.store.getById(triggerId);
        if (!current || current.revision !== trigger.revision) return;
        current.event = result.event;
        current.lastTickAt = new Date(this.now()).toISOString();
        this.deps.store.update(current);
        this.emit({ type: 'trigger-updated', trigger: current });
        if (this.canRetryDelivery(current)) await this.retryDelivery(triggerId);
    }

    /**
     * Arm the timer for a single trigger. Computes the delay from `nextTickAt`
     * (or falls back to the event's poll cadence from now).
     */
    arm(trigger: Trigger): void {
        if (this.stopped) return;
        this.scheduler.arm(trigger);
    }

    /** Cancel the timer without mutating persisted state. */
    disarm(triggerId: string): void {
        this.scheduler.disarm(triggerId);
    }

    /**
     * Disarm all active trigger timers during shutdown without mutating
     * persisted state. Active triggers re-arm on the next startup.
     */
    shutdownAll(): void {
        this.stopped = true;
        this.scheduler.shutdownAll();
    }

    /**
     * Report that an in-flight action finished (success or failure). Clears the
     * suppression guard so the next failing transition can fire again — subject
     * to the per-head-SHA retry cap enforced by the CI-failure evaluator
     * ({@link MAX_CI_FIX_ATTEMPTS}). The trigger keeps polling either way.
     */
    onActionComplete(triggerId: string, _success: boolean, deliveryId?: string): void {
        const trigger = this.deps.store.getById(triggerId);
        if (!trigger) return;
        if (!trigger.inFlight) return;
        if (trigger.event.monitor === 'ci-failure' && trigger.event.repairDelivery
            && trigger.event.repairDelivery.id !== deliveryId) return;
        trigger.inFlight = false;
        trigger.revision += 1;
        if (trigger.event.monitor === 'ci-failure') {
            trigger.event.repairDelivery = undefined;
            trigger.event.repairStatus = _success
                ? 'Repair completed; waiting for the provider head and fresh CI'
                : 'Repair failed or resolution is ambiguous; human action required';
            if (!_success && trigger.event.conflictAwaitingHead) {
                trigger.event.conflictBlocked = trigger.event.repairStatus;
            }
        }
        this.deps.store.update(trigger);
        this.emit({ type: 'trigger-updated', trigger });
    }

    // ========================================================================
    // Internal: tick handler
    // ========================================================================

    /** Manual CI repair uses exactly the same PR-qualified writer admission. */
    async repairNow(triggerId: string): Promise<void> {
        if (this.ticking.has(triggerId)) throw new Error('PR evaluation or repair admission is already in flight');
        await this.onTick(triggerId, true);
    }

    private async onTick(triggerId: string, manualCi = false): Promise<void> {
        if (this.ticking.has(triggerId)) return;
        this.ticking.add(triggerId);
        try {
            if (triggerId.startsWith('sentinel-pr-registration:')) {
                const entry = this.registrationPolling?.entries().find(entry => entry.id === triggerId);
                if (!entry || this.stopped) return;
                try { await this.registrationPolling!.tick(entry); }
                catch (error) { getLogger().warn(LogCategory.AI, `[TriggerManager] PR outcome registration recovery failed: ${String(error)}`); }
                const current = this.registrationPolling?.entries().find(current => current.id === entry.id);
                if (!this.stopped && current) this.scheduler.reschedule(current);
                return;
            }
            if (triggerId.startsWith('sentinel-dependency:')) {
                const entry = this.dependencyPolling?.entries().find(entry => entry.id === triggerId);
                if (!entry || this.stopped) return;
                try { await this.dependencyPolling!.tick(entry); }
                catch (error) { getLogger().warn(LogCategory.AI, `[TriggerManager] Dependency evidence/transport unavailable: ${String(error)}`); }
                if (!this.stopped && this.dependencyPolling?.entries().some(current => current.id === entry.id)) this.scheduler.reschedule(entry);
                return;
            }
            await this.evaluateTick(triggerId, manualCi);
        }
        finally {
            this.ticking.delete(triggerId);
        }
    }

    private async evaluateTick(triggerId: string, manualCi: boolean): Promise<void> {
        if (this.stopped) return;
        const logger = getLogger();
        const trigger = this.deps.store.getById(triggerId);
        if (!trigger) {
            logger.warn(LogCategory.AI, `[TriggerManager] Tick for unknown trigger ${triggerId}`);
            return;
        }
        if (!this.eventAllowed(trigger)) return;
        if (trigger.delivery?.state === 'pending') {
            await this.retryDelivery(triggerId);
            return;
        }
        if (trigger.status !== 'active' && !(manualCi && trigger.status === 'paused') && !hasPendingRepair(trigger)) return;
        if (trigger.event.type === 'date-time') {
            if (Date.parse(trigger.event.firesAt) > this.now()) {
                // Capped timers and backward clock changes must not fire early.
                this.reschedule(trigger);
                return;
            }
            if (!this.deps.oneShotFirer) throw new Error('One-shot delivery admission is unavailable');
            try { await this.deps.oneShotFirer.fire(trigger.id, 'due'); }
            catch (error) {
                logger.error(LogCategory.AI, `[TriggerManager] Date/time wake failed for ${trigger.id}: ${String(error)}`);
                const failed = this.deps.store.getById(trigger.id);
                if (failed?.status === 'active' && failed.revision === trigger.revision && !failed.delivery) {
                    // Lookup failures precede the durable fire decision; avoid a zero-delay retry loop.
                    failed.outcomeReason = (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
                    failed.nextTickAt = new Date(this.now() + DEFAULT_CI_POLL_INTERVAL_MS).toISOString();
                    this.deps.store.update(failed);
                    this.emit({ type: 'trigger-updated', trigger: failed });
                    this.arm(failed);
                    return;
                }
            }
            const current = this.deps.store.getById(trigger.id);
            if (current?.status === 'active' || current && this.canRetryDelivery(current)) this.reschedule(current);
            return;
        }

        // TTL expiry → terminal auto-disarm.
        if (isTriggerExpired(trigger, this.now())) {
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
            outcome = await evaluator.evaluate(trigger, manualCi ? { manualCi: true } : undefined);
        } catch (err) {
            logger.warn(LogCategory.AI, `[TriggerManager] Evaluator error for ${triggerId}: ${err instanceof Error ? err.message : String(err)}`);
            const current = this.deps.store.getById(triggerId);
            if (current?.event.monitor === 'ci-failure') {
                current.event.repairStatus = 'Provider read failed; check authentication, permissions or provider availability';
                this.deps.store.update(current);
                this.emit({ type: 'trigger-updated', trigger: current });
            }
            if (current?.status === 'active') this.reschedule(current);
            if (manualCi) throw err;
            return;
        }

        // Re-read in case state changed during the async evaluate (e.g. the
        // in-flight action completed and cleared the guard).
        if (this.stopped) return;
        const current = this.deps.store.getById(triggerId);
        if (!current || (current.status !== 'active' && !(manualCi && current.status === 'paused') && !hasPendingRepair(current))) return;
        if (current.revision !== trigger.revision) {
            // Edited while evaluating (e.g. a new PR): the outcome is stale.
            this.reschedule(current);
            return;
        }
        if (!this.eventAllowed(current)) return;
        current.lastTickAt = new Date(this.now()).toISOString();

        // Evaluator-requested terminal auto-disarm (e.g. PR merged/closed).
        if (outcome.autoDisarm) {
            current.event = outcome.event;
            this.terminate(current, outcome.autoDisarm.status, outcome.autoDisarm.reason, outcome.autoDisarm.outcome);
            return;
        }

        if (current.inFlight && current.event.monitor === 'ci-failure' && current.event.repairDelivery?.state === 'pending') {
            if (manualCi) throw new Error('A repair is already in flight for this PR');
            await this.deliverRepair(current);
            this.reschedule(this.deps.store.getById(triggerId) ?? current);
            return;
        }
        if (current.inFlight && current.event.monitor === 'ci-failure' && current.event.repairDelivery?.state === 'blocked') {
            this.reschedule(current);
            return;
        }

        if (outcome.fire && current.binding) {
            await this.fireOneShot(current, outcome);
            return;
        }

        if (outcome.fire && !current.inFlight) {
            const prompt = outcome.actionPrompt ?? current.action.prompt;
            if (outcome.event.monitor === 'ci-failure') {
                outcome.event.repairDelivery = { id: randomUUID(), prompt, state: 'pending', attempts: 0 };
            }
            let claimBlocker = 'Waiting for the existing PR repair writer';
            const claimed = this.deps.store.transaction(() => {
                const latest = this.deps.store.getById(triggerId);
                if (!latest || latest.inFlight || latest.status !== current.status
                    || latest.revision !== current.revision || latest.lastTickAt !== trigger.lastTickAt) return false;
                if (outcome.event.monitor === 'ci-failure') {
                    const event = outcome.event;
                    const peers = this.deps.store.getAll().filter(t => t.id !== triggerId
                        && t.event.monitor === 'ci-failure'
                        && ((event.prKey && t.event.prKey === event.prKey)
                            || (t.event.originId === event.originId && t.event.prId === event.prId)));
                    if (peers.some(t => t.inFlight)) return false;
                    if (outcome.repairKind === 'conflict' && event.conflictAttemptKey) {
                        const attemptKey = event.conflictAttemptKey;
                        const previousAttempt = peers.some(t => t.event.monitor === 'ci-failure'
                            && (t.event.conflictAttempts?.[attemptKey] ?? 0) > 0);
                        const total = [latest, ...peers].reduce((sum, t) => sum + (t.event.monitor === 'ci-failure'
                            ? Object.values(t.event.conflictAttempts ?? {}).reduce((count, n) => count + n, 0) : 0), 0);
                        if (previousAttempt || total >= MAX_CONFLICT_FIX_TOTAL) {
                            claimBlocker = previousAttempt
                                ? 'This PR/head/base conflict already has a repair attempt; inspect its owner chat'
                                : 'PR conflict repair budget exhausted across owner monitors; human action required';
                            return false;
                        }
                    }
                }
                latest.inFlight = true;
                latest.event = outcome.event;
                latest.lastTickAt = current.lastTickAt;
                this.deps.store.update(latest);
                return true;
            });
            if (!claimed) {
                const latest = this.deps.store.getById(triggerId);
                if (latest?.event.monitor === 'ci-failure') {
                    const changed = latest.event.repairStatus !== claimBlocker;
                    latest.event.repairStatus = claimBlocker;
                    this.reschedule(latest);
                    if (changed) this.emit({ type: 'trigger-updated', trigger: latest });
                }
                if (manualCi) throw new Error(`A repair writer already owns this PR: ${claimBlocker}`);
                return;
            }
            // Fire: advance state, set the suppression guard, reschedule, then
            // enqueue the action.
            current.inFlight = true;
            current.event = outcome.event;
            this.reschedule(current);
            this.emit({ type: 'trigger-fired', trigger: current });

            if (current.event.monitor === 'ci-failure') {
                await this.deliverRepair(current, manualCi);
                return;
            }
            try {
                await this.deps.actionExecutor.execute(current, current.action, prompt);
            } catch (err) {
                logger.error(LogCategory.AI, `[TriggerManager] Action execute failed for ${triggerId}: ${err instanceof Error ? err.message : String(err)}`);
                this.onActionComplete(triggerId, false);
                if (manualCi) throw err;
            }
            return;
        }

        if (outcome.fire && current.inFlight) {
            // Suppressed: a fix is already in flight. Deliberately do NOT
            // persist the advanced event state, so the pending failing
            // transition is re-detected once the in-flight fix completes.
            logger.debug(LogCategory.AI, `[TriggerManager] Suppressing fire for ${triggerId} (fix in flight)`);
            this.reschedule(current);
            if (manualCi) throw new Error('A repair is already in flight for this PR');
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
        }
        if (outcome.retryLimitReached || outcome.changed) {
            this.emit({ type: 'trigger-updated', trigger: current });
        }
    }

    // ========================================================================
    // Internal: state transitions
    // ========================================================================

    private async deliverRepair(trigger: Trigger, manual = false): Promise<void> {
        if (trigger.event.monitor !== 'ci-failure') return;
        const receipt = trigger.event.repairDelivery;
        if (!receipt || receipt.state !== 'pending' || (receipt.retryAt ?? 0) > this.now()) return;
        if (receipt.attempts >= 2) {
            receipt.state = 'blocked';
            trigger.event.repairStatus = 'Repair delivery exhausted or ambiguous; inspect the owner chat before retrying';
            this.deps.store.update(trigger);
            this.emit({ type: 'trigger-updated', trigger });
            return;
        }
        receipt.attempts += 1;
        this.deps.store.update(trigger);
        try {
            await this.deps.actionExecutor.execute(trigger, trigger.action, receipt.prompt);
            const current = this.deps.store.getById(trigger.id);
            if (current?.event.monitor === 'ci-failure' && current.event.repairDelivery?.id === receipt.id) {
                current.event.repairDelivery.state = 'admitted';
                if (current.status === 'paused') {
                    this.disarm(current.id);
                    current.nextTickAt = null;
                }
                this.deps.store.update(current);
            }
        } catch (error) {
            const current = this.deps.store.getById(trigger.id);
            if (current?.event.monitor === 'ci-failure' && current.event.repairDelivery?.id === receipt.id) {
                const exhausted = receipt.attempts >= 2;
                current.event.repairDelivery.state = exhausted ? 'blocked' : 'pending';
                current.event.repairDelivery.retryAt = this.now() + 2 * current.event.pollIntervalMs;
                current.event.repairStatus = exhausted
                    ? 'Repair delivery exhausted or ambiguous; check owner chat and permissions before retrying'
                    : 'Repair delivery failed; backing off with the same durable receipt';
                this.deps.store.update(current);
                this.emit({ type: 'trigger-updated', trigger: current });
            }
            getLogger().error(LogCategory.AI, `[TriggerManager] Repair delivery failed for ${trigger.id}: ${String(error)}`);
            if (manual) throw error;
        }
    }

    /** Persist `nextTickAt` and (re)arm the timer at the event's poll cadence. */
    private reschedule(trigger: Trigger): void {
        if (!this.stopped && (trigger.status === 'active' || this.canRetryDelivery(trigger) || hasPendingRepair(trigger))) {
            this.scheduler.reschedule(trigger);
        }
        else this.deps.store.update(trigger);
    }

    private async retryDelivery(triggerId: string): Promise<void> {
        const initial = this.deps.store.getById(triggerId);
        if (!initial || !this.canRetryDelivery(initial)) return;
        const firer = this.deps.oneShotFirer;
        try {
            if (!firer?.deliverPending) {
                throw new Error('Trigger delivery admission is unavailable');
            }
            await firer.deliverPending(triggerId);
        } catch (error) {
            getLogger().error(LogCategory.AI, `[TriggerManager] Pending delivery failed for ${triggerId}: ${String(error)}`);
        }
        const current = this.deps.store.getById(triggerId);
        if (current && this.canRetryDelivery(current)) this.reschedule(current);
        else this.disarm(triggerId);
    }

    /**
     * Hand a bound one-shot fire to the `OneShotFirer` after persisting the
     * observed event (merge commit/title). Failures before the terminal commit
     * retry watching; committed pending deliveries retry through their own receipt.
     */
    private async fireOneShot(trigger: Trigger, outcome: EvaluationOutcome): Promise<void> {
        const logger = getLogger();
        trigger.event = outcome.event;
        if (!this.deps.oneShotFirer) {
            logger.warn(LogCategory.AI, `[TriggerManager] No one-shot firer for ${trigger.id}; rescheduling`);
            this.reschedule(trigger);
            return;
        }
        this.deps.store.update(trigger);
        try {
            await this.deps.oneShotFirer.fire(trigger.id,
                trigger.binding?.delegatedPr && trigger.event.monitor === 'pr-merged'
                    && trigger.event.lastSeenStatus === 'closed' ? 'closed' : 'merged');
        } catch (err) {
            logger.error(LogCategory.AI, `[TriggerManager] One-shot fire failed for ${trigger.id}: ${err instanceof Error ? err.message : String(err)}`);
        }

        const after = this.deps.store.getById(trigger.id);
        if (after?.status === 'active') this.reschedule(after);
    }

    private canRetryDelivery(trigger: Trigger): boolean {
        return this.eventAllowed(trigger) && trigger.delivery?.state === 'pending'
            && (this.deps.oneShotFirer?.canRetryDelivery?.(trigger) ?? true);
    }

    /** Terminally stop a trigger (expired/disarmed) and cancel its timer. */
    private terminate(
        trigger: Trigger,
        status: Extract<TriggerStatus, 'disarmed' | 'expired'>,
        reason: string,
        outcome?: TriggerOutcome,
    ): void {
        getLogger().info(LogCategory.AI, `[TriggerManager] ${status} trigger ${trigger.id}: ${reason}`);
        this.disarm(trigger.id);
        trigger.status = status;
        trigger.nextTickAt = null;
        if (outcome) {
            trigger.outcome = outcome;
            trigger.outcomeReason = reason;
            trigger.revision += 1;
        }
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

/** Poll cadence for an event; merge watches back off after read errors. */
function getPollInterval(event: TriggerEvent): number {
    if (event.type === 'condition-monitor' && event.monitor === 'pr-merged') return getPrMergedPollDelay(event);
    if (event.type === 'condition-monitor') return event.pollIntervalMs;
    return DEFAULT_CI_POLL_INTERVAL_MS;
}

function hasPendingRepair(trigger: Trigger): boolean {
    return trigger.status === 'paused' && trigger.inFlight && trigger.event.monitor === 'ci-failure'
        && trigger.event.repairDelivery?.state === 'pending';
}
