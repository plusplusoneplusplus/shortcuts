/**
 * Persisted per-repo auto-pull run state, plus the boot scheduling math.
 *
 * Auto-pull used to be a browser `setInterval`, so its countdown restarted on
 * every page load and nothing survived a reload. The server owns the timer now,
 * which means it also has to remember when each repo last ran: on boot the next
 * run is anchored to `lastRunAt + intervalMinutes`, not to process start
 * (AC-03). That anchor lives in a tiny per-repo JSON file written the same
 * write-then-rename way as `writeRepoPreferences`, so a crash mid-write can
 * never leave a half-parsed file behind.
 *
 * A missing or corrupt file is "never run", never an error — auto-pull is a
 * convenience and must not be able to break server startup.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getRepoDataPath } from '../paths';

/** File name under `<dataDir>/repos/<workspaceId>/` holding the run state. */
export const AUTO_PULL_STATE_FILE_NAME = 'auto-pull-state.json';

/**
 * Terminal outcome of one tick. Mirrors the outcomes the old client-side
 * `runAutoPullTick` reported as toasts, minus `started-job` — a started job is
 * not terminal, so the state is written when the job settles.
 */
export type AutoPullOutcome =
    | 'success'
    | 'failed'
    | 'skipped-dirty'
    | 'skipped-precheck-error'
    | 'skipped-in-flight';

const OUTCOMES: readonly AutoPullOutcome[] = [
    'success',
    'failed',
    'skipped-dirty',
    'skipped-precheck-error',
    'skipped-in-flight',
];

/** One repo's last auto-pull result, as persisted and as served to the client. */
export interface AutoPullRunState {
    /** ISO timestamp of the tick that produced `outcome`. */
    lastRunAt: string;
    outcome: AutoPullOutcome;
    /** Human-readable detail for skips and failures. Absent on plain success. */
    message?: string;
}

/**
 * Delay before the first tick of a repo that is already overdue at boot. Short
 * enough to feel immediate, long enough that startup work (workspace scan, git
 * cache warm-up) is done first.
 */
export const OVERDUE_FIRST_TICK_DELAY_MS = 5_000;

/**
 * Added per overdue repo so a server that has been down for a day does not fire
 * every repo's `git pull` in the same tick.
 */
export const OVERDUE_STAGGER_STEP_MS = 3_000;

/** Upper bound on the stagger so a large workspace list can't push a repo far out. */
export const OVERDUE_STAGGER_MAX_MS = 60_000;

function stateFilePath(dataDir: string, workspaceId: string): string {
    return getRepoDataPath(dataDir, workspaceId, AUTO_PULL_STATE_FILE_NAME);
}

function isOutcome(value: unknown): value is AutoPullOutcome {
    return typeof value === 'string' && (OUTCOMES as readonly string[]).includes(value);
}

/**
 * Read a repo's persisted run state.
 *
 * Returns `undefined` for "never run" — which covers a missing file, unreadable
 * JSON, and any shape that isn't a usable `{ lastRunAt, outcome }` pair. Never
 * throws.
 */
export function readAutoPullState(dataDir: string, workspaceId: string): AutoPullRunState | undefined {
    try {
        const raw = fs.readFileSync(stateFilePath(dataDir, workspaceId), 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) return undefined;
        const obj = parsed as Record<string, unknown>;
        if (typeof obj.lastRunAt !== 'string') return undefined;
        if (!Number.isFinite(Date.parse(obj.lastRunAt))) return undefined;
        if (!isOutcome(obj.outcome)) return undefined;
        const state: AutoPullRunState = { lastRunAt: obj.lastRunAt, outcome: obj.outcome };
        if (typeof obj.message === 'string' && obj.message.length > 0) state.message = obj.message;
        return state;
    } catch {
        return undefined;
    }
}

/**
 * Write a repo's run state atomically (write-then-rename).
 *
 * Best-effort: a failure to persist must not propagate into the tick, which
 * would otherwise turn a full disk into a crashed timer.
 */
export function writeAutoPullState(dataDir: string, workspaceId: string, state: AutoPullRunState): void {
    const filePath = stateFilePath(dataDir, workspaceId);
    const tmpPath = filePath + '.tmp';
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
        fs.renameSync(tmpPath, filePath);
    } catch {
        try { fs.rmSync(tmpPath, { force: true }); } catch { /* nothing left to clean up */ }
    }
}

/** Remove a repo's run state, e.g. when auto-pull is turned off. Never throws. */
export function clearAutoPullState(dataDir: string, workspaceId: string): void {
    try {
        fs.rmSync(stateFilePath(dataDir, workspaceId), { force: true });
    } catch { /* clearing state is best-effort */ }
}

export interface FirstTickDelayOptions {
    /** Persisted state, or `undefined` when the repo has never auto-pulled. */
    state: AutoPullRunState | undefined;
    intervalMinutes: number;
    /** Epoch millis "now". Injected so the math is testable without fake timers. */
    now: number;
    /** Position of this repo among the overdue repos armed in this pass. */
    staggerIndex?: number;
}

/**
 * Delay (ms) until this repo's first tick after boot.
 *
 * - Never run: a full interval from now. Enabling auto-pull shouldn't yank the
 *   working tree the instant the server restarts, and there is no evidence a
 *   pull is due.
 * - Ran recently: the remainder of `lastRunAt + interval`, so a restart mid
 *   interval doesn't reset the countdown.
 * - Overdue (including a `lastRunAt` in the future from a clock change, which
 *   would otherwise park the repo indefinitely): a short staggered delay.
 */
export function computeFirstTickDelayMs(options: FirstTickDelayOptions): number {
    const intervalMs = options.intervalMinutes * 60_000;
    const last = options.state ? Date.parse(options.state.lastRunAt) : NaN;
    if (!Number.isFinite(last)) return intervalMs;
    // A future `lastRunAt` means the clock moved; don't wait it out.
    const remaining = last > options.now ? 0 : last + intervalMs - options.now;
    if (remaining > 0) return Math.min(remaining, intervalMs);
    const stagger = Math.min((options.staggerIndex ?? 0) * OVERDUE_STAGGER_STEP_MS, OVERDUE_STAGGER_MAX_MS);
    return OVERDUE_FIRST_TICK_DELAY_MS + stagger;
}

/**
 * ISO timestamp the client should count down to, so the pill's countdown comes
 * from the server's schedule rather than the browser's own clock (AC-05).
 */
export function computeNextRunAt(nowMs: number, delayMs: number): string {
    return new Date(nowMs + delayMs).toISOString();
}
