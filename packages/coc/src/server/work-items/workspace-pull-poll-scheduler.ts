/**
 * Provider-neutral scheduling engine shared by the work-item pull pollers.
 *
 * The scheduler owns the multi-workspace timer lifecycle — config reconciliation,
 * enablement/eligibility gating, interval normalization, timer replacement,
 * `unref`, safe poll invocation, and cleanup. Provider-specific synchronization
 * (repository/project resolution, remote fetching, import/prune behavior, result
 * shapes) stays in each poller and is injected through a small adapter contract.
 *
 * Use one scheduler instance per provider so provider timers never share a map.
 */

export interface WorkspacePullPollTimerApi {
    setInterval(handler: () => void | Promise<void>, ms: number): unknown;
    clearInterval(timer: unknown): void;
}

/** Per-workspace provider polling preference read from repo preferences. */
export interface WorkspacePullPollWorkspaceConfig {
    /** False disables polling for this workspace; undefined/true keeps it enabled. */
    pollingEnabled: boolean;
    /** Configured interval in minutes; undefined/invalid falls back to the default. */
    pollIntervalMinutes?: number;
}

/**
 * Provider callbacks the scheduler needs. Everything provider-specific
 * (preference keys, tracker predicates, log prefix, remote sync, result type)
 * lives behind these methods so the timer engine stays generic.
 */
export interface WorkspacePullPollSchedulerAdapter<TResult> {
    /** Log prefix identifying the provider, e.g. `work-items/github-poll`. */
    readonly logPrefix: string;
    /** Default poll interval (minutes) when the preference is unset or invalid. */
    readonly defaultIntervalMinutes: number;
    /** Active workspace IDs the scheduler reconciles timers against. */
    listWorkspaceIds(): Promise<string[]>;
    /** Global work-item sync enablement gate; false suppresses all timers. */
    isSyncEnabled(): boolean;
    /** Per-workspace provider polling preference (enabled + interval). */
    getWorkspaceConfig(workspaceId: string): WorkspacePullPollWorkspaceConfig;
    /** Whether the workspace currently has any eligible roots to poll. */
    hasEligibleWork(workspaceId: string): Promise<boolean>;
    /** Perform one provider poll of a single workspace. */
    poll(workspaceId: string): Promise<TResult>;
    /**
     * Loggable messages (warnings then errors, in that order) extracted from a
     * poll result, without the `[prefix] workspaceId:` framing the scheduler adds.
     */
    resultLogMessages(result: TResult): string[];
}

export interface WorkspacePullPollSchedulerOptions {
    timerApi?: WorkspacePullPollTimerApi;
    logError?: (message: string) => void;
}

interface WorkspaceTimer {
    timer: unknown;
    intervalMs: number;
}

const defaultTimerApi: WorkspacePullPollTimerApi = {
    setInterval: (handler, ms) => setInterval(() => { void handler(); }, ms),
    clearInterval: timer => clearInterval(timer as ReturnType<typeof setInterval>),
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function maybeUnref(timer: unknown): void {
    if (timer && typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') {
        timer.unref();
    }
}

export class WorkspacePullPollScheduler<TResult> {
    private readonly timerApi: WorkspacePullPollTimerApi;
    private readonly logError: (message: string) => void;
    private readonly timers = new Map<string, WorkspaceTimer>();
    private started = false;

    constructor(
        private readonly adapter: WorkspacePullPollSchedulerAdapter<TResult>,
        options: WorkspacePullPollSchedulerOptions = {},
    ) {
        this.timerApi = options.timerApi ?? defaultTimerApi;
        this.logError = options.logError ?? (message => process.stderr.write(`${message}\n`));
    }

    async start(): Promise<void> {
        if (this.started) return;
        this.started = true;
        await this.refreshWorkspaceTimers();
    }

    dispose(): void {
        for (const workspaceId of [...this.timers.keys()]) {
            this.clearWorkspaceTimer(workspaceId);
        }
        this.started = false;
    }

    async refreshWorkspaceTimers(): Promise<void> {
        const workspaceIds = await this.adapter.listWorkspaceIds();
        const activeWorkspaceIds = new Set<string>();
        for (const workspaceId of workspaceIds) {
            activeWorkspaceIds.add(workspaceId);
            await this.configureWorkspace(workspaceId);
        }
        for (const workspaceId of [...this.timers.keys()]) {
            if (!activeWorkspaceIds.has(workspaceId)) {
                this.clearWorkspaceTimer(workspaceId);
            }
        }
    }

    async configureWorkspace(workspaceId: string): Promise<void> {
        if (!this.adapter.isSyncEnabled()) {
            this.clearWorkspaceTimer(workspaceId);
            return;
        }
        const config = this.adapter.getWorkspaceConfig(workspaceId);
        if (config.pollingEnabled === false) {
            this.clearWorkspaceTimer(workspaceId);
            return;
        }
        if (!(await this.adapter.hasEligibleWork(workspaceId))) {
            this.clearWorkspaceTimer(workspaceId);
            return;
        }

        const intervalMs = this.intervalMsFromMinutes(config.pollIntervalMinutes);
        const existing = this.timers.get(workspaceId);
        if (existing?.intervalMs === intervalMs) return;

        this.clearWorkspaceTimer(workspaceId);
        const timer = this.timerApi.setInterval(() => this.pollWorkspaceSafely(workspaceId), intervalMs);
        maybeUnref(timer);
        this.timers.set(workspaceId, { timer, intervalMs });
    }

    private intervalMsFromMinutes(value: number | undefined): number {
        const minutes = Number.isFinite(value) && value! >= 1
            ? value!
            : this.adapter.defaultIntervalMinutes;
        return minutes * 60 * 1000;
    }

    private async pollWorkspaceSafely(workspaceId: string): Promise<void> {
        try {
            const result = await this.adapter.poll(workspaceId);
            for (const message of this.adapter.resultLogMessages(result)) {
                this.logError(`[${this.adapter.logPrefix}] ${workspaceId}: ${message}`);
            }
        } catch (error) {
            this.logError(`[${this.adapter.logPrefix}] ${workspaceId}: ${errorMessage(error)}`);
        }
    }

    private clearWorkspaceTimer(workspaceId: string): void {
        const existing = this.timers.get(workspaceId);
        if (!existing) return;
        this.timerApi.clearInterval(existing.timer);
        this.timers.delete(workspaceId);
    }
}
