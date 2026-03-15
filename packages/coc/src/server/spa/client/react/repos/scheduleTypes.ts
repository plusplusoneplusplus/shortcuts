/** Shared types for the schedule management feature. */

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
    mode?: 'ask' | 'plan' | 'autopilot';
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
    exitCode?: number;
    stdout?: string;
    stderr?: string;
}
