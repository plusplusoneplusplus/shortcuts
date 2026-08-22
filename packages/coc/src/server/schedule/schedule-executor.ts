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
import { getErrorMessage } from '../shared/fs-utils';
import {
    RALPH_DEFAULT_MAX_ITERATIONS,
    readRepoPreferences,
    resolveDefaultModel,
} from '../preferences-handler';
import { RalphSessionStore } from '../ralph/ralph-session-store';
import { captureRalphBaselineSha } from '../ralph/capture-baseline-sha';
import type { RalphSessionCompleteEvent } from '../queue/queue-executor-bridge';
import type {
    ScheduleEntry,
    ScheduleRunRecord,
    ScheduleChangeEvent,
} from './schedule-manager-types';
import type { ScheduleRunHistory } from './schedule-run-history';
import {
    runtimeKeyMatchesSchedule,
    scheduleRuntimeKey,
    type ScheduleRuntimeKey,
} from './schedule-runtime-key';
import {
    buildSchedulePrompt,
    buildSchedulePromptTask,
    buildScheduleRalphTask,
    buildScheduleScriptTask,
    resolveScheduleExecutionKind,
    type ScheduleTaskContext,
} from './schedule-task-builder';
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
    private readonly runningSchedules = new Set<ScheduleRuntimeKey>();
    private readonly runningRunPromises = new Map<ScheduleRuntimeKey, Promise<ScheduleRunRecord>>();

    constructor(
        private readonly queueManager: TaskQueueManager | null,
        private readonly history: ScheduleRunHistory,
        private readonly emit: ScheduleEventEmit,
        private readonly onFailureStop: ScheduleFailureStopHandler,
        private readonly dataDir?: string,
    ) {}

    /** True when this schedule has an in-flight run *in this workspace*. */
    isRunning(scheduleId: string, repoId: string): boolean {
        return this.runningSchedules.has(scheduleRuntimeKey(repoId, scheduleId));
    }

    /**
     * True when the schedule ID has an in-flight run in *any* workspace.
     *
     * Deliberately separate from `isRunning` so workspace-scoped callers
     * (REST serialization, timer skip checks) cannot reach it by accident and
     * report another workspace's run as their own.
     */
    isAnyRepoRunning(scheduleId: string): boolean {
        for (const key of this.runningSchedules) {
            if (runtimeKeyMatchesSchedule(key, scheduleId)) return true;
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
        const runningKey = scheduleRuntimeKey(repoId, schedule.id);
        const run: ScheduleRunRecord = {
            id: 'run_' + crypto.randomBytes(6).toString('hex'),
            scheduleId: schedule.id,
            repoId,
            startedAt: new Date().toISOString(),
            status: 'running',
        };

        this.runningSchedules.add(runningKey);
        this.history.add(repoId, schedule.id, run);

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
        const runPromise = this.runningRunPromises.get(scheduleRuntimeKey(repoId, scheduleId));
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

        this.history.add(repoId, schedule.id, run);
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
        runningKey: ScheduleRuntimeKey,
    ): Promise<ScheduleRunRecord> {
        try {
            await this.enqueueTask(repoId, schedule, run);

            if (!run.taskId) {
                finaliseRun(run, 'completed');
            } else {
                this.history.update(repoId, schedule.id, run);
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
            this.history.update(repoId, schedule.id, run);
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

    /**
     * Build the queue payload for this schedule and enqueue it, stamping the
     * resulting task/process IDs onto the run record.
     *
     * Payload construction lives in `schedule-task-builder`; everything here
     * is the side effect around it (default-model lookup, Ralph session
     * bootstrap, enqueue).
     */
    private async enqueueTask(repoId: string, schedule: ScheduleEntry, run: ScheduleRunRecord): Promise<void> {
        if (!this.queueManager) return;

        const kind = resolveScheduleExecutionKind(schedule);
        if (!kind) return;

        const ctx: ScheduleTaskContext = {
            repoId,
            schedule,
            run,
            defaultModel: kind === 'script' ? undefined : this.resolveModel(repoId, schedule),
        };

        if (kind === 'ralph') {
            const sessionId = createRalphSessionId();
            const maxIterations = this.dataDir
                ? (readRepoPreferences(this.dataDir, repoId).maxRalphIterations ?? RALPH_DEFAULT_MAX_ITERATIONS)
                : RALPH_DEFAULT_MAX_ITERATIONS;
            const originalGoal = buildSchedulePrompt(repoId, schedule);
            if (this.dataDir) {
                // Best-effort PR-submit baseline: schedules only know a checkout
                // path when the schedule params carry one.
                const baselineSha = await captureRalphBaselineSha({
                    workingDirectory: schedule.params?.workingDirectory,
                });
                const store = new RalphSessionStore({ dataDir: this.dataDir });
                await store.initSession(repoId, sessionId, { originalGoal, maxIterations, baselineSha });
            }
            const taskId = this.queueManager.enqueue(
                buildScheduleRalphTask(ctx, { sessionId, originalGoal, maxIterations, dataDir: this.dataDir }),
            );
            run.taskId = taskId;
            run.processId = toQueueProcessId(taskId);
            run.ralphSessionId = sessionId;
            return;
        }

        const taskId = this.queueManager.enqueue(
            kind === 'script' ? buildScheduleScriptTask(ctx) : buildSchedulePromptTask(ctx),
        );
        run.taskId = taskId;
        run.processId = toQueueProcessId(taskId);
    }

    /** The schedule's pinned model, else the workspace's schedule default. */
    private resolveModel(repoId: string, schedule: ScheduleEntry): string | undefined {
        return schedule.model
            || (this.dataDir ? resolveDefaultModel(this.dataDir, repoId, 'schedule') : undefined)
            || undefined;
    }
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
