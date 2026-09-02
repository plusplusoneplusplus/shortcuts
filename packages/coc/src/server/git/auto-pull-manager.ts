/**
 * AutoPullManager — one server-side auto-pull timer per repository (AC-01/AC-03).
 *
 * Why a dedicated manager rather than a `WorkspacePullPollSchedulerAdapter`
 * (the goal's `[assumption] Placement`): that scheduler arms a bare
 * `setInterval(handler, intervalMs)`, which cannot express a *different* first
 * delay. AC-03 needs exactly that — the first tick after boot is anchored to
 * `lastRunAt + interval`, so a restart mid-interval doesn't reset the countdown
 * and an overdue repo fires shortly after startup. The scheduler also hard-gates
 * every timer on `isSyncEnabled()` and `hasEligibleWork()`, two work-item-sync
 * notions with no auto-pull meaning.
 *
 * So this follows `NotesGitTimerManager` instead: a `Map<workspaceId, timer>`,
 * `startAll()` enumeration over the process store, per-workspace reconfigure,
 * and `dispose()`.
 *
 * Every timer is a `setTimeout` that re-arms itself after each tick rather than
 * a repeating `setInterval`. One mechanism then covers both the anchored first
 * delay and the steady-state period, and a slow tick can never stack on itself.
 * Handles are `unref`'d so auto-pull alone never keeps the process alive.
 *
 * The tick itself is injected (`runTick`) — this module owns only *when*, and
 * `auto-pull-tick` owns *what*.
 */

import {
    computeFirstTickDelayMs,
    readAutoPullState,
    type AutoPullOutcome,
    type AutoPullRunState,
} from './auto-pull-state';

/** Minimal timer surface, injectable so tests need no real clock. */
export interface AutoPullTimerApi {
    setTimeout(handler: () => void, ms: number): unknown;
    clearTimeout(timer: unknown): void;
}

/** The bit of a workspace record auto-pull needs. */
export interface AutoPullWorkspace {
    id: string;
    rootPath: string;
}

/** The `autoPull` block of a repo's preferences, as far as this manager cares. */
export interface AutoPullPreference {
    enabled?: unknown;
    intervalMinutes?: unknown;
}

export interface AutoPullManagerDeps {
    /** Root of the coc data dir; run state lives under `<dataDir>/repos/<id>/`. */
    dataDir: string;
    /** Every workspace the server knows about. */
    listWorkspaces: () => Promise<readonly AutoPullWorkspace[]>;
    /** Per-repo preferences read; only `autoPull` is consulted. */
    readAutoPullPreference: (workspaceId: string) => AutoPullPreference | undefined;
    /** One tick for a repo. Must not reject; a rejection is caught and logged anyway. */
    runTick: (workspace: AutoPullWorkspace) => Promise<unknown>;
    timerApi?: AutoPullTimerApi;
    /** Epoch millis. Injected so scheduling math is testable. */
    now?: () => number;
    logError?: (message: string) => void;
}

/** What the read API (AC-05) serves for one repo. */
export interface AutoPullStatus {
    enabled: boolean;
    intervalMinutes?: number;
    /** ISO instant of the next scheduled tick; absent when no timer is armed. */
    nextRunAt?: string;
    lastRunAt?: string;
    outcome?: AutoPullOutcome;
    message?: string;
}

interface ArmedTimer {
    timer: unknown;
    intervalMinutes: number;
    /** Epoch millis the armed timer is due to fire. */
    nextRunAtMs: number;
}

function maybeUnref(timer: unknown): void {
    if (timer && typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') {
        timer.unref();
    }
}

const defaultTimerApi: AutoPullTimerApi = {
    setTimeout: (handler, ms) => {
        const timer = setTimeout(handler, ms);
        maybeUnref(timer);
        return timer;
    },
    clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * A usable interval, or `undefined`. The preference schema already bounds this
 * to an integer 1..1440 and drops the whole `autoPull` object otherwise, but the
 * manager re-checks because it also reads state written by older builds and by
 * anything that edits the JSON by hand.
 */
function validIntervalMinutes(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

export class AutoPullManager {
    private readonly timerApi: AutoPullTimerApi;
    private readonly now: () => number;
    private readonly logError: (message: string) => void;
    private readonly timers = new Map<string, ArmedTimer>();
    /** Set by `dispose()` so a tick in flight can't resurrect a timer afterwards. */
    private disposed = false;

    constructor(private readonly deps: AutoPullManagerDeps) {
        this.timerApi = deps.timerApi ?? defaultTimerApi;
        this.now = deps.now ?? (() => Date.now());
        this.logError = deps.logError ?? (message => process.stderr.write(`[git/auto-pull] ${message}\n`));
    }

    /**
     * Arm a timer for every workspace whose `autoPull` preference is on. Called
     * once at startup; overdue repos are staggered so a server that was down for
     * a day doesn't fire every `git pull` in the same instant.
     */
    async startAll(): Promise<void> {
        this.disposed = false;
        const workspaces = await this.listWorkspacesSafely();
        let overdueIndex = 0;
        for (const ws of workspaces) {
            if (this.armWorkspace(ws, overdueIndex)) overdueIndex++;
        }
    }

    /**
     * Re-read one repo's preference and arm, re-arm, or clear its timer (AC-04).
     * A no-op when the interval is unchanged, so repeatedly saving the same
     * preference can't keep pushing the next run out.
     */
    async configureWorkspace(workspaceId: string): Promise<void> {
        this.disposed = false;
        const workspaces = await this.listWorkspacesSafely();
        const ws = workspaces.find(w => w.id === workspaceId);
        if (!ws) {
            this.clearWorkspace(workspaceId);
            return;
        }
        this.armWorkspace(ws, 0);
    }

    /** Current schedule + last persisted outcome for one repo. */
    getStatus(workspaceId: string): AutoPullStatus {
        const pref = this.readPreferenceSafely(workspaceId);
        const intervalMinutes = validIntervalMinutes(pref?.intervalMinutes);
        const enabled = pref?.enabled === true && intervalMinutes !== undefined;
        const armed = this.timers.get(workspaceId);
        const state = this.readStateSafely(workspaceId);
        return {
            enabled,
            ...(intervalMinutes !== undefined ? { intervalMinutes } : {}),
            ...(armed ? { nextRunAt: new Date(armed.nextRunAtMs).toISOString() } : {}),
            ...(state ? { lastRunAt: state.lastRunAt, outcome: state.outcome } : {}),
            ...(state?.message ? { message: state.message } : {}),
        };
    }

    /** Whether a timer is currently armed. Exposed for tests and diagnostics. */
    isArmed(workspaceId: string): boolean {
        return this.timers.has(workspaceId);
    }

    /** Number of armed timers. */
    get armedCount(): number {
        return this.timers.size;
    }

    /** Stop every timer. Call during server shutdown. */
    dispose(): void {
        this.disposed = true;
        for (const workspaceId of [...this.timers.keys()]) {
            this.clearWorkspace(workspaceId);
        }
    }

    /**
     * Arm (or leave alone) one repo's timer.
     *
     * @returns true when the repo was armed with an *overdue* first tick, so the
     * caller can advance the stagger index only for repos that actually compete
     * for the same startup window.
     */
    private armWorkspace(ws: AutoPullWorkspace, staggerIndex: number): boolean {
        const pref = this.readPreferenceSafely(ws.id);
        const intervalMinutes = validIntervalMinutes(pref?.intervalMinutes);
        if (pref?.enabled !== true || intervalMinutes === undefined) {
            this.clearWorkspace(ws.id);
            return false;
        }

        const existing = this.timers.get(ws.id);
        if (existing && existing.intervalMinutes === intervalMinutes) return false;

        const now = this.now();
        const state = this.readStateSafely(ws.id);
        // Overdue == the first tick is the short post-boot one, which is the only
        // case that competes with other repos for the same startup window and so
        // the only case that should consume a stagger slot.
        const lastMs = state ? Date.parse(state.lastRunAt) : NaN;
        const overdue = Number.isFinite(lastMs)
            && (lastMs > now || lastMs + intervalMinutes * 60_000 <= now);
        const delayMs = computeFirstTickDelayMs({ state, intervalMinutes, now, staggerIndex });
        this.schedule(ws, intervalMinutes, delayMs);
        return overdue;
    }

    /** Replace any existing timer with one firing in `delayMs`. */
    private schedule(ws: AutoPullWorkspace, intervalMinutes: number, delayMs: number): void {
        this.clearWorkspace(ws.id);
        if (this.disposed) return;
        const timer = this.timerApi.setTimeout(() => {
            void this.tickAndRearm(ws, intervalMinutes);
        }, delayMs);
        this.timers.set(ws.id, { timer, intervalMinutes, nextRunAtMs: this.now() + delayMs });
    }

    /**
     * Run one tick, then arm the next one a full interval out.
     *
     * Re-arming happens in a `finally` so a tick that somehow rejects — the tick
     * is written not to, but this is the last line of defence — still leaves the
     * repo scheduled. The re-arm is skipped if the timer was cleared while the
     * tick was in flight (auto-pull turned off, or shutdown), which would
     * otherwise resurrect a disposed timer.
     */
    private async tickAndRearm(ws: AutoPullWorkspace, intervalMinutes: number): Promise<void> {
        const armedBefore = this.timers.get(ws.id);
        this.timers.delete(ws.id);
        try {
            await this.deps.runTick(ws);
        } catch (error) {
            this.logError(`${ws.id}: ${errorMessage(error)}`);
        } finally {
            const stillCurrent = armedBefore !== undefined && !this.disposed && !this.timers.has(ws.id);
            if (stillCurrent && this.readPreferenceSafely(ws.id)?.enabled === true) {
                this.schedule(ws, intervalMinutes, intervalMinutes * 60_000);
            }
        }
    }

    private clearWorkspace(workspaceId: string): void {
        const existing = this.timers.get(workspaceId);
        if (!existing) return;
        this.timerApi.clearTimeout(existing.timer);
        this.timers.delete(workspaceId);
    }

    private async listWorkspacesSafely(): Promise<readonly AutoPullWorkspace[]> {
        try {
            return await this.deps.listWorkspaces();
        } catch (error) {
            this.logError(`failed to list workspaces: ${errorMessage(error)}`);
            return [];
        }
    }

    private readPreferenceSafely(workspaceId: string): AutoPullPreference | undefined {
        try {
            return this.deps.readAutoPullPreference(workspaceId);
        } catch (error) {
            this.logError(`${workspaceId}: failed to read preferences: ${errorMessage(error)}`);
            return undefined;
        }
    }

    private readStateSafely(workspaceId: string): AutoPullRunState | undefined {
        return readAutoPullState(this.deps.dataDir, workspaceId);
    }
}
