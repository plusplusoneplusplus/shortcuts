/**
 * schedule-queue-await
 *
 * Shared queue-terminal waiting kernel for scheduled runs.  Both plain
 * scheduled tasks and Ralph-backed scheduled tasks need the same
 * subscribe-then-recheck lifecycle to avoid a task-completion race: a queued
 * task can reach a terminal state between the moment we read it and the moment
 * we attach listeners.  The kernel checks the current terminal state, subscribes
 * to every relevant terminal signal, rechecks immediately after subscribing to
 * close that window, and guarantees the promise resolves exactly once with every
 * listener removed.
 *
 * A `ScheduleQueueEventBus` is the single typed adapter over the queue manager's
 * untyped Node `EventEmitter` surface, so subscription sites stay type-checked
 * instead of casting each event with `as never`.
 */

import type { QueuedTask, TaskQueueManager } from '@plusplusoneplusplus/forge';
import type { RalphSessionCompleteEvent } from '../queue/queue-executor-bridge';

export type QueueTerminalOutcome =
    | { status: 'completed' }
    | { status: 'failed'; error: unknown };

/** Narrow, typed view of the queue-manager events schedule execution consumes. */
export interface ScheduleQueueEvents {
    taskCompleted: (task: QueuedTask, result?: unknown) => void;
    taskFailed: (task: QueuedTask, error: Error) => void;
    taskCancelled: (task: QueuedTask) => void;
    ralphSessionComplete: (event: RalphSessionCompleteEvent) => void;
}

/**
 * Typed adapter over the queue manager's event surface.  This is the single
 * place the schedule boundary asserts the event payload shapes, replacing the
 * `as never` casts that were scattered across each subscription site.
 */
export interface ScheduleQueueEventBus {
    on<K extends keyof ScheduleQueueEvents>(event: K, listener: ScheduleQueueEvents[K]): void;
    off<K extends keyof ScheduleQueueEvents>(event: K, listener: ScheduleQueueEvents[K]): void;
    getTask(taskId: string): QueuedTask | undefined;
}

/**
 * A terminal signal owns one event subscription: it attaches its listener,
 * resolves the wait via `resolveOnce` when its event matches, and returns a
 * cleanup that removes the listener.  Bundling event name + matcher + outcome
 * mapping in one place keeps every listener signature typed.
 */
export type QueueTerminalSignal = (
    bus: ScheduleQueueEventBus,
    resolveOnce: (outcome: QueueTerminalOutcome) => void,
) => () => void;

type UntypedEmitter = {
    on(event: string, listener: (...args: unknown[]) => void): unknown;
    off(event: string, listener: (...args: unknown[]) => void): unknown;
};

/**
 * Build a typed event bus from a queue manager, or return `null` when the queue
 * manager is absent or does not expose the event / `getTask` surface (e.g. a
 * lightweight stub in tests).  Callers treat `null` as "no waiting possible".
 */
export function createScheduleQueueEventBus(
    queueManager: TaskQueueManager | null,
): ScheduleQueueEventBus | null {
    if (!queueManager) return null;
    if (
        typeof queueManager.on !== 'function'
        || typeof queueManager.off !== 'function'
        || typeof queueManager.getTask !== 'function'
    ) {
        return null;
    }
    // The queue manager is an untyped Node EventEmitter at the type level; this
    // adapter is the one place we bridge that to the narrow schedule event map.
    const emitter = queueManager as unknown as UntypedEmitter;
    return {
        on: (event, listener) => {
            emitter.on(event, listener as (...args: unknown[]) => void);
        },
        off: (event, listener) => {
            emitter.off(event, listener as (...args: unknown[]) => void);
        },
        getTask: taskId => queueManager.getTask(taskId),
    };
}

/**
 * Await a task's terminal outcome using the subscribe-then-recheck kernel:
 *
 *   1. check the current terminal state before subscribing,
 *   2. subscribe to every terminal signal,
 *   3. recheck immediately after subscribing (closes the TOCTOU window),
 *   4. resolve exactly once and remove every listener on settlement.
 *
 * `precheck` maps the queue task's current state to a terminal outcome (or
 * `undefined` to keep waiting); it runs both before and after subscription.
 */
export function awaitQueueTerminalOutcome(input: {
    bus: ScheduleQueueEventBus;
    taskId: string;
    precheck: (task: QueuedTask | undefined) => QueueTerminalOutcome | undefined;
    signals: QueueTerminalSignal[];
}): Promise<QueueTerminalOutcome> {
    const { bus, taskId, precheck, signals } = input;

    const existingOutcome = precheck(bus.getTask(taskId));
    if (existingOutcome) return Promise.resolve(existingOutcome);

    return new Promise(resolve => {
        let settled = false;
        const cleanups: Array<() => void> = [];
        const resolveOnce = (outcome: QueueTerminalOutcome) => {
            if (settled) return;
            settled = true;
            for (const cleanup of cleanups) cleanup();
            resolve(outcome);
        };

        for (const signal of signals) {
            cleanups.push(signal(bus, resolveOnce));
        }

        const terminalOutcome = precheck(bus.getTask(taskId));
        if (terminalOutcome) resolveOnce(terminalOutcome);
    });
}

/** Map a task's current queue status to a terminal outcome, if any. */
export function getTerminalOutcome(task: QueuedTask | undefined): QueueTerminalOutcome | undefined {
    if (!task) return undefined;
    if (task.status === 'completed') return { status: 'completed' };
    if (task.status === 'failed') return { status: 'failed', error: task.error };
    if (task.status === 'cancelled') return { status: 'failed', error: 'Task cancelled' };
    return undefined;
}

/** Terminal signal for `taskCompleted` — resolves completed when `matches`. */
export function taskCompletedSignal(matches: (task: QueuedTask) => boolean): QueueTerminalSignal {
    return (bus, resolveOnce) => {
        const listener = (task: QueuedTask) => {
            if (matches(task)) resolveOnce({ status: 'completed' });
        };
        bus.on('taskCompleted', listener);
        return () => bus.off('taskCompleted', listener);
    };
}

/** Terminal signal for `taskFailed` — resolves failed with the emitted error. */
export function taskFailedSignal(matches: (task: QueuedTask) => boolean): QueueTerminalSignal {
    return (bus, resolveOnce) => {
        const listener = (task: QueuedTask, error: Error) => {
            if (matches(task)) resolveOnce({ status: 'failed', error: error ?? task.error });
        };
        bus.on('taskFailed', listener);
        return () => bus.off('taskFailed', listener);
    };
}

/** Terminal signal for `taskCancelled` — resolves failed with a cancel reason. */
export function taskCancelledSignal(matches: (task: QueuedTask) => boolean): QueueTerminalSignal {
    return (bus, resolveOnce) => {
        const listener = (task: QueuedTask) => {
            if (matches(task)) resolveOnce({ status: 'failed', error: 'Task cancelled' });
        };
        bus.on('taskCancelled', listener);
        return () => bus.off('taskCancelled', listener);
    };
}

/**
 * Terminal signal for `ralphSessionComplete`.  `matches` filters the event to
 * the run this waiter belongs to; `mapReason` maps the completion reason to a
 * terminal outcome, keeping Ralph's success/failure taxonomy injectable and
 * distinct from the base queue signals.
 */
export function ralphSessionCompleteSignal(
    matches: (event: RalphSessionCompleteEvent) => boolean,
    mapReason: (reason: string) => QueueTerminalOutcome,
): QueueTerminalSignal {
    return (bus, resolveOnce) => {
        const listener = (event: RalphSessionCompleteEvent) => {
            if (!matches(event)) return;
            resolveOnce(mapReason(event.reason));
        };
        bus.on('ralphSessionComplete', listener);
        return () => bus.off('ralphSessionComplete', listener);
    };
}
