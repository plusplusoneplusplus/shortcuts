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
import type { ChatPayload } from '../tasks/task-types';
import { TaskDefs, normalizeChatMode } from '../tasks/task-types';
import { getErrorMessage } from '../shared/fs-utils';
import {
    RALPH_DEFAULT_MAX_ITERATIONS,
    readRepoPreferences,
    resolveDefaultModel,
} from '../preferences-handler';
import { buildRalphIterationTask } from '../ralph/enqueue-iteration';
import { RalphSessionStore } from '../ralph/ralph-session-store';
import type { RalphSessionCompleteEvent } from '../queue/queue-executor-bridge';
import type {
    ScheduleEntry,
    ScheduleRunRecord,
    ScheduleChangeEvent,
} from './schedule-manager-types';
import type { ScheduleRunHistory } from './schedule-run-history';
import {
    awaitQueueTerminalOutcome,
    createScheduleQueueEventBus,
    getTerminalOutcome,
    ralphSessionCompleteSignal,
    taskCancelledSignal,
    taskCompletedSignal,
    taskFailedSignal,
    type QueueTerminalOutcome,
} from './schedule-queue-await';

export type ScheduleEventEmit = (event: ScheduleChangeEvent) => void;

/** Invoked when a run fails on a schedule with `onFailure: 'stop'`. */
export type ScheduleFailureStopHandler = (repoId: string, scheduleId: string) => void;

export class ScheduleExecutor {
    private readonly runningSchedules = new Set<string>();
    private readonly runningRunPromises = new Map<string, Promise<ScheduleRunRecord>>();

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
    executeRun(repoId: string, schedule: ScheduleEntry): Promise<ScheduleRunRecord> {
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

        let resolveRun!: (value: ScheduleRunRecord) => void;
        let rejectRun!: (reason?: unknown) => void;
        const runPromise = new Promise<ScheduleRunRecord>((resolve, reject) => {
            resolveRun = resolve;
            rejectRun = reject;
        });
        this.runningRunPromises.set(runningKey, runPromise);
        void this.executeQueuedRun(repoId, schedule, run, runningKey).then(resolveRun, rejectRun);
        return runPromise;
    }

    whenIdle(scheduleId: string, repoId: string): Promise<void> {
        const runPromise = this.runningRunPromises.get(scheduleKey(repoId, scheduleId));
        if (!runPromise) return Promise.resolve();
        return runPromise.then(() => undefined, () => undefined);
    }

    recordMissedRun(repoId: string, schedule: ScheduleEntry, reason: string): ScheduleRunRecord {
        const now = new Date().toISOString();
        const run: ScheduleRunRecord = {
            id: 'run_' + crypto.randomBytes(6).toString('hex'),
            scheduleId: schedule.id,
            repoId,
            startedAt: now,
            completedAt: now,
            status: 'missed',
            durationMs: 0,
            error: reason,
        };

        this.history.add(schedule.id, run);
        this.emit({
            type: 'schedule-run-complete',
            repoId,
            scheduleId: schedule.id,
            schedule,
            run,
        });
        return run;
    }

    private async executeQueuedRun(
        repoId: string,
        schedule: ScheduleEntry,
        run: ScheduleRunRecord,
        runningKey: string,
    ): Promise<ScheduleRunRecord> {
        try {
            await this.enqueueTask(repoId, schedule, run);

            if (!run.taskId) {
                finaliseRun(run, 'completed');
            } else {
                this.history.update(schedule.id, run);
                const outcome = run.ralphSessionId
                    ? await this.waitForRalphSessionTerminal({
                        taskId: run.taskId,
                        sessionId: run.ralphSessionId,
                        workspaceId: repoId,
                        scheduleRunId: run.id,
                    })
                    : await this.waitForTaskTerminal(run.taskId);
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
            this.runningRunPromises.delete(runningKey);
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
        const bus = createScheduleQueueEventBus(this.queueManager);
        if (!bus) return Promise.resolve({ status: 'completed' });

        const matchesTask = (task: QueuedTask) => task.id === taskId;
        return awaitQueueTerminalOutcome({
            bus,
            taskId,
            precheck: getTerminalOutcome,
            signals: [
                taskCompletedSignal(matchesTask),
                taskFailedSignal(matchesTask),
                taskCancelledSignal(matchesTask),
            ],
        });
    }

    private waitForRalphSessionTerminal(input: {
        taskId: string;
        sessionId: string;
        workspaceId: string;
        scheduleRunId: string;
    }): Promise<QueueTerminalOutcome> {
        const bus = createScheduleQueueEventBus(this.queueManager);
        if (!bus) return Promise.resolve({ status: 'completed' });

        const matchesScheduledTask = (task: QueuedTask) => matchesScheduledRalphTask(input, task);
        return awaitQueueTerminalOutcome({
            bus,
            taskId: input.taskId,
            // A completed queue task is not terminal for a Ralph schedule — the
            // session's final-check / gap-fix loop keeps running.  Only a
            // failed or cancelled queue task ends the run early; success arrives
            // via the `ralphSessionComplete` signal.
            precheck: task => {
                const outcome = getTerminalOutcome(task);
                return outcome?.status === 'failed' ? outcome : undefined;
            },
            signals: [
                ralphSessionCompleteSignal(
                    event => matchesRalphSession(input, event),
                    reason => isFailedRalphCompletionReason(reason)
                        ? { status: 'failed', error: reason }
                        : { status: 'completed' },
                ),
                taskFailedSignal(matchesScheduledTask),
                taskCancelledSignal(matchesScheduledTask),
            ],
        });
    }

    private async enqueueTask(repoId: string, schedule: ScheduleEntry, run: ScheduleRunRecord): Promise<void> {
        if (!this.queueManager) return;

        if (!schedule.targetType || schedule.targetType === 'prompt') {
            const effectiveOutputFolder = schedule.outputFolder || `~/.coc/repos/${repoId}/tasks`;
            const outputPrefix = `Output folder: ${effectiveOutputFolder}\n\n`;
            const model = schedule.model
                || (this.dataDir ? resolveDefaultModel(this.dataDir, repoId, 'schedule') : undefined)
                || undefined;
            const scheduleMode = normalizeChatMode(schedule.mode) ?? 'autopilot';
            if (scheduleMode === 'ralph') {
                const sessionId = createRalphSessionId();
                const maxIterations = this.dataDir
                    ? (readRepoPreferences(this.dataDir, repoId).maxRalphIterations ?? RALPH_DEFAULT_MAX_ITERATIONS)
                    : RALPH_DEFAULT_MAX_ITERATIONS;
                const originalGoal = `${outputPrefix}Follow the instruction ${schedule.target}.`;
                if (this.dataDir) {
                    const store = new RalphSessionStore({ dataDir: this.dataDir });
                    await store.initSession(repoId, sessionId, {
                        originalGoal,
                        maxIterations,
                    });
                }
                const taskId = this.queueManager.enqueue({
                    ...buildRalphIterationTask({
                        workspaceId: repoId,
                        workingDirectory: '',
                        sessionId,
                        originalGoal,
                        iteration: 1,
                        maxIterations,
                        dataDir: this.dataDir,
                        displayName: `[Schedule:Ralph] ${schedule.name}`,
                        extraContext: {
                            scheduleId: schedule.id,
                            scheduleRunId: run.id,
                            scheduleParams: schedule.params,
                        },
                    }),
                    config: { model },
                });
                run.taskId = taskId;
                run.processId = toQueueProcessId(taskId);
                run.ralphSessionId = sessionId;
                return;
            }
            const taskId = this.queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: {
                    kind: 'chat',
                    mode: scheduleMode,
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

function scheduleKey(repoId: string, scheduleId: string): string {
    return `${repoId}\0${scheduleId}`;
}

function createRalphSessionId(): string {
    return `ralph-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function matchesRalphSession(
    input: { sessionId: string; workspaceId: string },
    event: RalphSessionCompleteEvent,
): boolean {
    return event.workspaceId === input.workspaceId && event.sessionId === input.sessionId;
}

function matchesScheduledRalphTask(
    input: { sessionId: string; scheduleRunId: string },
    task: QueuedTask | undefined,
): boolean {
    const payload = task?.payload as Partial<ChatPayload> | undefined;
    return payload?.context?.ralph?.sessionId === input.sessionId
        && payload.context.scheduleRunId === input.scheduleRunId;
}

function isFailedRalphCompletionReason(reason: string): boolean {
    return reason === 'final-check-failed'
        || reason === 'final-check-enqueue-failed'
        || reason === 'final-check-session-missing'
        || reason === 'final-check-gap-loop-start-failed'
        || reason === 'final-check-gap-enqueue-failed';
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
