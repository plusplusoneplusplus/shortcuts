/**
 * Schedule task builders
 *
 * Pure transformations from a `(repoId, ScheduleEntry, run)` triple into the
 * queue payload that executes it.  Kept free of queue, disk, and timer side
 * effects so the prompt / Ralph / script payload shapes can be fixture-tested
 * without a TaskQueueManager.
 *
 * `ScheduleExecutor` owns the side effects: it calls these builders, then
 * enqueues the returned descriptor and records the resulting task ID.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { CreateTaskInput } from '@plusplusoneplusplus/forge';
import { buildRalphIterationTask } from '../ralph/enqueue-iteration';
import { normalizeChatMode } from '../tasks/task-types';
import { TaskDefs } from '../tasks/task-types';
import type { ScheduleEntry, ScheduleRunRecord } from './schedule-manager-types';

/** The three payload shapes a schedule can execute as. */
export type ScheduleExecutionKind = 'prompt' | 'ralph' | 'script';

/** Common inputs every builder needs. */
export interface ScheduleTaskContext {
    repoId: string;
    schedule: ScheduleEntry;
    run: ScheduleRunRecord;
    /** Resolved default model when the schedule does not pin one. */
    defaultModel?: string;
}

/**
 * Decide which payload shape a schedule executes as.
 *
 * `targetType` selects prompt vs. script; within `prompt`, `mode: 'ralph'`
 * selects the Ralph iteration loop.  Unknown target types return undefined so
 * the executor can no-op rather than guess.
 */
export function resolveScheduleExecutionKind(schedule: ScheduleEntry): ScheduleExecutionKind | undefined {
    if (!schedule.targetType || schedule.targetType === 'prompt') {
        return normalizeChatMode(schedule.mode) === 'ralph' ? 'ralph' : 'prompt';
    }
    if (schedule.targetType === 'script') return 'script';
    return undefined;
}

/** The output folder a run writes to, falling back to the workspace task dir. */
export function resolveScheduleOutputFolder(repoId: string, schedule: ScheduleEntry): string {
    return schedule.outputFolder || `~/.coc/repos/${repoId}/tasks`;
}

/** The instruction prompt handed to the agent, including its output-folder preamble. */
export function buildSchedulePrompt(repoId: string, schedule: ScheduleEntry): string {
    return `Output folder: ${resolveScheduleOutputFolder(repoId, schedule)}\n\n`
        + `Follow the instruction ${schedule.target}.`;
}

/** Queue descriptor for a plain (ask / autopilot) prompt schedule. */
export function buildSchedulePromptTask(ctx: ScheduleTaskContext): CreateTaskInput {
    const { repoId, schedule } = ctx;
    const mode = normalizeChatMode(schedule.mode) ?? 'autopilot';
    return {
        type: 'chat',
        priority: 'normal',
        payload: {
            kind: 'chat',
            mode,
            prompt: buildSchedulePrompt(repoId, schedule),
            provider: schedule.provider,
            context: {
                files: [schedule.target],
                scheduleId: schedule.id,
                scheduleParams: schedule.params,
            },
            workingDirectory: '',
        },
        config: { model: ctx.defaultModel },
        displayName: `[Schedule] ${schedule.name}`,
        repoId,
    };
}

/** Queue descriptor for a Ralph-mode prompt schedule's first iteration. */
export function buildScheduleRalphTask(
    ctx: ScheduleTaskContext,
    input: { sessionId: string; originalGoal: string; maxIterations: number; dataDir?: string },
): CreateTaskInput {
    const { repoId, schedule, run } = ctx;
    return {
        ...buildRalphIterationTask({
            workspaceId: repoId,
            workingDirectory: '',
            sessionId: input.sessionId,
            originalGoal: input.originalGoal,
            iteration: 1,
            maxIterations: input.maxIterations,
            dataDir: input.dataDir,
            displayName: `[Schedule:Ralph] ${schedule.name}`,
            provider: schedule.provider,
            extraContext: {
                scheduleId: schedule.id,
                scheduleRunId: run.id,
                scheduleParams: schedule.params,
            },
        }),
        config: { model: ctx.defaultModel },
    };
}

/** Queue descriptor for a script schedule. */
export function buildScheduleScriptTask(ctx: ScheduleTaskContext): CreateTaskInput {
    const { repoId, schedule } = ctx;
    return {
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
    };
}
