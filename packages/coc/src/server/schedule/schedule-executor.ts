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
import type { TaskQueueManager } from '@plusplusoneplusplus/forge';
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

    isRunning(scheduleId: string): boolean {
        return this.runningSchedules.has(scheduleId);
    }

    /**
     * Execute one run of the schedule: build a task payload appropriate to
     * the targetType, enqueue, finalise the run record, and emit lifecycle
     * events.  Errors during enqueue mark the run as failed and may stop
     * the schedule via `onFailureStop`.
     */
    async executeRun(repoId: string, schedule: ScheduleEntry): Promise<ScheduleRunRecord> {
        const run: ScheduleRunRecord = {
            id: 'run_' + crypto.randomBytes(6).toString('hex'),
            scheduleId: schedule.id,
            repoId,
            startedAt: new Date().toISOString(),
            status: 'running',
        };

        this.runningSchedules.add(schedule.id);
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
            finaliseRun(run, 'completed');
        } catch (err) {
            finaliseRun(run, 'failed', err);
            if (schedule.onFailure === 'stop') {
                this.onFailureStop(repoId, schedule.id);
            }
        } finally {
            this.runningSchedules.delete(schedule.id);
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
