/**
 * AC-04 regression: a scheduled wakeup created during a turn must survive
 * turn-end teardown.
 *
 * A `scheduleWakeup` tool call arms a one-shot timer in the loop
 * infrastructure's ScheduleTimerRegistry (keyed `wakeup:<id>`). The per-turn
 * executor session is a *separate* structure: both executor `finally` blocks
 * (FollowUpExecutor, process-lifecycle-runner) tear the turn down through
 * `BaseExecutor.cleanupSession`, which only touches the `sessions` map. These
 * tests lock in that the teardown never disarms a pending wakeup, so a wakeup
 * scheduled mid-turn still fires after the turn completes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScheduleTimerRegistry } from '../../../src/server/schedule/schedule-timer-registry';
import { createEnqueueWakeup, wakeupTimerKey } from '../../../src/server/loops/enqueue-wakeup';
import { createScheduleWakeupTool } from '../../../src/server/llm-tools/loop-tools';
import type { WakeupToolDeps } from '../../../src/server/llm-tools/loop-tools';
import { BaseExecutor } from '../../../src/server/executors/base-executor';
import { createMockProcessStore, type MockProcessStore } from '../helpers/mock-process-store';
// Warm the module cache so the dynamic import() inside the wakeup timer
// callback resolves on a microtask while fake timers are installed.
import '../../../src/server/executors/follow-up-mode';

/** Concrete executor exposing the protected turn-lifecycle hooks for the test. */
class TestExecutor extends BaseExecutor {
    public startTurn(processId: string): void {
        this.getOrCreateSession(processId);
    }
    /** Mirror what both executor `finally` blocks run at turn end. */
    public endTurn(processId: string): void {
        this.cleanupSession(processId);
    }
}

function makeWakeupDeps(
    processId: string,
    enqueueWakeup: WakeupToolDeps['enqueueWakeup'],
): WakeupToolDeps {
    return {
        executor: { armTimer: vi.fn(), disarmTimer: vi.fn() } as any,
        processId,
        resolveWorkspaceId: vi.fn().mockResolvedValue('ws-1'),
        enqueueWakeup,
    };
}

describe('AC-04: scheduled wakeup survives turn-end teardown', () => {
    let store: MockProcessStore;
    let timerRegistry: ScheduleTimerRegistry;
    let executeFollowUp: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        store = createMockProcessStore();
        timerRegistry = new ScheduleTimerRegistry();
        executeFollowUp = vi.fn().mockResolvedValue(undefined);
    });

    afterEach(() => {
        timerRegistry.clear();
        vi.useRealTimers();
    });

    async function scheduleWakeup(processId: string, prompt: string, delay: string) {
        const enqueueWakeup = createEnqueueWakeup({
            timerRegistry,
            store,
            executeFollowUp: executeFollowUp as any,
        });
        const { tool } = createScheduleWakeupTool(makeWakeupDeps(processId, enqueueWakeup));
        return (tool.handler as (a: any) => Promise<any>)({ prompt, delay });
    }

    it('keeps the wakeup timer armed after cleanupSession runs at turn end', async () => {
        const processId = 'proc-wakeup-1';
        const result = await scheduleWakeup(processId, 'resume me', '60s');
        expect(result.scheduled).toBe(true);

        const key = wakeupTimerKey(result.wakeupId);
        expect(timerRegistry.has(key)).toBe(true);

        // The turn for this process ends — executor teardown runs.
        const executor = new TestExecutor(store);
        executor.startTurn(processId);
        executor.endTurn(processId);

        // Teardown must not have disarmed the wakeup.
        expect(timerRegistry.has(key)).toBe(true);
    });

    it('fires the follow-up after the turn ended', async () => {
        const processId = 'proc-wakeup-2';
        const result = await scheduleWakeup(processId, 'resume me', '60s');
        const key = wakeupTimerKey(result.wakeupId);

        const executor = new TestExecutor(store);
        executor.startTurn(processId);
        executor.endTurn(processId);
        expect(timerRegistry.has(key)).toBe(true);

        await vi.advanceTimersByTimeAsync(60_000);

        expect(executeFollowUp).toHaveBeenCalledTimes(1);
        const callArgs = executeFollowUp.mock.calls[0];
        expect(callArgs[0]).toBe(processId);          // processId
        expect(callArgs[1]).toBe('resume me');         // prompt
        expect(callArgs[8]).toEqual({ source: 'wakeup', wakeupId: result.wakeupId }); // turnSource
        // The registry drops one-shot timers once they fire.
        expect(timerRegistry.has(key)).toBe(false);
    });

    it('cleanupSession only clears executor session state, never the timer registry', async () => {
        const processId = 'proc-wakeup-3';
        const result = await scheduleWakeup(processId, 'resume me', '90s');
        const key = wakeupTimerKey(result.wakeupId);

        const executor = new TestExecutor(store);
        // Two back-to-back turns each tear down; the wakeup must outlive both.
        executor.startTurn(processId);
        executor.endTurn(processId);
        executor.startTurn(processId);
        executor.endTurn(processId);

        expect(timerRegistry.has(key)).toBe(true);
        expect(executeFollowUp).not.toHaveBeenCalled();
    });
});
