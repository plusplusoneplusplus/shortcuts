/** Electron-free "Auto Update: When Idle" scheduler and idle check. */
import type { ServerHandle } from './server-controller';
import type { ReleaseInfo, UpdateCheckResult } from './update-check';
import type { UpdateCoordinator, UpdateStartOptions } from './update-coordinator';

/** How often an enabled auto update checks the current channel. */
export const AUTO_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** OS user idle time required before a silent install. */
export const AUTO_UPDATE_REQUIRED_IDLE_MS = 10 * 60 * 1000;
/** How often a verified download waits for the app to become idle. */
export const AUTO_UPDATE_IDLE_POLL_MS = 60 * 1000;

export interface AppIdleOptions {
    /** null (no server yet) is unknown work and never idle. */
    server: Pick<ServerHandle, 'started' | 'url'> | null;
    /** Seconds since the last OS user input (`powerMonitor.getSystemIdleTime`). */
    getSystemIdleSeconds(): number;
    fetchFn?: typeof fetch;
}

/**
 * Idle means the user has been away long enough and the owned server has no
 * running or queued task in any workspace. An attached server is never ours
 * to stop, so only user idle time counts for it.
 */
export async function isAppIdle(options: AppIdleOptions): Promise<boolean> {
    const userIsIdle = () => {
        const seconds = options.getSystemIdleSeconds();
        return Number.isFinite(seconds) && seconds * 1000 >= AUTO_UPDATE_REQUIRED_IDLE_MS;
    };
    if (!userIsIdle()) return false;
    const server = options.server;
    if (!server) return false;
    if (!server.started) return true;
    try {
        const signal = AbortSignal.timeout(10_000);
        // No repo filter: the restart affects every registered workspace.
        const response = await (options.fetchFn ?? globalThis.fetch)(
            new URL('/api/queue', server.url).href,
            { signal, redirect: 'error' },
        );
        if (!response.ok) {
            await response.body?.cancel();
            return false;
        }
        const queue: unknown = await response.json();
        if (!queue || typeof queue !== 'object'
            || !('running' in queue) || !Array.isArray(queue.running)
            || !('queued' in queue) || !Array.isArray(queue.queued)) {
            return false;
        }
        // Pause markers hold a queue position but are not work.
        const queued = queue.queued.filter((item: unknown) =>
            !(item && typeof item === 'object' && 'kind' in item && item.kind === 'pause-marker'));
        // User input may resume while the queue request is in flight.
        return queue.running.length === 0 && queued.length === 0 && userIsIdle();
    } catch {
        // Unknown work must not be treated as an idle server.
        return false;
    }
}

export interface AutoUpdaterTimers {
    setInterval(fn: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
}

export interface AutoUpdaterOptions {
    /** Release check on the current channel; must not throw. */
    check(): Promise<UpdateCheckResult>;
    getSkippedVersion(): string | null;
    coordinator: Pick<UpdateCoordinator, 'start' | 'readyRelease'>;
    isIdle(): Promise<boolean>;
    /** Shared with manual checks; false means another check is running. */
    tryBeginCheck(): boolean;
    endCheck(): void;
    timers?: AutoUpdaterTimers;
}

/**
 * Hourly checks while enabled. A newer, unskipped release downloads in the
 * background and installs through the coordinator's silent path once idle.
 */
export class AutoUpdater {
    private checkTimer: unknown;
    private pollTimer: unknown;
    private pending?: ReleaseInfo;
    private enabled = false;
    private disposed = false;
    private polling = false;
    private generation = 0;
    private readonly timers: AutoUpdaterTimers;

    constructor(private readonly options: AutoUpdaterOptions) {
        this.timers = options.timers ?? {
            setInterval: (fn, ms) => setInterval(fn, ms),
            clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>),
        };
    }

    get running(): boolean { return this.enabled; }

    /** Starts the hourly timer; call {@link checkNow} for an immediate check. */
    start(): void {
        if (this.enabled || this.disposed) return;
        this.enabled = true;
        this.checkTimer = this.timers.setInterval(() => { void this.checkNow(); }, AUTO_UPDATE_CHECK_INTERVAL_MS);
    }

    /** Stops checks and any pending install. Verified bytes stay for a manual update. */
    stop(): void {
        this.generation++;
        this.enabled = false;
        this.pending = undefined;
        if (this.checkTimer !== undefined) this.timers.clearInterval(this.checkTimer);
        this.checkTimer = undefined;
        this.stopPolling();
    }

    dispose(): void {
        this.disposed = true;
        this.stop();
    }

    async checkNow(): Promise<void> {
        if (!this.enabled || !this.options.tryBeginCheck()) return;
        const generation = this.generation;
        let release: ReleaseInfo | undefined;
        try {
            const result = await this.options.check();
            release = result.reason === 'newer' && result.release
                ? result.release
                // A failed check can still install bytes verified earlier.
                : result.reason === 'error' ? this.options.coordinator.readyRelease : undefined;
        } catch (error) {
            console.error(`[coc-desktop] Automatic update check failed: ${String(error)}`);
        } finally {
            this.options.endCheck();
        }
        if (!release || !this.enabled || generation !== this.generation) return;
        if (release.version === this.options.getSkippedVersion()) return;
        this.pending = release;
        // Downloads now; installs only if already idle, otherwise polling resumes it.
        await this.attempt(release, generation);
        if (this.isPending(release, generation) && this.options.coordinator.readyRelease?.tag === release.tag) {
            this.startPolling();
        }
    }

    private isPending(release: ReleaseInfo, generation: number): boolean {
        return this.enabled && this.generation === generation && this.pending === release
            && release.version !== this.options.getSkippedVersion();
    }

    private async attempt(release: ReleaseInfo, generation: number): Promise<void> {
        if (!this.isPending(release, generation)) return;
        const startOptions: UpdateStartOptions = {
            silent: true,
            isIdle: async () => {
                if (!this.isPending(release, generation)) return false;
                const idle = await this.options.isIdle();
                // Off, dispose or Skip during a queue request revoke its result.
                return idle && this.isPending(release, generation);
            },
        };
        await this.options.coordinator.start(release, startOptions);
    }

    private startPolling(): void {
        if (this.pollTimer !== undefined) return;
        this.pollTimer = this.timers.setInterval(() => { void this.poll(); }, AUTO_UPDATE_IDLE_POLL_MS);
    }

    private stopPolling(): void {
        if (this.pollTimer !== undefined) this.timers.clearInterval(this.pollTimer);
        this.pollTimer = undefined;
    }

    private async poll(): Promise<void> {
        if (this.polling) return;
        const release = this.pending;
        const generation = this.generation;
        // A failed download or an install dropped the bytes; the next hourly check retries.
        if (!release || !this.isPending(release, generation) || this.options.coordinator.readyRelease?.tag !== release.tag) {
            this.pending = undefined;
            this.stopPolling();
            return;
        }
        this.polling = true;
        try {
            if (await this.options.isIdle()) await this.attempt(release, generation);
        } finally {
            this.polling = false;
        }
    }
}
