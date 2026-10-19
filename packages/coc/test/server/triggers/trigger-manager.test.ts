/**
 * Unit tests for `TriggerManager` — the generic event→action core:
 * arm/tick/fire, disarm, restore-from-persistence, in-flight suppression,
 * evaluator-requested auto-disarm, and TTL expiry.
 *
 * Uses an in-memory SQLite-backed `TriggerStore`, a fake timer registry, and
 * fake evaluator/action-executor.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NativeDatabase as Database } from '@plusplusoneplusplus/coc-native';
import { TriggerStore } from '../../../src/server/triggers/trigger-store';
import { TriggerManager } from '../../../src/server/triggers/trigger-manager';
import type {
    EvaluationOutcome,
    EventEvaluator,
    ActionExecutor,
    OneShotFirer,
    ScriptConditionFirer,
    TriggerManagerDeps,
} from '../../../src/server/triggers/trigger-manager';
import type { PrMergedMonitorEvent, ScriptConditionEvent, Trigger, TriggerAction, TriggerEvent } from '../../../src/server/triggers/trigger-types';

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
        expiresAt: 'expiresAt' in overrides ? overrides.expiresAt! : '2099-01-01T00:00:00.000Z',
        lastTickAt: 'lastTickAt' in overrides ? overrides.lastTickAt! : null,
        nextTickAt: 'nextTickAt' in overrides ? overrides.nextTickAt! : null,
        revision: overrides.revision ?? 1,
        ...(overrides.binding ? { binding: overrides.binding } : {}),
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

describe('delegated outcome retry scheduling', () => {
    it('keeps paused pending evidence durable without retry timers or timer storms', async () => {
        const evaluate = vi.fn();
        const deliverPending = vi.fn();
        let allowed = false;
        const harness = makeManager({ evaluate }, {
            oneShotFirer: { fire: vi.fn(), deliverPending, canRetryDelivery: () => allowed },
        });
        const trigger = makeTrigger({ status: 'disarmed', expiresAt: null,
            binding: { kind: 'sentinel-todo', itemId: 'item', delegatedPr: { jobId: 'job', receiptId: 'receipt' },
                armedBy: 'sentinel', armedAt: new Date(BASE).toISOString() } });
        trigger.delivery = { deliveryId: 'receipt', state: 'pending', reason: 'closed', firedAt: new Date(BASE).toISOString() };
        harness.store.insert(trigger);
        harness.manager.armAll();
        harness.manager.schedulePendingDelivery(trigger);
        expect(harness.timer._timers.size).toBe(0);
        expect(harness.store.getById(trigger.id)?.delivery?.state).toBe('pending');
        allowed = true;
        harness.manager.schedulePendingDelivery(trigger);
        expect(harness.timer._timers.size).toBe(1);
        harness.manager.shutdownAll();
    });
});

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
    opts: {
        action?: ReturnType<typeof fakeActionExecutor>;
        emit?: TriggerManagerDeps['emit'];
        oneShotFirer?: OneShotFirer;
        scriptConditionFirer?: ScriptConditionFirer;
        scriptConditionsEnabled?: () => boolean;
    } = {},
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
        oneShotFirer: opts.oneShotFirer,
        scriptConditionFirer: opts.scriptConditionFirer,
        scriptConditionsEnabled: opts.scriptConditionsEnabled,
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
    it('runs native evidence/transport entries on its existing scheduler without creating or consuming merge rules', async () => {
        h = makeManager(fakeEvaluator({ fire: false, event: makeTrigger().event }));
        h.store.insert(makeTrigger());
        const entry = { id: 'sentinel-dependency:local-owner', dependencyPoll: true as const,
            status: 'active', nextTickAt: new Date(BASE - 1).toISOString(), owner: { workspaceId: 'ws_a', processId: 'proc_a' } };
        const tick = vi.fn(async () => {});
        const persist = vi.fn();
        const dispose = h.manager.setDependencyPolling({ entries: () => [entry], persist, tick });
        h.manager.armAll();
        expect(h.timer._delay(entry.id)).toBe(0);
        expect(h.timer._timers.has('trigger_1')).toBe(true);
        h.timer._fire(entry.id);
        await flush();
        expect(tick).toHaveBeenCalledTimes(1);
        expect(persist).toHaveBeenCalledWith(expect.objectContaining({ nextTickAt: expect.any(String) }));
        expect(h.action.calls).toEqual([]);
        expect(h.store.getById('trigger_1')?.status).toBe('active');
        dispose();
        expect(h.timer._timers.has(entry.id)).toBe(false);
        h.manager.shutdownAll();
    });

    it('suppresses concurrent native polling, keeps recovery transport-only, and respects live disablement', async () => {
        h = makeManager(fakeEvaluator({ fire: false, event: makeTrigger().event }));
        const entry = { id: 'sentinel-dependency:local-owner', dependencyPoll: true as const,
            status: 'active', nextTickAt: null, owner: { workspaceId: 'ws_a', processId: 'proc_a' } };
        let enabled = true;
        let release!: () => void;
        const tick = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
        h.manager.setDependencyPolling({ entries: () => enabled ? [entry] : [], persist: vi.fn(), tick });
        h.timer._fire(entry.id);
        h.manager.refreshDependencyPolling();
        h.timer._fire(entry.id);
        expect(tick).toHaveBeenCalledTimes(1);
        enabled = false;
        release();
        await flush();
        expect(h.timer._timers.has(entry.id)).toBe(false);
        h.manager.shutdownAll();
    });
    it('does not release a new PR repair writer on a stale or unqualified completion callback', async () => {
        h = makeManager({ evaluate: vi.fn(async t => ({ fire: true, event: t.event })) });
        h.store.insert(makeTrigger());
        await h.manager.repairNow('trigger_1');
        const event = h.store.getById('trigger_1')!.event;
        if (event.monitor !== 'ci-failure') throw new Error('Expected CI monitor');
        h.manager.onActionComplete('trigger_1', true, 'older-receipt');
        h.manager.onActionComplete('trigger_1', true);
        expect(h.store.getById('trigger_1')?.inFlight).toBe(true);
        h.manager.onActionComplete('trigger_1', true, event.repairDelivery?.id);
        expect(h.store.getById('trigger_1')?.inFlight).toBe(false);
    });
    it('serializes manual and automatic repairs across clones of a provider-qualified PR', async () => {
        const event = { ...makeTrigger().event, prKey: 'github:github.com:example/repo:42' };
        h = makeManager({ evaluate: vi.fn(async t => ({ fire: true, event: t.event, actionPrompt: 'Repair' })) });
        const first = makeTrigger({ id: 'one', event });
        const other = makeTrigger({ id: 'two', workspaceId: 'clone', processId: 'other', event: { ...event } });
        h.store.insert(first);
        h.store.insert(other);
        await h.manager.repairNow(first.id);
        await expect(h.manager.repairNow(other.id)).rejects.toThrow('writer');
        expect(h.action.calls).toHaveLength(1);
        expect(h.store.getById(other.id)?.inFlight).toBe(false);
        h.manager.onActionComplete(first.id, true, h.action.calls[0].trigger.event.repairDelivery?.id);
        await h.manager.repairNow(other.id);
        expect(h.action.calls).toHaveLength(2);
    });

    it('does not conflate the same PR number on different providers or repositories', async () => {
        h = makeManager({ evaluate: vi.fn(async t => ({ fire: true, event: t.event })) });
        for (const [id, prKey] of [
            ['gh', 'github:github.com:example/repo:42'],
            ['ado', 'ado:dev.azure.com:org/project/repo:42'],
            ['other', 'github:github.com:example/other:42'],
        ]) {
            const trigger = makeTrigger({ id, event: { ...makeTrigger().event, originId: id, prKey } });
            h.store.insert(trigger);
            await h.manager.repairNow(id);
        }
        expect(h.action.calls).toHaveLength(3);
    });

    it('keeps a stopped monitor writer reserved until its already admitted repair completes', async () => {
        const event = { ...makeTrigger().event, prKey: 'github:github.com:example/repo:42' };
        h = makeManager({ evaluate: vi.fn(async t => ({ fire: true, event: t.event })) });
        h.store.insert(makeTrigger({ id: 'stopped', status: 'disarmed', event, inFlight: true }));
        h.store.insert(makeTrigger({ id: 'new', event }));
        await expect(h.manager.repairNow('new')).rejects.toThrow('writer');
        h.manager.onActionComplete('stopped', true);
        await h.manager.repairNow('new');
        expect(h.action.calls).toHaveLength(1);
    });

    it('suppresses duplicate asynchronous evaluation/admission on the same monitor', async () => {
        let release!: () => void;
        const wait = new Promise<void>(resolve => { release = resolve; });
        h = makeManager({ evaluate: vi.fn(async t => { await wait; return { fire: true, event: t.event }; }) });
        h.store.insert(makeTrigger());
        const first = h.manager.repairNow('trigger_1');
        await expect(h.manager.repairNow('trigger_1')).rejects.toThrow('already in flight');
        release();
        await first;
        expect(h.action.calls).toHaveLength(1);
    });

    it('releases failed delivery admission with a visible backoff but not an unbounded repair loop', async () => {
        const action = fakeActionExecutor();
        action.execute = vi.fn().mockRejectedValue(new Error('No permission'));
        const event = { ...makeTrigger().event, conflictAwaitingHead: 'head', conflictAttempts: { key: 1 } };
        h = makeManager(fakeEvaluator({ fire: true, event }), { action });
        h.store.insert(makeTrigger());
        await expect(h.manager.repairNow('trigger_1')).rejects.toThrow('No permission');
        expect(h.store.getById('trigger_1')).toMatchObject({ inFlight: true, event: {
            conflictAttempts: { key: 1 }, repairDelivery: { state: 'pending', attempts: 1, retryAt: BASE + 120_000 },
            repairStatus: expect.stringContaining('delivery failed'),
        } });
        h.timer._fire('trigger_1');
        await flush();
        expect(action.execute).toHaveBeenCalledTimes(1);
        h.clock.t = BASE + 120_000;
        h.timer._fire('trigger_1');
        await flush();
        expect(action.execute).toHaveBeenCalledTimes(2);
        expect(h.store.getById('trigger_1')).toMatchObject({ event: {
            repairDelivery: { state: 'blocked', attempts: 2 }, repairStatus: expect.stringContaining('exhausted'),
        } });
        h.timer._fire('trigger_1');
        await flush();
        expect(action.execute).toHaveBeenCalledTimes(2);
    });

    it('deduplicates conflict history across monitors even after the previous writer finishes', async () => {
        const key = 'provider/head/base';
        h = makeManager({ evaluate: vi.fn(async t => ({
            fire: true, event: { ...t.event, conflictAttemptKey: key, conflictAwaitingHead: 'head' },
            repairKind: 'conflict',
        })) });
        const event = { ...makeTrigger().event, prKey: 'github:host:example/repo:42' };
        h.store.insert(makeTrigger({ id: 'previous', event: { ...event, conflictAttempts: { [key]: 1 } } }));
        h.store.insert(makeTrigger({ id: 'duplicate', event }));
        await expect(h.manager.repairNow('duplicate')).rejects.toThrow('already has a repair attempt');
        expect(h.action.calls).toHaveLength(0);
        expect(h.store.getById('duplicate')).toMatchObject({ event: {
            repairStatus: expect.stringContaining('owner chat'),
        } });
    });

    it.each(['paused', 'disarmed', 'removed'] as const)(
        'does not resurrect a %s rule when an in-flight evaluator fails', async status => {
            const trigger = makeTrigger();
            h = makeManager({ evaluate: vi.fn(async () => {
                if (status === 'removed') h.store.delete(trigger.id);
                else h.store.update({ ...trigger, status, revision: 2, nextTickAt: null });
                throw new Error('Provider read failed');
            }) });
            h.store.insert(trigger);
            h.manager.arm(trigger);
            h.timer._fire(trigger.id);
            await flush();
            expect(h.timer.has(trigger.id)).toBe(false);
            expect(h.store.getById(trigger.id)?.status).toBe(status === 'removed' ? undefined : status);
            expect(h.action.calls).toEqual([]);
        });

    it('does not admit or rearm a wake after shutdown while evaluation is in flight', async () => {
        const trigger = makeTrigger();
        h = makeManager({ evaluate: vi.fn(async () => {
            h.manager.shutdownAll();
            return { fire: true, event: trigger.event };
        }) });
        h.store.insert(trigger);
        h.manager.arm(trigger);
        h.timer._fire(trigger.id);
        await flush();
        expect(h.action.calls).toEqual([]);
        expect(h.timer.has(trigger.id)).toBe(false);
        expect(h.store.getById(trigger.id)).toEqual(trigger);
    });

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
            h.manager.onActionComplete('trigger_1', true, h.action.calls[0].trigger.event.repairDelivery?.id);
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

    describe('one-shot PR-merge watch (Sentinel To-do bound)', () => {
        const binding = { kind: 'sentinel-todo' as const, itemId: 'item_1', armedBy: 'user' as const, armedAt: '2026-01-01T00:00:00.000Z' };
        const watch = (overrides: Partial<PrMergedMonitorEvent> = {}): PrMergedMonitorEvent => ({
            type: 'condition-monitor', monitor: 'pr-merged',
            pr: { provider: 'github', host: 'github.com', repoPath: 'o/r', number: 7, url: 'https://github.com/o/r/pull/7' },
            pollIntervalMs: 300_000, consecutiveErrors: 0, ...overrides,
        });
        const bound = (event = watch()) => makeTrigger({ event, expiresAt: null, binding });

        it('hands a merge to the one-shot firer (never the action executor) after persisting the event', async () => {
            let seen: Trigger | null = null;
            const firer: OneShotFirer = {
                fire: vi.fn(async (id) => {
                    seen = h.store.getById(id);
                    const t = h.store.getById(id)!;
                    h.store.update({ ...t, status: 'disarmed', outcome: 'fired', nextTickAt: null });
                }),
            };
            h = makeManager(fakeEvaluator({ fire: true, event: watch({ lastSeenStatus: 'merged', mergeCommit: 'abc' }) }), { oneShotFirer: firer });
            h.store.insert(bound());
            h.manager.arm(h.store.getById('trigger_1')!);

            h.timer._fire('trigger_1');
            await flush();

            expect(firer.fire).toHaveBeenCalledWith('trigger_1', 'merged');
            expect((seen!.event as PrMergedMonitorEvent).mergeCommit).toBe('abc');
            expect(h.action.calls).toHaveLength(0);
            expect(h.store.getById('trigger_1')!.status).toBe('disarmed');
            expect(h.timer.has('trigger_1')).toBe(false);
        });

        it('keeps polling when the firer throws so a later tick retries', async () => {
            const firer: OneShotFirer = { fire: vi.fn(async () => { throw new Error('boom'); }) };
            h = makeManager(fakeEvaluator({ fire: true, event: watch({ lastSeenStatus: 'merged' }) }), { oneShotFirer: firer });
            h.store.insert(bound());
            h.manager.arm(h.store.getById('trigger_1')!);

            h.timer._fire('trigger_1');
            await flush();

            expect(h.store.getById('trigger_1')!.status).toBe('active');
            expect(h.timer.has('trigger_1')).toBe(true);
        });

        it('keeps polling without a configured firer', async () => {
            h = makeManager(fakeEvaluator({ fire: true, event: watch({ lastSeenStatus: 'merged' }) }));
            h.store.insert(bound());
            h.manager.arm(h.store.getById('trigger_1')!);

            h.timer._fire('trigger_1');
            await flush();

            expect(h.store.getById('trigger_1')!.status).toBe('active');
            expect(h.action.calls).toHaveLength(0);
            expect(h.timer.has('trigger_1')).toBe(true);
        });

        it('records closed-unmerged as a terminal outcome and bumps the revision', async () => {
            h = makeManager(fakeEvaluator({
                fire: false, event: watch({ lastSeenStatus: 'closed' }),
                autoDisarm: { status: 'disarmed', reason: 'PR closed without merging', outcome: 'closed-unmerged' },
            }));
            h.store.insert(bound());
            h.manager.arm(h.store.getById('trigger_1')!);

            h.timer._fire('trigger_1');
            await flush();

            const persisted = h.store.getById('trigger_1')!;
            expect(persisted).toMatchObject({
                status: 'disarmed', outcome: 'closed-unmerged', outcomeReason: 'PR closed without merging', revision: 2,
            });
            expect((persisted.event as PrMergedMonitorEvent).lastSeenStatus).toBe('closed');
            expect(h.timer.has('trigger_1')).toBe(false);
        });

        it('never expires a rule without an expiry', async () => {
            const evaluator = fakeEvaluator({ fire: false, event: watch({ lastSeenStatus: 'open' }) });
            h = makeManager(evaluator);
            h.store.insert(bound());
            h.manager.arm(h.store.getById('trigger_1')!);

            h.clock.t = BASE + 10 * 365 * 24 * 60 * 60 * 1000;
            h.timer._fire('trigger_1');
            await flush();

            expect(evaluator.evaluate).toHaveBeenCalled();
            expect(h.store.getById('trigger_1')!.status).toBe('active');
        });

        it('backs off after read errors and emits the error state', async () => {
            const emit = vi.fn();
            h = makeManager(fakeEvaluator({
                fire: false, changed: true,
                event: watch({ consecutiveErrors: 2, lastError: { message: 'login failed', at: 'now' } }),
            }), { emit });
            h.store.insert(bound());
            h.manager.arm(h.store.getById('trigger_1')!);

            h.timer._fire('trigger_1');
            await flush();

            expect(h.timer._delay('trigger_1')).toBe(1_200_000);
            expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'trigger-updated' }));
            const persisted = h.store.getById('trigger_1')!;
            expect(persisted.status).toBe('active');
            expect((persisted.event as PrMergedMonitorEvent).lastError?.message).toBe('login failed');
        });

        it('discards a stale outcome when the rule was edited during evaluation', async () => {
            const firer: OneShotFirer = { fire: vi.fn(async () => {}) };
            let release!: () => void;
            const gate = new Promise<void>(r => { release = r; });
            const evaluator: EventEvaluator = {
                evaluate: vi.fn(async () => { await gate; return { fire: true, event: watch({ lastSeenStatus: 'merged' }) }; }),
            };
            h = makeManager(evaluator, { oneShotFirer: firer });
            h.store.insert(bound());
            h.manager.arm(h.store.getById('trigger_1')!);

            h.timer._fire('trigger_1');
            const edited = h.store.getById('trigger_1')!;
            h.store.update({ ...edited, event: watch({ pr: { ...watch().pr, number: 8 } }), revision: 2 });
            release();
            await flush();

            expect(firer.fire).not.toHaveBeenCalled();
            const persisted = h.store.getById('trigger_1')!;
            expect((persisted.event as PrMergedMonitorEvent).pr.number).toBe(8);
            expect((persisted.event as PrMergedMonitorEvent).lastSeenStatus).toBeUndefined();
            expect(h.timer.has('trigger_1')).toBe(true);
        });
    });
});


describe('script-condition repeating scheduler', () => {
    const scriptEvent = (extra = {}): ScriptConditionEvent => ({
        type: 'script-condition', script: 'return 1', scriptRevision: 1, intervalMs: 300_000,
        consecutiveFailures: 0, paused: false, ...extra,
    });
    const rule = () => makeTrigger({ event: scriptEvent(), expiresAt: null,
        binding: { kind: 'sentinel-todo', itemId: 'item', armedBy: 'sentinel', armedAt: new Date(BASE).toISOString() } });
    function setup(evaluator: EventEvaluator, enabled = () => true) {
        const firer: ScriptConditionFirer = {
            fireScriptResult: vi.fn(async (id, event) => {
                const current = h.store.getById(id)!;
                expect(current.event).not.toEqual(event);
                h.store.update({ ...current, event, revision: current.revision + 1,
                    delivery: { deliveryId: 'receipt', reason: 'script-changed', state: 'delivered',
                        firedAt: new Date(BASE).toISOString(), resultHash: event.lastResultHash, scriptRevision: event.scriptRevision } });
            }),
            pauseScriptCondition: vi.fn(async (id, event) => {
                const current = h.store.getById(id)!;
                expect(current.event).toMatchObject({ consecutiveFailures: 4, paused: false });
                h.store.update({ ...current, event, status: 'paused', nextTickAt: null, revision: current.revision + 1,
                    delivery: { deliveryId: 'paused-receipt', reason: 'script-paused', state: 'pending',
                        firedAt: new Date(BASE).toISOString(), scriptRevision: event.scriptRevision } });
            }),
            canRetryDelivery: t => t.delivery?.state === 'pending',
            deliverPending: vi.fn(async id => {
                const current = h.store.getById(id)!;
                h.store.update({ ...current, delivery: { ...current.delivery!, state: 'delivered' } });
            }),
        };
        const h = makeManager(evaluator, { scriptConditionFirer: firer, scriptConditionsEnabled: enabled });
        h.store.insert(rule());
        h.manager.armAll();
        return { ...h, firer };
    }
    async function tick(h: ReturnType<typeof setup>) { h.timer._fire('trigger_1'); await flush(); }

    it('stores silent baselines and uses script cadence without invoking an action', async () => {
        const event = scriptEvent({ lastResult: '1', lastResultHash: 'one' });
        const h = setup(fakeEvaluator({ fire: false, event, changed: true }));
        expect(h.timer._delay('trigger_1')).toBe(300_000);
        await tick(h);
        expect(h.store.getById('trigger_1')).toMatchObject({ event, lastTickAt: new Date(BASE).toISOString(), status: 'active' });
        expect(h.firer.fireScriptResult).not.toHaveBeenCalled();
        expect(h.action.calls).toHaveLength(0);
        expect(h.timer._delay('trigger_1')).toBe(300_000);
    });

    it('fires repeatedly through the script firer before advancing the baseline', async () => {
        let n = 1;
        const h = setup(fakeEvaluator(() => ({ fire: true, event: scriptEvent({ lastResult: String(++n), lastResultHash: String(n) }) })));
        h.store.update({ ...rule(), event: scriptEvent({ lastResult: '1', lastResultHash: '1' }) });
        await tick(h);
        await tick(h);
        expect(h.firer.fireScriptResult).toHaveBeenCalledTimes(2);
        expect(h.firer.fireScriptResult).toHaveBeenLastCalledWith('trigger_1', expect.objectContaining({ lastResult: '3' }), 2);
        expect(h.store.getById('trigger_1')).toMatchObject({ status: 'active', event: { lastResult: '3' } });
        expect(h.action.calls).toHaveLength(0);
        expect(h.timer.has('trigger_1')).toBe(true);
    });

    it('preserves the old baseline when result commit fails and retries later', async () => {
        const h = setup(fakeEvaluator({ fire: true, event: scriptEvent({ lastResult: '2', lastResultHash: 'two' }) }));
        h.store.update({ ...rule(), event: scriptEvent({ lastResult: '1', lastResultHash: 'one' }) });
        vi.mocked(h.firer.fireScriptResult).mockRejectedValueOnce(new Error('store busy'));
        await tick(h);
        expect(h.store.getById('trigger_1')?.event).toMatchObject({ lastResult: '1' });
        await tick(h);
        expect(h.store.getById('trigger_1')?.event).toMatchObject({ lastResult: '2' });
    });

    it('retries a pending wake before evaluation and resumes polling after acknowledgement', async () => {
        const evaluator = fakeEvaluator({ fire: false, event: scriptEvent() });
        const h = setup(evaluator);
        const current = h.store.getById('trigger_1')!;
        h.store.update({ ...current, delivery: { deliveryId: 'receipt', state: 'pending', reason: 'script-changed', firedAt: new Date(BASE).toISOString() } });
        await tick(h);
        expect(evaluator.evaluate).not.toHaveBeenCalled();
        expect(h.firer.deliverPending).toHaveBeenCalledTimes(1);
        expect(h.timer.has('trigger_1')).toBe(true);
        await tick(h);
        expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
    });

    it('persists failure backoff then resets cadence after success', async () => {
        let event = scriptEvent({ consecutiveFailures: 2, lastError: { message: 'failed', at: 'now' } });
        const h = setup(fakeEvaluator(() => ({ fire: false, event, changed: true })));
        await tick(h);
        expect(h.timer._delay('trigger_1')).toBe(1_200_000);
        event = scriptEvent({ lastResult: '1', lastResultHash: 'one' });
        await tick(h);
        expect(h.timer._delay('trigger_1')).toBe(300_000);
        expect(h.store.getById('trigger_1')?.event).not.toHaveProperty('lastError');
    });

    it('commits the fifth failure through the pause firer, retries its notice, then stops', async () => {
        const event = scriptEvent({ consecutiveFailures: 5, paused: true, lastError: { message: 'failed', at: 'now' } });
        const evaluator = fakeEvaluator({ fire: false, event, changed: true });
        const h = setup(evaluator);
        h.store.update({ ...rule(), event: scriptEvent({ consecutiveFailures: 4 }) });
        await tick(h);
        expect(h.firer.pauseScriptCondition).toHaveBeenCalledWith('trigger_1', event, 1);
        expect(h.store.getById('trigger_1')?.status).toBe('paused');
        expect(h.timer.has('trigger_1')).toBe(true);
        await tick(h);
        expect(h.firer.deliverPending).toHaveBeenCalledTimes(1);
        expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
        expect(h.timer.has('trigger_1')).toBe(false);
    });

    it('stops the fifth failed run even if its owner/item is no longer eligible for a notice', async () => {
        const event = scriptEvent({ consecutiveFailures: 5, paused: true, lastError: { message: 'failed', at: 'now' } });
        const h = setup(fakeEvaluator({ fire: false, event }));
        h.store.update({ ...rule(), event: scriptEvent({ consecutiveFailures: 4 }) });
        vi.mocked(h.firer.pauseScriptCondition).mockResolvedValue(undefined);
        await tick(h);
        expect(h.store.getById('trigger_1')).toMatchObject({ status: 'paused', event, nextTickAt: null });
        expect(h.timer.has('trigger_1')).toBe(false);
    });

    it('restores pending pause notices on startup without running scripts', async () => {
        const evaluator = fakeEvaluator({ fire: false, event: scriptEvent() });
        const h = setup(evaluator);
        h.manager.disarm('trigger_1');
        h.store.update({ ...rule(), status: 'paused', event: scriptEvent({ paused: true, consecutiveFailures: 5 }),
            delivery: { deliveryId: 'pause', reason: 'script-paused', state: 'pending', firedAt: new Date(BASE).toISOString() } });
        h.manager.armAll();
        await tick(h);
        expect(h.firer.deliverPending).toHaveBeenCalledTimes(1);
        expect(evaluator.evaluate).not.toHaveBeenCalled();
        expect(h.timer.has('trigger_1')).toBe(false);
    });

    it('keeps rules stored when live gates turn off and resumes scheduling when enabled', async () => {
        let enabled = false;
        const evaluator = fakeEvaluator({ fire: false, event: scriptEvent() });
        const h = setup(evaluator, () => enabled);
        expect(h.timer.has('trigger_1')).toBe(false);
        enabled = true;
        h.manager.refreshScriptConditions();
        expect(h.timer.has('trigger_1')).toBe(true);
        enabled = false;
        await tick(h);
        expect(evaluator.evaluate).not.toHaveBeenCalled();
        expect(h.store.getById('trigger_1')).toEqual(rule());
    });

    it.each(['edit', 'flag', 'shutdown'] as const)('discards an evaluation after %s during the run', async reason => {
        let release!: (value: EvaluationOutcome) => void;
        let enabled = true;
        const evaluator = { evaluate: vi.fn(() => new Promise<EvaluationOutcome>(r => { release = r; })) };
        const h = setup(evaluator, () => enabled);
        h.timer._fire('trigger_1');
        if (reason === 'edit') h.store.update({ ...rule(), revision: 2, event: scriptEvent({ scriptRevision: 2 }) });
        if (reason === 'flag') enabled = false;
        if (reason === 'shutdown') h.manager.shutdownAll();
        release({ fire: true, event: scriptEvent({ lastResult: '2', lastResultHash: 'two' }) });
        await flush();
        expect(h.firer.fireScriptResult).not.toHaveBeenCalled();
        expect(h.store.getById('trigger_1')?.event).not.toHaveProperty('lastResult');
    });

    it('retries failed pending deliveries without reevaluating the script', async () => {
        const evaluator = fakeEvaluator({ fire: false, event: scriptEvent() });
        const h = setup(evaluator);
        h.store.update({ ...rule(), delivery: { deliveryId: 'receipt', state: 'pending', reason: 'script-changed', firedAt: new Date(BASE).toISOString() } });
        vi.mocked(h.firer.deliverPending!).mockRejectedValueOnce(new Error('queue unavailable'));
        await tick(h);
        expect(evaluator.evaluate).not.toHaveBeenCalled();
        expect(h.store.getById('trigger_1')?.delivery?.state).toBe('pending');
        expect(h.timer.has('trigger_1')).toBe(true);
        await tick(h);
        expect(h.store.getById('trigger_1')?.delivery?.state).toBe('delivered');
    });

    it('keeps a pending pause decision retryable when owner lookup fails before commit', async () => {
        const event = scriptEvent({ paused: true, consecutiveFailures: 5, lastError: { message: 'failed', at: 'now' } });
        const h = setup(fakeEvaluator({ fire: false, event }));
        h.store.update({ ...rule(), event: scriptEvent({ consecutiveFailures: 4 }) });
        vi.mocked(h.firer.pauseScriptCondition).mockRejectedValueOnce(new Error('owner lookup unavailable'));
        await tick(h);
        expect(h.store.getById('trigger_1')?.event).toMatchObject({ consecutiveFailures: 4, paused: false });
        expect(h.timer.has('trigger_1')).toBe(true);
        await tick(h);
        expect(h.store.getById('trigger_1')).toMatchObject({ status: 'paused', delivery: { state: 'pending' } });
    });

    it('does not reconcile pending script wakes while the live flags are off', async () => {
        let enabled = true;
        const h = setup(fakeEvaluator({ fire: false, event: scriptEvent() }), () => enabled);
        h.store.update({ ...rule(), delivery: { deliveryId: 'receipt', state: 'pending', reason: 'script-changed', firedAt: new Date(BASE).toISOString() } });
        enabled = false;
        h.manager.refreshScriptConditions();
        await h.manager.reconcilePendingDeliveries();
        expect(h.firer.deliverPending).not.toHaveBeenCalled();
        expect(h.timer.has('trigger_1')).toBe(false);
        expect(h.store.getById('trigger_1')?.delivery?.state).toBe('pending');
    });

    it('excludes unbound, removed and delegated rules from script scheduling', () => {
        const h = setup(fakeEvaluator({ fire: false, event: scriptEvent() }));
        h.manager.disarm('trigger_1');
        for (const binding of [undefined, { ...rule().binding!, removedAt: 'now' },
            { ...rule().binding!, delegatedPr: { jobId: 'job', receiptId: 'receipt' } }]) {
            h.store.update({ ...rule(), binding });
            h.manager.armAll();
            expect(h.timer.has('trigger_1')).toBe(false);
        }
    });

    it('requires explicit script admission and a script firer', () => {
        const h = makeManager(fakeEvaluator({ fire: false, event: scriptEvent() }));
        h.store.insert(rule());
        h.manager.armAll();
        expect(h.timer.has('trigger_1')).toBe(false);
        expect(h.store.getById('trigger_1')).toEqual(rule());
    });
});
