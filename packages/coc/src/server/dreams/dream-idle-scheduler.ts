import { getServerLogger } from '../logging/server-logger';
import type { DreamIdleRunResult, DreamRunRequestOptions } from './dream-runner';

export const DEFAULT_DREAM_IDLE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export type DreamIdleSchedulerReason = 'startup' | 'interval';

export interface DreamIdleSchedulerOptions {
    getWorkspaceIds: () => readonly string[] | Promise<readonly string[]>;
    getDreamsEnabled: () => boolean | Promise<boolean>;
    getWorkspaceDreamsEnabled: (workspaceId: string) => boolean | Promise<boolean>;
    runIdle: (workspaceId: string, options: DreamRunRequestOptions) => Promise<DreamIdleRunResult>;
    getRunOptions?: () => DreamRunRequestOptions;
    intervalMs?: number;
    setIntervalFn?: typeof setInterval;
    clearIntervalFn?: typeof clearInterval;
    onRunResult?: (workspaceId: string, reason: DreamIdleSchedulerReason, result: DreamIdleRunResult) => void;
    onRunError?: (workspaceId: string, reason: DreamIdleSchedulerReason, error: unknown) => void;
}

export class DreamIdleScheduler {
    private readonly getWorkspaceIds: () => readonly string[] | Promise<readonly string[]>;
    private readonly getDreamsEnabled: () => boolean | Promise<boolean>;
    private readonly getWorkspaceDreamsEnabled: (workspaceId: string) => boolean | Promise<boolean>;
    private readonly runIdle: (workspaceId: string, options: DreamRunRequestOptions) => Promise<DreamIdleRunResult>;
    private readonly getRunOptions?: () => DreamRunRequestOptions;
    private readonly intervalMs: number;
    private readonly setIntervalFn: typeof setInterval;
    private readonly clearIntervalFn: typeof clearInterval;
    private readonly onRunResult?: (workspaceId: string, reason: DreamIdleSchedulerReason, result: DreamIdleRunResult) => void;
    private readonly onRunError?: (workspaceId: string, reason: DreamIdleSchedulerReason, error: unknown) => void;
    private readonly inFlightWorkspaceIds = new Set<string>();
    private intervalHandle: ReturnType<typeof setInterval> | undefined;

    constructor(options: DreamIdleSchedulerOptions) {
        this.getWorkspaceIds = options.getWorkspaceIds;
        this.getDreamsEnabled = options.getDreamsEnabled;
        this.getWorkspaceDreamsEnabled = options.getWorkspaceDreamsEnabled;
        this.runIdle = options.runIdle;
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
            const result = await this.runIdle(normalizedWorkspaceId, this.getRunOptions?.() ?? {});
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
