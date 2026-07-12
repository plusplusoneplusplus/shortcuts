/**
 * Tests for the shared schedule queue-await kernel.
 *
 * Covers the subscribe-then-recheck lifecycle used by both plain scheduled
 * tasks and Ralph-backed scheduled tasks: already-terminal fast paths,
 * completion / failure / cancellation after subscribe, Ralph session outcome
 * mapping, the post-subscribe race window (TOCTOU recheck), resolve-exactly-once
 * with listener cleanup, and the typed event-bus adapter guards.
 *
 * Cross-platform compatible (Linux/Mac/Windows) — no filesystem or timers.
 */

import { EventEmitter } from 'events';
import { describe, it, expect, vi } from 'vitest';
import {
    awaitQueueTerminalOutcome,
    createScheduleQueueEventBus,
    getTerminalOutcome,
    ralphSessionCompleteSignal,
    taskCancelledSignal,
    taskCompletedSignal,
    taskFailedSignal,
    type QueueTerminalOutcome,
    type ScheduleQueueEventBus,
} from '../src/server/schedule/schedule-queue-await';

// ============================================================================
// Helpers
// ============================================================================

type FakeTask = { id: string; status: string; error?: string };

/** An event-bus backed by a real EventEmitter, with on/off spies and a map of tasks. */
function createFakeBus(tasks: Map<string, FakeTask> = new Map()) {
    const emitter = new EventEmitter();
    const onSpy = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        emitter.on(event, listener);
    });
    const offSpy = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        emitter.off(event, listener);
    });
    const bus: ScheduleQueueEventBus = {
        on: onSpy as unknown as ScheduleQueueEventBus['on'],
        off: offSpy as unknown as ScheduleQueueEventBus['off'],
        getTask: (id: string) => tasks.get(id) as never,
    };
    return { bus, emitter, onSpy, offSpy, tasks };
}

const matchById = (taskId: string) => (task: { id: string }) => task.id === taskId;

const ralphReasonMapper = (failedReasons: Set<string>) =>
    (reason: string): QueueTerminalOutcome =>
        failedReasons.has(reason) ? { status: 'failed', error: reason } : { status: 'completed' };

// ============================================================================
// getTerminalOutcome
// ============================================================================

describe('getTerminalOutcome', () => {
    it('returns undefined for a missing task', () => {
        expect(getTerminalOutcome(undefined)).toBeUndefined();
    });

    it('maps completed to a completed outcome', () => {
        expect(getTerminalOutcome({ id: 't', status: 'completed' } as never)).toEqual({ status: 'completed' });
    });

    it('maps failed to a failed outcome carrying the task error', () => {
        expect(getTerminalOutcome({ id: 't', status: 'failed', error: 'boom' } as never))
            .toEqual({ status: 'failed', error: 'boom' });
    });

    it('maps cancelled to a failed outcome with a cancel reason', () => {
        expect(getTerminalOutcome({ id: 't', status: 'cancelled' } as never))
            .toEqual({ status: 'failed', error: 'Task cancelled' });
    });

    it('returns undefined for non-terminal statuses', () => {
        expect(getTerminalOutcome({ id: 't', status: 'queued' } as never)).toBeUndefined();
        expect(getTerminalOutcome({ id: 't', status: 'running' } as never)).toBeUndefined();
    });
});

// ============================================================================
// awaitQueueTerminalOutcome — plain task path
// ============================================================================

describe('awaitQueueTerminalOutcome (plain task)', () => {
    const plainSignals = (taskId: string) => [
        taskCompletedSignal(matchById(taskId)),
        taskFailedSignal(matchById(taskId)),
        taskCancelledSignal(matchById(taskId)),
    ];

    it('resolves immediately for an already-terminal task without subscribing', async () => {
        const { bus, onSpy } = createFakeBus(new Map([['t1', { id: 't1', status: 'completed' }]]));

        const outcome = await awaitQueueTerminalOutcome({
            bus,
            taskId: 't1',
            precheck: getTerminalOutcome,
            signals: plainSignals('t1'),
        });

        expect(outcome).toEqual({ status: 'completed' });
        expect(onSpy).not.toHaveBeenCalled();
    });

    it('resolves completed when taskCompleted fires after subscribe, then removes every listener', async () => {
        const { bus, emitter, onSpy, offSpy } = createFakeBus();

        const promise = awaitQueueTerminalOutcome({
            bus,
            taskId: 't1',
            precheck: getTerminalOutcome,
            signals: plainSignals('t1'),
        });

        expect(onSpy).toHaveBeenCalledTimes(3);
        emitter.emit('taskCompleted', { id: 't1', status: 'completed' }, { ok: true });

        expect(await promise).toEqual({ status: 'completed' });
        expect(offSpy).toHaveBeenCalledTimes(3);
        expect(emitter.listenerCount('taskCompleted')).toBe(0);
        expect(emitter.listenerCount('taskFailed')).toBe(0);
        expect(emitter.listenerCount('taskCancelled')).toBe(0);
    });

    it('maps taskFailed to a failed outcome carrying the emitted error', async () => {
        const { bus, emitter } = createFakeBus();

        const promise = awaitQueueTerminalOutcome({
            bus,
            taskId: 't1',
            precheck: getTerminalOutcome,
            signals: plainSignals('t1'),
        });

        emitter.emit('taskFailed', { id: 't1', status: 'failed' }, new Error('kaboom'));
        const outcome = await promise;

        expect(outcome.status).toBe('failed');
        expect((outcome as { error: unknown }).error).toBeInstanceOf(Error);
        expect(((outcome as { error: Error }).error).message).toBe('kaboom');
    });

    it('maps taskCancelled to a failed outcome with a cancel reason', async () => {
        const { bus, emitter } = createFakeBus();

        const promise = awaitQueueTerminalOutcome({
            bus,
            taskId: 't1',
            precheck: getTerminalOutcome,
            signals: plainSignals('t1'),
        });

        emitter.emit('taskCancelled', { id: 't1', status: 'cancelled' });
        expect(await promise).toEqual({ status: 'failed', error: 'Task cancelled' });
    });

    it('ignores terminal events for other tasks', async () => {
        const { bus, emitter } = createFakeBus();

        const promise = awaitQueueTerminalOutcome({
            bus,
            taskId: 't1',
            precheck: getTerminalOutcome,
            signals: plainSignals('t1'),
        });

        // Unrelated task completing must not settle this waiter.
        emitter.emit('taskCompleted', { id: 'other', status: 'completed' }, {});
        let settled = false;
        void promise.then(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);

        emitter.emit('taskCompleted', { id: 't1', status: 'completed' }, {});
        expect(await promise).toEqual({ status: 'completed' });
    });

    it('closes the post-subscribe race window by rechecking after subscription', async () => {
        // getTask is non-terminal before subscribe, terminal immediately after —
        // the terminal transition lands in the window between the two reads, so
        // no event ever fires. The recheck must still resolve the wait.
        const getTask = vi.fn()
            .mockReturnValueOnce({ id: 't1', status: 'queued' })
            .mockReturnValueOnce({ id: 't1', status: 'completed' });
        const onSpy = vi.fn();
        const offSpy = vi.fn();
        const bus: ScheduleQueueEventBus = {
            on: onSpy as unknown as ScheduleQueueEventBus['on'],
            off: offSpy as unknown as ScheduleQueueEventBus['off'],
            getTask: getTask as unknown as ScheduleQueueEventBus['getTask'],
        };

        const outcome = await awaitQueueTerminalOutcome({
            bus,
            taskId: 't1',
            precheck: getTerminalOutcome,
            signals: plainSignals('t1'),
        });

        expect(outcome).toEqual({ status: 'completed' });
        expect(getTask).toHaveBeenCalledTimes(2); // pre-subscribe and post-subscribe recheck
        expect(onSpy).toHaveBeenCalledTimes(3);    // it did subscribe before rechecking
        expect(offSpy).toHaveBeenCalledTimes(3);   // and cleaned up on resolution
    });

    it('resolves exactly once and ignores further events after settling', async () => {
        const { bus, emitter } = createFakeBus();

        const promise = awaitQueueTerminalOutcome({
            bus,
            taskId: 't1',
            precheck: getTerminalOutcome,
            signals: plainSignals('t1'),
        });

        emitter.emit('taskCompleted', { id: 't1', status: 'completed' }, {});
        const outcome = await promise;
        expect(outcome).toEqual({ status: 'completed' });

        // Listeners were removed on settlement; late failures cannot flip the outcome.
        expect(emitter.listenerCount('taskFailed')).toBe(0);
        emitter.emit('taskFailed', { id: 't1', status: 'failed' }, new Error('late'));
        expect(await promise).toEqual({ status: 'completed' });
    });
});

// ============================================================================
// awaitQueueTerminalOutcome — Ralph session path
// ============================================================================

describe('awaitQueueTerminalOutcome (Ralph session)', () => {
    const RALPH_FAILED_REASONS = new Set(['final-check-failed', 'final-check-enqueue-failed']);
    const input = { taskId: 't1', sessionId: 's1', workspaceId: 'ws', scheduleRunId: 'run1' };

    const ralphSignals = () => [
        ralphSessionCompleteSignal(
            event => event.workspaceId === input.workspaceId && event.sessionId === input.sessionId,
            ralphReasonMapper(RALPH_FAILED_REASONS),
        ),
        taskFailedSignal(task => task.id === input.taskId),
        taskCancelledSignal(task => task.id === input.taskId),
    ];

    const ralphPrecheck = (task: FakeTask | undefined) => {
        const outcome = getTerminalOutcome(task as never);
        return outcome?.status === 'failed' ? outcome : undefined;
    };

    it('does not treat a completed queue task as terminal — waits for the session', async () => {
        // Queue task already completed, but the Ralph session is still running.
        const { bus, emitter } = createFakeBus(new Map([['t1', { id: 't1', status: 'completed' }]]));

        const promise = awaitQueueTerminalOutcome({
            bus,
            taskId: 't1',
            precheck: ralphPrecheck,
            signals: ralphSignals(),
        });

        let settled = false;
        void promise.then(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);

        emitter.emit('ralphSessionComplete', {
            type: 'ralphSessionComplete',
            workspaceId: 'ws',
            sessionId: 's1',
            processId: 'p',
            totalIterations: 3,
            reason: 'signal',
        });
        expect(await promise).toEqual({ status: 'completed' });
    });

    it('maps a non-failure session completion reason to completed', async () => {
        const { bus, emitter } = createFakeBus();

        const promise = awaitQueueTerminalOutcome({
            bus,
            taskId: 't1',
            precheck: ralphPrecheck,
            signals: ralphSignals(),
        });

        emitter.emit('ralphSessionComplete', {
            type: 'ralphSessionComplete',
            workspaceId: 'ws',
            sessionId: 's1',
            processId: 'p',
            totalIterations: 1,
            reason: 'iteration-cap',
        });
        expect(await promise).toEqual({ status: 'completed' });
    });

    it('maps a final-check failure reason to a failed outcome', async () => {
        const { bus, emitter } = createFakeBus();

        const promise = awaitQueueTerminalOutcome({
            bus,
            taskId: 't1',
            precheck: ralphPrecheck,
            signals: ralphSignals(),
        });

        emitter.emit('ralphSessionComplete', {
            type: 'ralphSessionComplete',
            workspaceId: 'ws',
            sessionId: 's1',
            processId: 'p',
            totalIterations: 1,
            reason: 'final-check-failed',
        });
        expect(await promise).toEqual({ status: 'failed', error: 'final-check-failed' });
    });

    it('ignores session completions for a different workspace or session', async () => {
        const { bus, emitter } = createFakeBus();

        const promise = awaitQueueTerminalOutcome({
            bus,
            taskId: 't1',
            precheck: ralphPrecheck,
            signals: ralphSignals(),
        });

        emitter.emit('ralphSessionComplete', {
            type: 'ralphSessionComplete',
            workspaceId: 'other-ws',
            sessionId: 's1',
            processId: 'p',
            totalIterations: 1,
            reason: 'signal',
        });
        emitter.emit('ralphSessionComplete', {
            type: 'ralphSessionComplete',
            workspaceId: 'ws',
            sessionId: 'other-session',
            processId: 'p',
            totalIterations: 1,
            reason: 'signal',
        });

        let settled = false;
        void promise.then(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);

        emitter.emit('ralphSessionComplete', {
            type: 'ralphSessionComplete',
            workspaceId: 'ws',
            sessionId: 's1',
            processId: 'p',
            totalIterations: 1,
            reason: 'signal',
        });
        expect(await promise).toEqual({ status: 'completed' });
    });

    it('fails a scheduled Ralph run when its queue task fails', async () => {
        const { bus, emitter } = createFakeBus();

        const promise = awaitQueueTerminalOutcome({
            bus,
            taskId: 't1',
            precheck: ralphPrecheck,
            signals: ralphSignals(),
        });

        emitter.emit('taskFailed', { id: 't1', status: 'failed' }, new Error('queue died'));
        const outcome = await promise;
        expect(outcome.status).toBe('failed');
        expect(((outcome as { error: Error }).error).message).toBe('queue died');
    });

    it('resolves failed immediately when the queue task is already failed', async () => {
        const { bus, onSpy } = createFakeBus(new Map([['t1', { id: 't1', status: 'failed', error: 'early' }]]));

        const outcome = await awaitQueueTerminalOutcome({
            bus,
            taskId: 't1',
            precheck: ralphPrecheck,
            signals: ralphSignals(),
        });

        expect(outcome).toEqual({ status: 'failed', error: 'early' });
        expect(onSpy).not.toHaveBeenCalled();
    });
});

// ============================================================================
// createScheduleQueueEventBus
// ============================================================================

describe('createScheduleQueueEventBus', () => {
    it('returns null for a null queue manager', () => {
        expect(createScheduleQueueEventBus(null)).toBeNull();
    });

    it('returns null when the queue manager lacks the event or getTask surface', () => {
        expect(createScheduleQueueEventBus({ on() {}, off() {} } as never)).toBeNull();
        expect(createScheduleQueueEventBus({ on() {}, getTask() {} } as never)).toBeNull();
        expect(createScheduleQueueEventBus({ off() {}, getTask() {} } as never)).toBeNull();
    });

    it('delegates on/off/getTask to the underlying queue manager', () => {
        const qm = {
            on: vi.fn(),
            off: vi.fn(),
            getTask: vi.fn().mockReturnValue({ id: 'x', status: 'queued' }),
        };
        const bus = createScheduleQueueEventBus(qm as never);
        expect(bus).not.toBeNull();

        const listener = () => {};
        bus!.on('taskCompleted', listener);
        expect(qm.on).toHaveBeenCalledWith('taskCompleted', listener);

        bus!.off('taskCompleted', listener);
        expect(qm.off).toHaveBeenCalledWith('taskCompleted', listener);

        expect(bus!.getTask('x')).toEqual({ id: 'x', status: 'queued' });
        expect(qm.getTask).toHaveBeenCalledWith('x');
    });

    it('bridges a real EventEmitter so subscriptions receive emitted payloads', () => {
        const emitter = new EventEmitter() as EventEmitter & { getTask: () => undefined };
        emitter.getTask = () => undefined;
        const bus = createScheduleQueueEventBus(emitter as never)!;

        const received: unknown[] = [];
        const listener = (task: unknown) => received.push(task);
        bus.on('taskCompleted', listener as never);
        emitter.emit('taskCompleted', { id: 't1', status: 'completed' });
        expect(received).toEqual([{ id: 't1', status: 'completed' }]);

        bus.off('taskCompleted', listener as never);
        emitter.emit('taskCompleted', { id: 't2', status: 'completed' });
        expect(received).toHaveLength(1);
    });
});
