import { getServerLogger } from '../logging/server-logger';
import type { DreamIdleCheckResult, DreamRunRequestOptions } from './dream-runner';

export const DEFAULT_DREAM_IDLE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export type DreamIdleSchedulerReason = 'startup' | 'interval';

export type DreamIdleSchedulerRunResult =
    | { started: true; task: Record<string, unknown>; idle: DreamIdleCheckResult }
    | { started: false; reason: string; idle: DreamIdleCheckResult };

export interface DreamIdleSchedulerOptions {
    getWorkspaceIds: () => readonly string[] | Promise<readonly string[]>;
    getDreamsEnabled: () => boolean | Promise<boolean>;
    getWorkspaceDreamsEnabled: (workspaceId: string) => boolean | Promise<boolean>;
    checkIdleReadiness: (workspaceId: string, options: DreamRunRequestOptions) => Promise<DreamIdleCheckResult>;
    enqueueIdleRun: (workspaceId: string, options: DreamRunRequestOptions) => Promise<Record<string, unknown>>;
    getRunOptions?: () => DreamRunRequestOptions;
    intervalMs?: number;
    setIntervalFn?: typeof setInterval;
    clearIntervalFn?: typeof clearInterval;
    onRunResult?: (workspaceId: string, reason: DreamIdleSchedulerReason, result: DreamIdleSchedulerRunResult) => void;
    onRunError?: (workspaceId: string, reason: DreamIdleSchedulerReason, error: unknown) => void;
}

export class DreamIdleScheduler {
    private readonly getWorkspaceIds: () => readonly string[] | Promise<readonly string[]>;
    private readonly getDreamsEnabled: () => boolean | Promise<boolean>;
    private readonly getWorkspaceDreamsEnabled: (workspaceId: string) => boolean | Promise<boolean>;
    private readonly checkIdleReadiness: (workspaceId: string, options: DreamRunRequestOptions) => Promise<DreamIdleCheckResult>;
    private readonly enqueueIdleRun: (workspaceId: string, options: DreamRunRequestOptions) => Promise<Record<string, unknown>>;
    private readonly getRunOptions?: () => DreamRunRequestOptions;
    private readonly intervalMs: number;
    private readonly setIntervalFn: typeof setInterval;
    private readonly clearIntervalFn: typeof clearInterval;
    private readonly onRunResult?: (workspaceId: string, reason: DreamIdleSchedulerReason, result: DreamIdleSchedulerRunResult) => void;
    private readonly onRunError?: (workspaceId: string, reason: DreamIdleSchedulerReason, error: unknown) => void;
    private readonly inFlightWorkspaceIds = new Set<string>();
    private intervalHandle: ReturnType<typeof setInterval> | undefined;

    constructor(options: DreamIdleSchedulerOptions) {
        this.getWorkspaceIds = options.getWorkspaceIds;
        this.getDreamsEnabled = options.getDreamsEnabled;
        this.getWorkspaceDreamsEnabled = options.getWorkspaceDreamsEnabled;
        this.checkIdleReadiness = options.checkIdleReadiness;
        this.enqueueIdleRun = options.enqueueIdleRun;
        this.getRunOptions = options.getRunOptions;
        this.intervalMs = normalizeIntervalMs(options.intervalMs);
        this.setIntervalFn = options.setIntervalFn ?? setInterval;
        this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
        this.onRunResult = options.onRunResult;
        this.onRunError = options.onRunError;
    }

    start(): void {
        if (this.intervalHandle) return;
        this.intervalHandle = this.setIntervalFn(() => {
            void this.runAll('interval');
        }, this.intervalMs);
        (this.intervalHandle as { unref?: () => void }).unref?.();
        void this.runAll('startup');
    }

    dispose(): void {
        if (this.intervalHandle) {
            this.clearIntervalFn(this.intervalHandle);
            this.intervalHandle = undefined;
        }
        this.inFlightWorkspaceIds.clear();
    }

    async runAll(reason: DreamIdleSchedulerReason): Promise<void> {
        if (!await this.getDreamsEnabled()) {
            return;
        }
        const workspaceIds = await this.getWorkspaceIds();
        await Promise.all(workspaceIds.map(workspaceId => this.runWorkspaceSafely(workspaceId, reason)));
    }

    private async runWorkspaceSafely(workspaceId: string, reason: DreamIdleSchedulerReason): Promise<void> {
        const normalizedWorkspaceId = workspaceId.trim();
        if (!normalizedWorkspaceId || this.inFlightWorkspaceIds.has(normalizedWorkspaceId)) {
            return;
        }
        if (!await this.getWorkspaceDreamsEnabled(normalizedWorkspaceId)) {
            return;
        }

        this.inFlightWorkspaceIds.add(normalizedWorkspaceId);
        try {
            const runOptions = this.getRunOptions?.() ?? {};
            const idle = await this.checkIdleReadiness(normalizedWorkspaceId, runOptions);
            const result: DreamIdleSchedulerRunResult = idle.isIdle
                ? { started: true, task: await this.enqueueIdleRun(normalizedWorkspaceId, runOptions), idle }
                : { started: false, reason: idle.reasons.join('; '), idle };
            this.onRunResult?.(normalizedWorkspaceId, reason, result);
        } catch (error) {
            this.onRunError?.(normalizedWorkspaceId, reason, error);
            getServerLogger().debug({ err: error, workspaceId: normalizedWorkspaceId, reason }, 'Idle dream run failed');
        } finally {
            this.inFlightWorkspaceIds.delete(normalizedWorkspaceId);
        }
    }
}

function normalizeIntervalMs(value: number | undefined): number {
    if (value === undefined || !Number.isFinite(value)) {
        return DEFAULT_DREAM_IDLE_CHECK_INTERVAL_MS;
    }
    return Math.max(1_000, Math.trunc(value));
}
