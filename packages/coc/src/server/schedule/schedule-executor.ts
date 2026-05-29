/**
 * ScheduleExecutor
 *
 * Owns the per-run lifecycle: enqueueing the appropriate task into the
 * queue manager based on schedule.targetType, tracking which schedules
 * have an in-flight run, and emitting `schedule-triggered` /
 * `schedule-run-complete` events.
 *
 * Pure execution — no timer or CRUD knowledge.  Run history is delegated
 * to `ScheduleRunHistory`; the failure callback lets the parent manager
 * apply onFailure='stop' semantics without reaching back into executor
 * state.
 */

import * as crypto from 'crypto';
import type { QueuedTask, TaskQueueManager } from '@plusplusoneplusplus/forge';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import { TaskDefs } from '../tasks/task-types';
import { getErrorMessage } from '../shared/fs-utils';
import { resolveDefaultModel } from '../preferences-handler';
import type {
    ScheduleEntry,
    ScheduleRunRecord,
    ScheduleChangeEvent,
} from './schedule-manager-types';
import type { ScheduleRunHistory } from './schedule-run-history';

export type ScheduleEventEmit = (event: ScheduleChangeEvent) => void;

/** Invoked when a run fails on a schedule with `onFailure: 'stop'`. */
export type ScheduleFailureStopHandler = (repoId: string, scheduleId: string) => void;

export class ScheduleExecutor {
    private readonly runningSchedules = new Set<string>();

    constructor(
        private readonly queueManager: TaskQueueManager | null,
        private readonly history: ScheduleRunHistory,
        private readonly emit: ScheduleEventEmit,
        private readonly onFailureStop: ScheduleFailureStopHandler,
        private readonly dataDir?: string,
    ) {}

    isRunning(scheduleId: string, repoId?: string): boolean {
        if (repoId) {
            return this.runningSchedules.has(scheduleKey(repoId, scheduleId));
        }
        for (const key of this.runningSchedules) {
            if (key.endsWith(`\0${scheduleId}`)) return true;
        }
        return false;
    }

    /**
     * Execute one run of the schedule: build a task payload appropriate to
     * the targetType, enqueue it, then keep the run active until the queued
     * task reaches a terminal state. Errors during enqueue mark the run as
     * failed immediately and may stop the schedule via `onFailureStop`.
     */
    async executeRun(repoId: string, schedule: ScheduleEntry): Promise<ScheduleRunRecord> {
        const runningKey = scheduleKey(repoId, schedule.id);
        const run: ScheduleRunRecord = {
            id: 'run_' + crypto.randomBytes(6).toString('hex'),
            scheduleId: schedule.id,
            repoId,
            startedAt: new Date().toISOString(),
            status: 'running',
        };

        this.runningSchedules.add(runningKey);
        this.history.add(schedule.id, run);

        this.emit({
            type: 'schedule-triggered',
            repoId,
            scheduleId: schedule.id,
            schedule,
            run,
        });

        try {
            this.enqueueTask(repoId, schedule, run);

            if (!run.taskId) {
                finaliseRun(run, 'completed');
            } else {
                this.history.update(schedule.id, run);
                const outcome = await this.waitForTaskTerminal(run.taskId);
                if (outcome.status === 'completed') {
                    finaliseRun(run, 'completed');
                } else {
                    finaliseRun(run, 'failed', outcome.error);
                    if (schedule.onFailure === 'stop') {
                        this.onFailureStop(repoId, schedule.id);
                    }
                }
            }
        } catch (err) {
            finaliseRun(run, 'failed', err);
            if (schedule.onFailure === 'stop') {
                this.onFailureStop(repoId, schedule.id);
            }
        } finally {
            this.runningSchedules.delete(runningKey);
            this.history.update(schedule.id, run);
        }

        this.emit({
            type: 'schedule-run-complete',
            repoId,
            scheduleId: schedule.id,
            schedule,
            run,
        });

        return run;
    }

    private waitForTaskTerminal(taskId: string): Promise<QueueTerminalOutcome> {
        const queueManager = this.queueManager;
        if (!queueManager) return Promise.resolve({ status: 'completed' });
        if (
            typeof queueManager.on !== 'function'
            || typeof queueManager.off !== 'function'
            || typeof queueManager.getTask !== 'function'
        ) {
            return Promise.resolve({ status: 'completed' });
        }

        const existingOutcome = getTerminalOutcome(queueManager.getTask(taskId));
        if (existingOutcome) return Promise.resolve(existingOutcome);

        return new Promise(resolve => {
            let settled = false;
            const resolveOnce = (outcome: QueueTerminalOutcome) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(outcome);
            };
            const onCompleted = (task: QueuedTask) => {
                if (task.id !== taskId) return;
                resolveOnce({ status: 'completed' });
            };
            const onFailed = (task: QueuedTask, error: Error) => {
                if (task.id !== taskId) return;
                resolveOnce({ status: 'failed', error: error ?? task.error });
            };
            const onCancelled = (task: QueuedTask) => {
                if (task.id !== taskId) return;
                resolveOnce({ status: 'failed', error: 'Task cancelled' });
            };
            const cleanup = () => {
                queueManager.off('taskCompleted', onCompleted);
                queueManager.off('taskFailed', onFailed);
                queueManager.off('taskCancelled', onCancelled);
            };

            queueManager.on('taskCompleted', onCompleted);
            queueManager.on('taskFailed', onFailed);
            queueManager.on('taskCancelled', onCancelled);

            const terminalOutcome = getTerminalOutcome(queueManager.getTask(taskId));
            if (terminalOutcome) {
                resolveOnce(terminalOutcome);
            }
        });
    }

    private enqueueTask(repoId: string, schedule: ScheduleEntry, run: ScheduleRunRecord): void {
        if (!this.queueManager) return;

        if (!schedule.targetType || schedule.targetType === 'prompt') {
            const effectiveOutputFolder = schedule.outputFolder || `~/.coc/repos/${repoId}/tasks`;
            const outputPrefix = `Output folder: ${effectiveOutputFolder}\n\n`;
            const model = schedule.model
                || (this.dataDir ? resolveDefaultModel(this.dataDir, repoId, 'schedule') : undefined)
                || undefined;
            const taskId = this.queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: {
                    kind: 'chat',
                    mode: schedule.mode ?? 'autopilot',
                    prompt: `${outputPrefix}Follow the instruction ${schedule.target}.`,
                    context: {
                        files: [schedule.target],
                        scheduleId: schedule.id,
                        scheduleParams: schedule.params,
                    },
                    workingDirectory: '',
                },
                config: { model },
                displayName: `[Schedule] ${schedule.name}`,
                repoId,
            });
            run.taskId = taskId;
            run.processId = toQueueProcessId(taskId);
            return;
        }

        if (schedule.targetType === 'script') {
            const taskId = this.queueManager.enqueue({
                type: TaskDefs.runScript.kind,
                priority: 'normal',
                payload: {
                    kind: TaskDefs.runScript.kind,
                    script: schedule.target,
                    workingDirectory: schedule.params?.workingDirectory ?? '',
                    scheduleId: schedule.id,
                },
                config: {},
                displayName: `[Schedule:script] ${schedule.name}`,
                repoId,
            });
            run.taskId = taskId;
            run.processId = toQueueProcessId(taskId);
            return;
        }
    }
}

type QueueTerminalOutcome =
    | { status: 'completed' }
    | { status: 'failed'; error: unknown };

function scheduleKey(repoId: string, scheduleId: string): string {
    return `${repoId}\0${scheduleId}`;
}

function getTerminalOutcome(task: QueuedTask | undefined): QueueTerminalOutcome | undefined {
    if (!task) return undefined;
    if (task.status === 'completed') return { status: 'completed' };
    if (task.status === 'failed') return { status: 'failed', error: task.error };
    if (task.status === 'cancelled') return { status: 'failed', error: 'Task cancelled' };
    return undefined;
}

/** Stamp completedAt, durationMs, and optionally error on a run record. */
function finaliseRun(
    run: ScheduleRunRecord,
    status: 'completed' | 'failed',
    error?: unknown,
): void {
    run.status = status;
    run.completedAt = new Date().toISOString();
    run.durationMs = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
    if (error !== undefined) {
        run.error = getErrorMessage(error);
    }
}
