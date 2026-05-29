/**
 * Shared schedule types extracted from schedule-manager so that the
 * decomposed collaborators (run history, executor, watcher) can import
 * them without depending on the manager itself.
 */

import type { TargetType, ChatMode } from '../tasks/task-types';

export type ScheduleStatus = 'active' | 'paused' | 'stopped';
export type ScheduleOnFailure = 'notify' | 'stop';

export interface ScheduleEntry {
    id: string;
    name: string;
    target: string;
    cron: string;
    params: Record<string, string>;
    onFailure: ScheduleOnFailure;
    status: ScheduleStatus;
    createdAt: string;
    targetType?: TargetType;   // defaults to 'prompt' when absent
    outputFolder?: string;     // output folder path prepended to prompt for prompt-type schedules
    model?: string;            // optional model override for prompt-type schedules
    mode?: ChatMode;           // chat mode for prompt-type schedules; defaults to 'autopilot'
    /** 'user' = stored in schedules.json; 'repo' = loaded from .github/schedules/ */
    source?: 'user' | 'repo';
}

export interface ScheduleRunRecord {
    id: string;
    scheduleId: string;
    repoId: string;
    startedAt: string;
    completedAt?: string;
    status: 'running' | 'completed' | 'failed' | 'missed';
    error?: string;
    durationMs?: number;
    processId?: string;
    taskId?: string;
    ralphSessionId?: string;
}

export interface ScheduleChangeEvent {
    type:
        | 'schedule-added'
        | 'schedule-updated'
        | 'schedule-removed'
        | 'schedule-triggered'
        | 'schedule-run-complete';
    repoId: string;
    scheduleId: string;
    schedule?: ScheduleEntry;
    run?: ScheduleRunRecord;
}
