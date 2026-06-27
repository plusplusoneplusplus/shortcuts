/**
 * Trigger Manager Tests
 *
 * Unit tests for `TriggerManager` — the generic event→action core:
 * arm/tick/fire, disarm, restore-from-persistence, in-flight suppression,
 * evaluator-requested auto-disarm, and TTL expiry.
 *
 * Uses an in-memory SQLite-backed `TriggerStore`, a fake timer registry, and
 * fake evaluator/action-executor. Cross-platform safe (no file I/O).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { TriggerStore } from '../../../src/server/triggers/trigger-store';
import { TriggerManager } from '../../../src/server/triggers/trigger-manager';
import type {
    EvaluationOutcome,
    EventEvaluator,
    ActionExecutor,
    TriggerManagerDeps,
} from '../../../src/server/triggers/trigger-manager';
import type { Trigger, TriggerAction, TriggerEvent } from '../../../src/server/triggers/trigger-types';

// ============================================================================
// Helpers & fakes
// ============================================================================

const BASE = Date.parse('2026-01-01T00:00:00.000Z');

function makeTrigger(overrides: Partial<Trigger> = {}): Trigger {
    return {
        id: overrides.id ?? 'trigger_1',
        workspaceId: overrides.workspaceId ?? 'ws_a',
        processId: overrides.processId ?? 'proc_a',
        status: overrides.status ?? 'active',
        event: overrides.event ?? {
            type: 'condition-monitor',
            monitor: 'ci-failure',
            originId: 'origin_1',
            prId: '42',
            pollIntervalMs: 60_000,
            lastSeenChecks: { build: 'success' },
        },
        action: overrides.action ?? {
            type: 'send-message',
            processId: 'proc_a',
            prompt: 'fix the CI',
            mode: 'autopilot',
        },
        inFlight: overrides.inFlight ?? false,
        createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
        expiresAt: overrides.expiresAt ?? '2099-01-01T00:00:00.000Z',
        lastTickAt: 'lastTickAt' in overrides ? overrides.lastTickAt! : null,
        nextTickAt: 'nextTickAt' in overrides ? overrides.nextTickAt! : null,
    };
}

function createTimerRegistryStub() {
    const timers = new Map<string, { callback: () => void; delayMs: number }>();
    return {
        set: vi.fn((id: string, callback: () => void, delayMs: number) => {
            timers.set(id, { callback, delayMs });
            return { wasCapped: false };
        }),
        cancel: vi.fn((id: string) => { timers.delete(id); }),
        has: vi.fn((id: string) => timers.has(id)),
        clear: vi.fn(() => timers.clear()),
        _fire: (id: string) => {
            const entry = timers.get(id);
            if (entry) { timers.delete(id); entry.callback(); }
        },
        _delay: (id: string) => timers.get(id)?.delayMs,
        _timers: timers,
    };
}

function fakeEvaluator(outcome: EvaluationOutcome | (() => EvaluationOutcome)): EventEvaluator {
    return {
        evaluate: vi.fn(async () => (typeof outcome === 'function' ? outcome() : outcome)),
    };
}

function fakeActionExecutor(): ActionExecutor & { calls: Array<{ trigger: Trigger; action: TriggerAction; prompt: string }> } {
    const calls: Array<{ trigger: Trigger; action: TriggerAction; prompt: string }> = [];
    return {
        calls,
        execute: vi.fn(async (trigger, action, prompt) => { calls.push({ trigger, action, prompt }); }),
    };
}

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

interface Harness {
    store: TriggerStore;
    timer: ReturnType<typeof createTimerRegistryStub>;
    manager: TriggerManager;
    action: ReturnType<typeof fakeActionExecutor>;
    clock: { t: number };
}

function makeManager(
    evaluator: EventEvaluator,
    opts: { action?: ReturnType<typeof fakeActionExecutor>; emit?: TriggerManagerDeps['emit'] } = {},
): Harness {
    const store = new TriggerStore(new Database(':memory:'));
    const timer = createTimerRegistryStub();
    const action = opts.action ?? fakeActionExecutor();
    const clock = { t: BASE };
    const manager = new TriggerManager({
        store,
        timerRegistry: timer as any,
        resolveEvaluator: () => evaluator,
        actionExecutor: action,
        emit: opts.emit,
        now: () => clock.t,
    });
    return { store, timer, manager, action, clock };
}

// ============================================================================
// Tests
// ============================================================================

describe('TriggerManager', () => {
    let h: Harness;

    describe('arm + tick → fire', () => {
        beforeEach(() => {
            const failing: TriggerEvent = {
                type: 'condition-monitor', monitor: 'ci-failure', originId: 'o', prId: '42',
                pollIntervalMs: 60_000, lastSeenChecks: { build: 'failure' },
            };
            h = makeManager(fakeEvaluator({ fire: true, event: failing, actionPrompt: 'go fix PR 42' }));
        });

        it('arms a timer and, on tick, fires the action and sets the in-flight guard', async () => {
            const trigger = makeTrigger();
            h.store.insert(trigger);
            h.manager.arm(trigger);
            expect(h.timer.has('trigger_1')).toBe(true);

            h.timer._fire('trigger_1');
            await flush();

            expect(h.action.calls).toHaveLength(1);
            expect(h.action.calls[0].prompt).toBe('go fix PR 42');
            const persisted = h.store.getById('trigger_1')!;
            expect(persisted.inFlight).toBe(true);
            expect(persisted.event.lastSeenChecks).toEqual({ build: 'failure' });
            expect(persisted.nextTickAt).toBe(new Date(BASE + 60_000).toISOString());
            // Reschedules another tick after firing.
            expect(h.timer.has('trigger_1')).toBe(true);
        });

        it('emits a trigger-fired change event', async () => {
            const emit = vi.fn();
            h = makeManager(
                fakeEvaluator({ fire: true, event: makeTrigger().event }),
                { emit },
            );
            const trigger = makeTrigger();
            h.store.insert(trigger);
            h.manager.arm(trigger);
            h.timer._fire('trigger_1');
            await flush();
            expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'trigger-fired' }));
        });

        it('does not fire when status is not active', async () => {
            const trigger = makeTrigger({ status: 'active' });
            h.store.insert(trigger);
            h.manager.arm(trigger);
            // Flip to paused after arming, before the tick.
            h.store.update({ ...trigger, status: 'paused' });
            h.timer._fire('trigger_1');
            await flush();
            expect(h.action.calls).toHaveLength(0);
        });
    });

    describe('disarm', () => {
        it('cancels the timer without mutating persisted state', () => {
            h = makeManager(fakeEvaluator({ fire: false, event: makeTrigger().event }));
            const trigger = makeTrigger();
            h.store.insert(trigger);
            h.manager.arm(trigger);
            expect(h.timer.has('trigger_1')).toBe(true);

            h.manager.disarm('trigger_1');
            expect(h.timer.has('trigger_1')).toBe(false);
            expect(h.store.getById('trigger_1')!.status).toBe('active');
        });
    });

    describe('restore (armAll)', () => {
        it('re-arms active triggers using persisted nextTickAt', () => {
            h = makeManager(fakeEvaluator({ fire: false, event: makeTrigger().event }));
            // nextTickAt 30s in the future from BASE.
            const nextTickAt = new Date(BASE + 30_000).toISOString();
            h.store.insert(makeTrigger({ id: 'active_1', status: 'active', nextTickAt }));
            h.store.insert(makeTrigger({ id: 'paused_1', status: 'paused', nextTickAt }));

            h.manager.armAll();

            expect(h.timer.has('active_1')).toBe(true);
            expect(h.timer._delay('active_1')).toBe(30_000);
            // Non-active triggers are not armed.
            expect(h.timer.has('paused_1')).toBe(false);
        });

        it('fires immediately for an overdue persisted nextTickAt', () => {
            h = makeManager(fakeEvaluator({ fire: false, event: makeTrigger().event }));
            const overdue = new Date(BASE - 5_000).toISOString();
            h.store.insert(makeTrigger({ id: 'active_1', status: 'active', nextTickAt: overdue }));
            h.manager.armAll();
            expect(h.timer._delay('active_1')).toBe(0);
        });
    });

    describe('in-flight suppression', () => {
        it('suppresses a fire while a fix is in flight, then allows it once complete', async () => {
            const failing: TriggerEvent = {
                type: 'condition-monitor', monitor: 'ci-failure', originId: 'o', prId: '42',
                pollIntervalMs: 60_000, lastSeenChecks: { build: 'failure' },
            };
            h = makeManager(fakeEvaluator({ fire: true, event: failing }));
            const trigger = makeTrigger();
            h.store.insert(trigger);
            h.manager.arm(trigger);

            // First tick fires.
            h.timer._fire('trigger_1');
            await flush();
            expect(h.action.calls).toHaveLength(1);
            expect(h.store.getById('trigger_1')!.inFlight).toBe(true);

            // Second tick while in flight is suppressed and does NOT advance state.
            h.timer._fire('trigger_1');
            await flush();
            expect(h.action.calls).toHaveLength(1);
            // Event state preserved so the pending failure is re-detected later.
            expect(h.store.getById('trigger_1')!.event.lastSeenChecks).toEqual({ build: 'failure' });

            // The in-flight fix completes.
            h.manager.onActionComplete('trigger_1', true);
            expect(h.store.getById('trigger_1')!.inFlight).toBe(false);

            // Next tick fires again.
            h.timer._fire('trigger_1');
            await flush();
            expect(h.action.calls).toHaveLength(2);
        });
    });

    describe('auto-disarm', () => {
        it('terminally disarms when the evaluator requests it (e.g. PR merged/closed)', async () => {
            h = makeManager(fakeEvaluator({
                fire: false,
                event: makeTrigger().event,
                autoDisarm: { status: 'disarmed', reason: 'PR merged' },
            }));
            const trigger = makeTrigger();
            h.store.insert(trigger);
            h.manager.arm(trigger);

            h.timer._fire('trigger_1');
            await flush();

            const persisted = h.store.getById('trigger_1')!;
            expect(persisted.status).toBe('disarmed');
            expect(persisted.nextTickAt).toBeNull();
            expect(h.timer.has('trigger_1')).toBe(false);
            expect(h.action.calls).toHaveLength(0);
        });
    });

    describe('TTL expiry', () => {
        it('expires the trigger and stops polling once the TTL elapses', async () => {
            const evaluator = fakeEvaluator({ fire: true, event: makeTrigger().event });
            h = makeManager(evaluator);
            const trigger = makeTrigger({ expiresAt: new Date(BASE + 1_000).toISOString() });
            h.store.insert(trigger);
            h.manager.arm(trigger);

            // Advance the clock past expiry.
            h.clock.t = BASE + 2_000;
            h.timer._fire('trigger_1');
            await flush();

            const persisted = h.store.getById('trigger_1')!;
            expect(persisted.status).toBe('expired');
            expect(persisted.nextTickAt).toBeNull();
            expect(h.timer.has('trigger_1')).toBe(false);
            expect(evaluator.evaluate).not.toHaveBeenCalled();
            expect(h.action.calls).toHaveLength(0);
        });
    });

    describe('no-fire path', () => {
        it('persists the latest observed event state and keeps polling', async () => {
            const greenAgain: TriggerEvent = {
                type: 'condition-monitor', monitor: 'ci-failure', originId: 'o', prId: '42',
                pollIntervalMs: 60_000, lastSeenChecks: { build: 'success', test: 'pending' },
            };
            h = makeManager(fakeEvaluator({ fire: false, event: greenAgain }));
            const trigger = makeTrigger();
            h.store.insert(trigger);
            h.manager.arm(trigger);

            h.timer._fire('trigger_1');
            await flush();

            const persisted = h.store.getById('trigger_1')!;
            expect(h.action.calls).toHaveLength(0);
            expect(persisted.event.lastSeenChecks).toEqual({ build: 'success', test: 'pending' });
            expect(persisted.nextTickAt).toBe(new Date(BASE + 60_000).toISOString());
            expect(h.timer.has('trigger_1')).toBe(true);
        });
    });

    describe('retry-limit notice (AC-05)', () => {
        it('does not fire, persists state, and emits a one-time change event when the cap is reached', async () => {
            const emit = vi.fn();
            const capped: TriggerEvent = {
                type: 'condition-monitor', monitor: 'ci-failure', originId: 'o', prId: '42',
                pollIntervalMs: 60_000, lastSeenChecks: { build: 'failure' },
                attemptSha: 'sha1', attemptCount: 2, attemptNotified: true,
            };
            h = makeManager(
                fakeEvaluator({ fire: false, event: capped, retryLimitReached: true }),
                { emit },
            );
            const trigger = makeTrigger();
            h.store.insert(trigger);
            h.manager.arm(trigger);

            h.timer._fire('trigger_1');
            await flush();

            // No fix enqueued.
            expect(h.action.calls).toHaveLength(0);
            // Capped state persisted; trigger stays armed so a new commit can resume.
            const persisted = h.store.getById('trigger_1')!;
            expect(persisted.status).toBe('active');
            expect(persisted.event.attemptNotified).toBe(true);
            expect(h.timer.has('trigger_1')).toBe(true);
            // Human-facing notice broadcast once.
            expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'trigger-updated' }));
        });
    });

    describe('shutdownAll', () => {
        it('clears all timers without mutating persisted state', () => {
            h = makeManager(fakeEvaluator({ fire: false, event: makeTrigger().event }));
            h.store.insert(makeTrigger({ id: 'a', status: 'active' }));
            h.store.insert(makeTrigger({ id: 'b', status: 'active' }));
            h.manager.armAll();
            expect(h.timer._timers.size).toBe(2);

            h.manager.shutdownAll();
            expect(h.timer._timers.size).toBe(0);
            expect(h.store.getById('a')!.status).toBe('active');
        });
    });
});
