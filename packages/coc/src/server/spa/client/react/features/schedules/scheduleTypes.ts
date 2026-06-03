/** Shared types for the schedule management feature. */

export type PromptScheduleMode = 'ask' | 'autopilot';

export function normalizePromptScheduleMode(mode: unknown, fallback: PromptScheduleMode = 'ask'): PromptScheduleMode {
    if (mode === 'autopilot') return 'autopilot';
    if (mode === 'ask' || mode === 'plan') return 'ask';
    return fallback;
}

export interface Schedule {
    id: string;
    name: string;
    target: string;
    targetType?: 'prompt' | 'script';
    cron: string;
    cronDescription: string;
    params: Record<string, string>;
    onFailure: string;
    status: string;
    isRunning: boolean;
    nextRun: string | null;
    createdAt: string;
    outputFolder?: string;
    model?: string;
    mode?: PromptScheduleMode;
    /** 'user' = stored in schedules.json; 'repo' = loaded from .github/schedules/ */
    source?: 'user' | 'repo';
}

export interface RunRecord {
    id: string;
    scheduleId: string;
    startedAt: string;
    completedAt?: string;
    status: string;
    error?: string;
    durationMs?: number;
    processId?: string;
    taskId?: string;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
}
