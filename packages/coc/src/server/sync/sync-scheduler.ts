/**
 * Timer + backoff kernel for the notes sync engine.
 *
 * {@link SyncScheduler} owns the self-rescheduling timeout, the failure backoff,
 * and the generation guard that stops an in-flight tick from resurrecting a
 * stopped timer. Isolating it means a skipped, failed, or stopped tick can't
 * reach into — or reorder — the sync transaction.
 */

import type { SyncLogger } from './sync-types';

/**
 * Compute the delay before the next scheduled sync. On success the delay resets
 * to the base interval; on failure it doubles (capped at `maxMs`) so a broken
 * remote backs off instead of hammering the disk every tick.
 */
export function nextSyncDelayMs(opts: {
    failed: boolean;
    currentMs: number;
    baseMs: number;
    maxMs: number;
}): number {
    if (!opts.failed) return opts.baseMs;
    return Math.min(Math.max(opts.currentMs, opts.baseMs) * 2, opts.maxMs);
}

export interface SyncSchedulerOptions {
    logger: SyncLogger;
    /** Upper bound on the backoff delay (ms). */
    maxBackoffMs: number;
    /** Run one tick. Failures are surfaced via `didFail`, not by throwing. */
    tick: () => Promise<void>;
    /** Read after each tick to decide whether to back off. */
    didFail: () => boolean;
    /** Guard: a scheduled tick is skipped (and not rescheduled) when this returns false. */
    shouldRun?: () => boolean;
}

/**
 * Schedules ticks via a self-rescheduling timeout (rather than a fixed interval)
 * so the delay can grow after a failure and reset after success.
 */
export class SyncScheduler {
    private timer: ReturnType<typeof setTimeout> | null = null;
    /** Base delay between ticks (ms), from the configured interval. */
    private baseDelayMs = 0;
    /** Delay (ms) for the next tick; grows on failure, resets on success. */
    private _nextDelayMs = 0;
    /** Bumped on start/stop so an in-flight tick can't resurrect a stopped timer. */
    private generation = 0;

    constructor(private readonly opts: SyncSchedulerOptions) {}

    /** Delay (ms) before the next scheduled tick. Exposed for observability/tests. */
    get nextDelayMs(): number {
        return this._nextDelayMs;
    }

    /** (Re)start periodic ticks every `intervalMinutes`. */
    start(intervalMinutes: number): void {
        this.stop();
        this.baseDelayMs = intervalMinutes * 60_000;
        this._nextDelayMs = this.baseDelayMs;
        this.schedule(this.generation);
        this.opts.logger.info(`Periodic sync scheduled every ${intervalMinutes} minutes`);
    }

    /** Stop periodic ticks. Any in-flight tick will not reschedule itself. */
    stop(): void {
        // Bump the generation so any in-flight tick won't reschedule itself.
        this.generation++;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private schedule(generation: number): void {
        this.timer = setTimeout(() => { void this.run(generation); }, this._nextDelayMs);
        // Don't hold the event loop open for the timer.
        if (this.timer && typeof this.timer === 'object' && 'unref' in this.timer) {
            this.timer.unref();
        }
    }

    private async run(generation: number): Promise<void> {
        if (generation !== this.generation || !this.enabled()) return;
        try {
            await this.opts.tick();
        } catch { /* tick records its own failure */ }
        // Back off on failure, reset to the base delay on success.
        this._nextDelayMs = nextSyncDelayMs({
            failed: this.opts.didFail(),
            currentMs: this._nextDelayMs,
            baseMs: this.baseDelayMs,
            maxMs: this.opts.maxBackoffMs,
        });
        // Only reschedule if we haven't been stopped/reconfigured mid-tick.
        if (generation === this.generation && this.enabled()) {
            this.schedule(generation);
        }
    }

    private enabled(): boolean {
        return this.opts.shouldRun ? this.opts.shouldRun() : true;
    }
}
