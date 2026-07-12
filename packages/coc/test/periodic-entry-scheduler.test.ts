/**
 * Tests for the shared periodic-entry scheduling kernel.
 *
 * Covers the timer-arming lifecycle that both `LoopExecutor` and
 * `TriggerManager` delegate to: delay calculation from `nextTickAt`, overdue
 * clamping, missing/invalid-timestamp fallback, active-only arming, disarm,
 * reschedule (advance → persist → re-arm ordering), shutdown clearing with
 * domain cleanup, and clock injection.
 *
 * Cross-platform compatible (Linux/Mac/Windows) — no filesystem, no real timers.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    PeriodicEntryScheduler,
    type PeriodicEntry,
    type PeriodicEntrySchedulerDeps,
} from '../src/server/schedule/periodic-entry-scheduler';

// ============================================================================
// Helpers & stubs
// ============================================================================

interface TestEntry extends PeriodicEntry {
    intervalMs: number;
}

const BASE = Date.parse('2026-01-01T00:00:00.000Z');

function makeEntry(overrides: Partial<TestEntry> = {}): TestEntry {
    return {
        id: overrides.id ?? 'e1',
        status: overrides.status ?? 'active',
        nextTickAt: 'nextTickAt' in overrides ? overrides.nextTickAt! : null,
        intervalMs: overrides.intervalMs ?? 60_000,
    };
}

/** Minimal ScheduleTimerRegistry stub that records calls. */
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

function makeScheduler(
    overrides: Partial<PeriodicEntrySchedulerDeps<TestEntry>> = {},
): {
    scheduler: PeriodicEntryScheduler<TestEntry>;
    timer: ReturnType<typeof createTimerRegistryStub>;
    persisted: TestEntry[];
    ticked: string[];
    clock: { t: number };
} {
    const timer = createTimerRegistryStub();
    const persisted: TestEntry[] = [];
    const ticked: string[] = [];
    const clock = { t: BASE };
    const scheduler = new PeriodicEntryScheduler<TestEntry>({
        timerRegistry: overrides.timerRegistry ?? (timer as never),
        getFallbackIntervalMs: overrides.getFallbackIntervalMs ?? (entry => entry.intervalMs),
        persist: overrides.persist ?? (entry => { persisted.push({ ...entry }); }),
        onTick: overrides.onTick ?? (id => { ticked.push(id); }),
        logLabel: overrides.logLabel ?? 'TestScheduler',
        now: overrides.now ?? (() => clock.t),
        onShutdownCleanup: overrides.onShutdownCleanup,
        isActive: overrides.isActive,
    });
    return { scheduler, timer, persisted, ticked, clock };
}

// ============================================================================
// Tests
// ============================================================================

describe('PeriodicEntryScheduler', () => {
    describe('delayFor', () => {
        it('computes the remaining delay from a future nextTickAt', () => {
            const { scheduler } = makeScheduler();
            const entry = makeEntry({ nextTickAt: new Date(BASE + 30_000).toISOString() });
            expect(scheduler.delayFor(entry)).toBe(30_000);
        });

        it('clamps an overdue nextTickAt to 0 (fire immediately)', () => {
            const { scheduler } = makeScheduler();
            const entry = makeEntry({ nextTickAt: new Date(BASE - 5_000).toISOString() });
            expect(scheduler.delayFor(entry)).toBe(0);
        });

        it('falls back to the interval when nextTickAt is null', () => {
            const { scheduler } = makeScheduler();
            const entry = makeEntry({ nextTickAt: null, intervalMs: 45_000 });
            expect(scheduler.delayFor(entry)).toBe(45_000);
        });

        it('falls back to the interval for an invalid nextTickAt timestamp', () => {
            const { scheduler } = makeScheduler();
            const entry = makeEntry({ nextTickAt: 'not-a-date', intervalMs: 12_345 });
            expect(scheduler.delayFor(entry)).toBe(12_345);
        });
    });

    describe('arm', () => {
        it('arms an active entry with the computed delay', () => {
            const { scheduler, timer } = makeScheduler();
            scheduler.arm(makeEntry({ id: 'a', nextTickAt: new Date(BASE + 10_000).toISOString() }));
            expect(timer.set).toHaveBeenCalledTimes(1);
            expect(timer._delay('a')).toBe(10_000);
        });

        it('does not arm non-active entries', () => {
            const { scheduler, timer } = makeScheduler();
            scheduler.arm(makeEntry({ status: 'paused' }));
            scheduler.arm(makeEntry({ status: 'cancelled' }));
            scheduler.arm(makeEntry({ status: 'expired' }));
            expect(timer.set).not.toHaveBeenCalled();
        });

        it('fires the onTick callback with the entry id when the timer elapses', () => {
            const { scheduler, timer, ticked } = makeScheduler();
            scheduler.arm(makeEntry({ id: 'tick-me' }));
            timer._fire('tick-me');
            expect(ticked).toEqual(['tick-me']);
        });

        it('honors a custom isActive predicate', () => {
            const { scheduler, timer } = makeScheduler({
                isActive: entry => entry.status === 'armed',
            });
            scheduler.arm(makeEntry({ id: 'skip', status: 'active' }));
            scheduler.arm(makeEntry({ id: 'go', status: 'armed' }));
            expect(timer.has('skip')).toBe(false);
            expect(timer.has('go')).toBe(true);
        });
    });

    describe('armAll', () => {
        it('arms every active entry and skips inactive ones', () => {
            const { scheduler, timer } = makeScheduler();
            scheduler.armAll([
                makeEntry({ id: '1', status: 'active' }),
                makeEntry({ id: '2', status: 'active' }),
                makeEntry({ id: '3', status: 'paused' }),
            ]);
            expect(timer.set).toHaveBeenCalledTimes(2);
            expect(timer.has('1')).toBe(true);
            expect(timer.has('2')).toBe(true);
            expect(timer.has('3')).toBe(false);
        });

        it('is a no-op on an empty set', () => {
            const { scheduler, timer } = makeScheduler();
            scheduler.armAll([]);
            expect(timer.set).not.toHaveBeenCalled();
        });
    });

    describe('disarm', () => {
        it('cancels the timer for an entry', () => {
            const { scheduler, timer } = makeScheduler();
            scheduler.arm(makeEntry({ id: 'x' }));
            expect(timer.has('x')).toBe(true);
            scheduler.disarm('x');
            expect(timer.cancel).toHaveBeenCalledWith('x');
            expect(timer.has('x')).toBe(false);
        });
    });

    describe('reschedule', () => {
        it('advances nextTickAt by the fallback interval, persists, then re-arms', () => {
            const order: string[] = [];
            const timer = createTimerRegistryStub();
            const scheduler = new PeriodicEntryScheduler<TestEntry>({
                timerRegistry: {
                    ...timer,
                    set: vi.fn((...args: [string, () => void, number]) => {
                        order.push('arm');
                        return timer.set(...args);
                    }),
                } as never,
                getFallbackIntervalMs: entry => entry.intervalMs,
                persist: entry => { order.push(`persist:${entry.nextTickAt}`); },
                onTick: () => {},
                logLabel: 'TestScheduler',
                now: () => BASE,
            });

            const entry = makeEntry({ id: 'r', intervalMs: 60_000, nextTickAt: null });
            scheduler.reschedule(entry);

            const expectedNext = new Date(BASE + 60_000).toISOString();
            // nextTickAt is advanced on the entry before persistence.
            expect(entry.nextTickAt).toBe(expectedNext);
            // Persist happens before the re-arm (arm-after-persist ordering) and
            // sees the freshly advanced timestamp.
            expect(order).toEqual([`persist:${expectedNext}`, 'arm']);
        });

        it('re-arms the timer at the advanced delay', () => {
            const { scheduler, timer, persisted } = makeScheduler();
            const entry = makeEntry({ id: 'r2', intervalMs: 30_000, nextTickAt: null });
            scheduler.reschedule(entry);
            expect(persisted).toHaveLength(1);
            expect(timer._delay('r2')).toBe(30_000);
        });
    });

    describe('shutdownAll', () => {
        it('clears all timers without persisting state', () => {
            const { scheduler, timer, persisted } = makeScheduler();
            scheduler.armAll([makeEntry({ id: 'a' }), makeEntry({ id: 'b' })]);
            expect(timer._timers.size).toBe(2);

            scheduler.shutdownAll();
            expect(timer.clear).toHaveBeenCalledTimes(1);
            expect(timer._timers.size).toBe(0);
            expect(persisted).toHaveLength(0);
        });

        it('runs the optional domain cleanup after clearing timers', () => {
            const events: string[] = [];
            const timer = createTimerRegistryStub();
            timer.clear.mockImplementation(() => { events.push('clear'); timer._timers.clear(); });
            const scheduler = new PeriodicEntryScheduler<TestEntry>({
                timerRegistry: timer as never,
                getFallbackIntervalMs: entry => entry.intervalMs,
                persist: () => {},
                onTick: () => {},
                logLabel: 'TestScheduler',
                onShutdownCleanup: () => { events.push('cleanup'); },
            });

            scheduler.shutdownAll();
            expect(events).toEqual(['clear', 'cleanup']);
        });

        it('does not require a shutdown cleanup callback', () => {
            const { scheduler, timer } = makeScheduler();
            expect(() => scheduler.shutdownAll()).not.toThrow();
            expect(timer.clear).toHaveBeenCalledTimes(1);
        });
    });

    describe('clock injection', () => {
        it('uses the injected clock for delay computation', () => {
            const { scheduler, clock } = makeScheduler();
            const entry = makeEntry({ nextTickAt: new Date(BASE + 40_000).toISOString() });
            clock.t = BASE + 10_000;
            expect(scheduler.delayFor(entry)).toBe(30_000);
        });

        it('defaults to Date.now when no clock is injected', () => {
            const timer = createTimerRegistryStub();
            const scheduler = new PeriodicEntryScheduler<TestEntry>({
                timerRegistry: timer as never,
                getFallbackIntervalMs: entry => entry.intervalMs,
                persist: () => {},
                onTick: () => {},
                logLabel: 'TestScheduler',
            });
            const future = new Date(Date.now() + 20_000).toISOString();
            const delay = scheduler.delayFor(makeEntry({ nextTickAt: future }));
            // Allow tolerance for execution time.
            expect(delay).toBeGreaterThan(19_000);
            expect(delay).toBeLessThanOrEqual(20_000);
        });
    });
});
