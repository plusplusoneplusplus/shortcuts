/**
 * Wakeup Executor Tests
 *
 * Covers the durable one-shot lifecycle: arm/fire, terminal marking, failure
 * metadata, startup re-arm (restart recovery), overdue immediate fire, cancel,
 * and the characterization that clearing the timer registry drops the in-memory
 * timer while the durable record survives for re-arming.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ScheduleTimerRegistry } from '../../../src/server/schedule/schedule-timer-registry';
import { WakeupStore } from '../../../src/server/loops/wakeup-store';
import { WakeupExecutor, wakeupTimerKey } from '../../../src/server/loops/wakeup-executor';
import type { WakeupExecuteFollowUp } from '../../../src/server/loops/wakeup-executor';
import type { WakeupEntry } from '../../../src/server/loops/wakeup-types';
import { createMockProcessStore, type MockProcessStore } from '../helpers/mock-process-store';

const BASE = Date.UTC(2026, 0, 1, 0, 0, 0); // fixed injected clock

function makeWakeup(overrides: Partial<WakeupEntry> = {}): WakeupEntry {
    return {
        id: overrides.id ?? 'wakeup_1',
        processId: overrides.processId ?? 'proc_1',
        prompt: overrides.prompt ?? 'resume me',
        model: 'model' in overrides ? overrides.model! : null,
        status: overrides.status ?? 'pending',
        createdAt: overrides.createdAt ?? new Date(BASE).toISOString(),
        firesAt: overrides.firesAt ?? new Date(BASE + 60_000).toISOString(),
        firedAt: 'firedAt' in overrides ? overrides.firedAt! : null,
        failureReason: 'failureReason' in overrides ? overrides.failureReason! : null,
        ...('workspaceId' in overrides ? { workspaceId: overrides.workspaceId } : {}),
    };
}

describe('WakeupExecutor', () => {
    let db: Database.Database;
    let store: WakeupStore;
    let processStore: MockProcessStore;
    let timerRegistry: ScheduleTimerRegistry;
    let executeFollowUp: ReturnType<typeof vi.fn>;
    let emit: ReturnType<typeof vi.fn>;

    function makeExecutor(): WakeupExecutor {
        return new WakeupExecutor({
            store,
            processStore,
            timerRegistry,
            executeFollowUp: executeFollowUp as unknown as WakeupExecuteFollowUp,
            emit,
            now: () => BASE,
        });
    }

    beforeEach(() => {
        vi.useFakeTimers();
        db = new Database(':memory:');
        store = new WakeupStore(db);
        processStore = createMockProcessStore();
        timerRegistry = new ScheduleTimerRegistry();
        executeFollowUp = vi.fn().mockResolvedValue(undefined);
        emit = vi.fn();
    });

    afterEach(() => {
        timerRegistry.clear();
        try { db.close(); } catch { /* ok */ }
        vi.useRealTimers();
    });

    describe('arm & fire', () => {
        it('fires the follow-up after the delay and marks the wakeup fired', async () => {
            const w = makeWakeup({ id: 'w1', model: 'claude-opus-4-8' });
            store.insert(w);
            makeExecutor().arm(w);

            expect(timerRegistry.has(wakeupTimerKey('w1'))).toBe(true);
            await vi.advanceTimersByTimeAsync(60_000);

            expect(executeFollowUp).toHaveBeenCalledTimes(1);
            const args = executeFollowUp.mock.calls[0];
            expect(args[0]).toBe('proc_1');
            expect(args[1]).toBe('resume me');
            expect(args[7]).toBe('claude-opus-4-8'); // model
            expect(args[8]).toEqual({ source: 'wakeup', wakeupId: 'w1' }); // turnSource

            const got = store.getById('w1')!;
            expect(got.status).toBe('fired');
            expect(got.firedAt).toBe(new Date(BASE).toISOString());
            expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'wakeup-fired' }));
            // One-shot: the timer is dropped after firing.
            expect(timerRegistry.has(wakeupTimerKey('w1'))).toBe(false);
        });

        it('does not arm a terminal wakeup', () => {
            const w = makeWakeup({ id: 'w1', status: 'fired', firedAt: 'x' });
            store.insert(w);
            makeExecutor().arm(w);
            expect(timerRegistry.has(wakeupTimerKey('w1'))).toBe(false);
        });

        it('does not re-fire a wakeup that became terminal after arming', async () => {
            const w = makeWakeup({ id: 'w1' });
            store.insert(w);
            const exec = makeExecutor();
            exec.arm(w);
            // Simulate the record going terminal out-of-band before the timer fires.
            store.markFired('w1', 'x');

            await vi.advanceTimersByTimeAsync(60_000);
            expect(executeFollowUp).not.toHaveBeenCalled();
        });
    });

    describe('failure metadata', () => {
        it('marks the wakeup failed and persists the failure reason', async () => {
            executeFollowUp.mockRejectedValueOnce(new Error('provider disabled'));
            const w = makeWakeup({ id: 'w1' });
            store.insert(w);
            makeExecutor().arm(w);

            await vi.advanceTimersByTimeAsync(60_000);

            const got = store.getById('w1')!;
            expect(got.status).toBe('failed');
            expect(got.failureReason).toBe('provider disabled');
            expect(got.firedAt).toBe(new Date(BASE).toISOString());
            expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'wakeup-failed' }));
        });
    });

    describe('startup re-arm (restart recovery)', () => {
        it('armAll re-arms pending wakeups persisted before restart', async () => {
            // Simulate a wakeup persisted by a previous process, no live timer.
            store.insert(makeWakeup({ id: 'w1', firesAt: new Date(BASE + 30_000).toISOString() }));

            // Fresh executor (as on restart) arms from the store.
            makeExecutor().armAll();
            expect(timerRegistry.has(wakeupTimerKey('w1'))).toBe(true);

            await vi.advanceTimersByTimeAsync(30_000);
            expect(executeFollowUp).toHaveBeenCalledTimes(1);
            expect(store.getById('w1')!.status).toBe('fired');
        });

        it('fires overdue wakeups immediately on re-arm', async () => {
            // firesAt is in the past relative to the injected clock.
            store.insert(makeWakeup({ id: 'w1', firesAt: new Date(BASE - 5_000).toISOString() }));

            makeExecutor().armAll();
            await vi.advanceTimersByTimeAsync(0);

            expect(executeFollowUp).toHaveBeenCalledTimes(1);
            expect(store.getById('w1')!.status).toBe('fired');
        });

        it('does not arm non-pending wakeups on startup', () => {
            store.insert(makeWakeup({ id: 'fired', status: 'fired', firedAt: 'x' }));
            store.insert(makeWakeup({ id: 'cancelled', status: 'cancelled' }));
            makeExecutor().armAll();
            expect(timerRegistry.has(wakeupTimerKey('fired'))).toBe(false);
            expect(timerRegistry.has(wakeupTimerKey('cancelled'))).toBe(false);
        });
    });

    describe('cancel', () => {
        it('disarms the timer and marks the wakeup cancelled', async () => {
            const w = makeWakeup({ id: 'w1' });
            store.insert(w);
            const exec = makeExecutor();
            exec.arm(w);

            expect(exec.cancel('w1')).toBe(true);
            expect(timerRegistry.has(wakeupTimerKey('w1'))).toBe(false);
            expect(store.getById('w1')!.status).toBe('cancelled');
            expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'wakeup-cancelled' }));

            await vi.advanceTimersByTimeAsync(60_000);
            expect(executeFollowUp).not.toHaveBeenCalled();
        });
    });

    describe('characterization: durability vs in-memory timers', () => {
        it('clearing the timer registry drops the timer but keeps the durable record', async () => {
            const w = makeWakeup({ id: 'w1' });
            store.insert(w);
            makeExecutor().arm(w);
            expect(timerRegistry.has(wakeupTimerKey('w1'))).toBe(true);

            // Simulate a server restart / shutdown clearing every timer.
            timerRegistry.clear();
            await vi.advanceTimersByTimeAsync(60_000);

            // The in-memory timer is gone — the follow-up did not run...
            expect(executeFollowUp).not.toHaveBeenCalled();
            // ...but the durable record survives and is still recoverable.
            expect(store.getById('w1')!.status).toBe('pending');
            expect(store.getPending().map(x => x.id)).toContain('w1');

            // A fresh executor re-arms it from the store and it fires.
            makeExecutor().armAll();
            await vi.advanceTimersByTimeAsync(60_000);
            expect(executeFollowUp).toHaveBeenCalledTimes(1);
            expect(store.getById('w1')!.status).toBe('fired');
        });

        it('shutdownAll disarms pending timers without mutating persisted state', () => {
            const w = makeWakeup({ id: 'w1' });
            store.insert(w);
            const exec = makeExecutor();
            exec.arm(w);
            expect(timerRegistry.has(wakeupTimerKey('w1'))).toBe(true);

            exec.shutdownAll();
            expect(timerRegistry.has(wakeupTimerKey('w1'))).toBe(false);
            expect(store.getById('w1')!.status).toBe('pending');
        });
    });
});
