/**
 * Scheduled-wakeup timer wiring.
 *
 * A `scheduleWakeup` tool call arms a one-shot timer in the loop
 * infrastructure's {@link ScheduleTimerRegistry}. When the timer fires it
 * resolves the follow-up mode and runs a wakeup-sourced follow-up turn on the
 * same process via the queue bridge.
 *
 * The timer is keyed by `wakeup:<wakeupId>` — deliberately NOT keyed by
 * processId and NOT owned by the per-turn executor session. That decoupling is
 * what lets a wakeup survive turn-end teardown
 * (`BaseExecutor.cleanupSession`, the executor `finally` blocks): the executor
 * never touches this registry, so a wakeup scheduled mid-turn still fires after
 * the turn completes. The registry only drops timers on cancel (loop/trigger
 * ids) or on server shutdown (`clear()`).
 */

import type { ProcessStore, TurnSource } from '@plusplusoneplusplus/forge';
import type { ChatMode } from '../tasks/task-types';
import type { ScheduleTimerRegistry } from '../schedule/schedule-timer-registry';

/** Options passed when arming a scheduled wakeup. */
export interface WakeupEnqueueOptions {
    processId: string;
    prompt: string;
    delayMs: number;
    wakeupId: string;
    model?: string;
    workspaceId?: string;
}

/**
 * Minimal follow-up runner the wakeup timer invokes when it fires. Matches the
 * leading arguments of the queue bridge's `executeFollowUp`.
 */
export type WakeupExecuteFollowUp = (
    processId: string,
    message: string,
    attachments: undefined,
    mode: ChatMode,
    deliveryMode: undefined,
    images: undefined,
    selectedSkillNames: undefined,
    model: string | undefined,
    turnSource: TurnSource,
) => Promise<void>;

export interface EnqueueWakeupDeps {
    timerRegistry: ScheduleTimerRegistry;
    store: ProcessStore;
    executeFollowUp: WakeupExecuteFollowUp;
}

/** Timer-registry key prefix for one-shot scheduled wakeups. */
export const WAKEUP_TIMER_KEY_PREFIX = 'wakeup:';

/** The {@link ScheduleTimerRegistry} key under which a wakeup's timer is armed. */
export function wakeupTimerKey(wakeupId: string): string {
    return `${WAKEUP_TIMER_KEY_PREFIX}${wakeupId}`;
}

/**
 * Build the `enqueueWakeup` callback handed to the scheduleWakeup tool. The
 * returned function arms a one-shot timer that, when it fires, resolves the
 * follow-up mode and runs a wakeup-sourced follow-up turn on the process.
 */
export function createEnqueueWakeup(deps: EnqueueWakeupDeps): (opts: WakeupEnqueueOptions) => void {
    return (opts: WakeupEnqueueOptions) => {
        deps.timerRegistry.set(
            wakeupTimerKey(opts.wakeupId),
            () => {
                const turnSource: TurnSource = { source: 'wakeup', wakeupId: opts.wakeupId };
                void (async () => {
                    try {
                        const { resolveFollowUpMode } = await import('../executors/follow-up-mode');
                        const mode = await resolveFollowUpMode(deps.store, opts.processId);
                        await deps.executeFollowUp(
                            opts.processId,
                            opts.prompt,
                            undefined,
                            mode,
                            undefined,
                            undefined,
                            undefined,
                            opts.model,
                            turnSource,
                        );
                    } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        process.stderr.write(`[Wakeup] Failed to execute wakeup ${opts.wakeupId}: ${msg}\n`);
                    }
                })();
            },
            opts.delayMs,
        );
    };
}
