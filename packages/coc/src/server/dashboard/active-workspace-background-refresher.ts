import { getServerLogger } from '../logging/server-logger';
import type { ActiveWorkspaceSnapshot, ActiveWorkspaceTracker } from './active-workspace-tracker';

export const DEFAULT_ACTIVE_WORKSPACE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export type ActiveWorkspaceRefreshReason = 'startup' | 'active-workspace-change' | 'interval';

export interface ActiveWorkspaceBackgroundRefresherOptions {
    tracker: ActiveWorkspaceTracker;
    refreshWorkspace: (workspaceId: string, reason: ActiveWorkspaceRefreshReason) => Promise<void>;
    intervalMs?: number;
    setIntervalFn?: typeof setInterval;
    clearIntervalFn?: typeof clearInterval;
    onRefreshError?: (workspaceId: string, reason: ActiveWorkspaceRefreshReason, error: unknown) => void;
}

export class ActiveWorkspaceBackgroundRefresher {
    private readonly tracker: ActiveWorkspaceTracker;
    private readonly refreshWorkspace: (workspaceId: string, reason: ActiveWorkspaceRefreshReason) => Promise<void>;
    private readonly intervalMs: number;
    private readonly setIntervalFn: typeof setInterval;
    private readonly clearIntervalFn: typeof clearInterval;
    private readonly onRefreshError?: (workspaceId: string, reason: ActiveWorkspaceRefreshReason, error: unknown) => void;
    private readonly inFlightWorkspaceIds = new Set<string>();
    private intervalHandle: ReturnType<typeof setInterval> | undefined;
    private unsubscribeTracker: (() => void) | undefined;

    constructor(options: ActiveWorkspaceBackgroundRefresherOptions) {
        this.tracker = options.tracker;
        this.refreshWorkspace = options.refreshWorkspace;
        this.intervalMs = options.intervalMs ?? DEFAULT_ACTIVE_WORKSPACE_REFRESH_INTERVAL_MS;
        this.setIntervalFn = options.setIntervalFn ?? setInterval;
        this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
        this.onRefreshError = options.onRefreshError;
    }

    start(): void {
        if (this.intervalHandle) return;

        this.unsubscribeTracker = this.tracker.onChange(snapshot => {
            void this.refreshSnapshot(snapshot, 'active-workspace-change');
        });

        this.intervalHandle = this.setIntervalFn(() => {
            void this.refreshActiveWorkspaces('interval');
        }, this.intervalMs);
        (this.intervalHandle as { unref?: () => void }).unref?.();

        void this.refreshActiveWorkspaces('startup');
    }

    dispose(): void {
        if (this.intervalHandle) {
            this.clearIntervalFn(this.intervalHandle);
            this.intervalHandle = undefined;
        }
        this.unsubscribeTracker?.();
        this.unsubscribeTracker = undefined;
        this.inFlightWorkspaceIds.clear();
    }

    async refreshActiveWorkspaces(reason: ActiveWorkspaceRefreshReason): Promise<void> {
        await this.refreshSnapshot(this.tracker.getSnapshot(), reason);
    }

    private async refreshSnapshot(snapshot: ActiveWorkspaceSnapshot, reason: ActiveWorkspaceRefreshReason): Promise<void> {
        await Promise.all(snapshot.activeWorkspaceIds.map(workspaceId => this.refreshWorkspaceSafely(workspaceId, reason)));
    }

    private async refreshWorkspaceSafely(workspaceId: string, reason: ActiveWorkspaceRefreshReason): Promise<void> {
        if (this.inFlightWorkspaceIds.has(workspaceId)) return;
        this.inFlightWorkspaceIds.add(workspaceId);
        try {
            await this.refreshWorkspace(workspaceId, reason);
        } catch (err) {
            getServerLogger().debug({ err, workspaceId, reason }, 'Active workspace background refresh failed');
            this.onRefreshError?.(workspaceId, reason, err);
        } finally {
            this.inFlightWorkspaceIds.delete(workspaceId);
        }
    }
}
