/**
 * autoPullTick — pure decision logic for one auto-pull timer tick.
 *
 * The per-repo auto-pull timer (useAutoPullTimer) owns *when* a tick fires; this
 * module owns *what a tick does*, kept free of React so it can be unit-tested
 * directly:
 *
 *   1. Single-flight — if a pull (manual or auto) is already in flight, the tick
 *      is a no-op (AC-3). The server also guards this with a 409, treated the
 *      same way.
 *   2. Dirty pre-check — never auto-pull into a working tree with staged/unstaged
 *      changes; a rebase/merge there could clobber local work or refuse outright.
 *      Skip with a clear toast and retry next tick (AC-4). Untracked files do not
 *      block a rebase, so they do not count as "blocking".
 *   3. Otherwise run the same async pull the manual "Pull" button uses and hand
 *      the job id back for polling.
 *
 * `buildAutoPullPollerCallbacks` wraps the shared git-operation poller so a
 * failed auto-pull job (non-fast-forward / conflict) surfaces a toast instead of
 * the manual-pull action banner, while success refreshes and resets the
 * countdown.
 */

import type { GitAsyncJobResponse, GitWorkingTreeChange } from '@plusplusoneplusplus/coc-client';
import type { GitOperationPollerCallbacks } from './hooks/useGitOperationPoller';

/** User-facing toast strings for auto-pull skips/failures (exported for tests). */
export const AUTO_PULL_MESSAGES = {
    dirty: 'Auto-pull skipped: uncommitted changes in the working tree.',
    precheckError: 'Auto-pull skipped: could not check the working tree.',
    failedPrefix: 'Auto-pull skipped: ',
    genericFailure: 'the pull could not complete cleanly.',
} as const;

/** Terminal outcome of a single tick — returned for testability, ignored by callers. */
export type AutoPullTickOutcome =
    | 'skipped-in-flight'
    | 'skipped-dirty'
    | 'skipped-precheck-error'
    | 'started-job'
    | 'synced'
    | 'failed';

export interface AutoPullTickDeps {
    /** True when a pull (manual or auto) is already running — makes the tick a no-op. */
    isPullInFlight: () => boolean;
    /** Fetch working-tree changes for the dirty pre-check. */
    getWorkingTreeChanges: () => Promise<{ changes?: GitWorkingTreeChange[] }>;
    /** Start the async pull (same call the manual Pull button makes). */
    pull: () => Promise<GitAsyncJobResponse>;
    /** The async pull returned a job id — begin polling it. */
    onJobStarted: (jobId: string) => void;
    /** The pull completed synchronously (no job) — refresh + reset countdown. */
    onSyncSuccess: () => void;
    /** Skip/failure notification (non-blocking toast). */
    onSkip: (message: string) => void;
    /** Toggle the shared in-flight flag (mirrors the manual pull's `pulling`). */
    setInFlight: (value: boolean) => void;
}

/**
 * Tracked (staged/unstaged) changes a pull could clobber or that would block a
 * rebase. Untracked files are excluded — they do not block `git pull --rebase`
 * and treating a stray untracked file as "dirty" would silently stall auto-pull.
 */
export function hasBlockingChanges(changes: readonly GitWorkingTreeChange[]): boolean {
    return changes.some(c => c.stage === 'staged' || c.stage === 'unstaged');
}

/** A thrown error carrying HTTP 409 — the server's single-flight guard. */
function isConflictError(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { status?: unknown }).status === 409;
}

/**
 * Run one auto-pull tick. Never throws — every failure path resolves to an
 * outcome and (where relevant) a toast, so a rejected promise can't crash the
 * interval.
 */
export async function runAutoPullTick(deps: AutoPullTickDeps): Promise<AutoPullTickOutcome> {
    // 1. Single-flight: never stack a second pull on an in-flight one (AC-3).
    if (deps.isPullInFlight()) return 'skipped-in-flight';

    // 2. Dirty pre-check: don't auto-pull into a working tree with local changes (AC-4).
    let changes: readonly GitWorkingTreeChange[];
    try {
        const wt = await deps.getWorkingTreeChanges();
        changes = wt.changes ?? [];
    } catch {
        deps.onSkip(AUTO_PULL_MESSAGES.precheckError);
        return 'skipped-precheck-error';
    }
    if (hasBlockingChanges(changes)) {
        deps.onSkip(AUTO_PULL_MESSAGES.dirty);
        return 'skipped-dirty';
    }

    // 3. Run the real pull via the existing async-job path.
    deps.setInFlight(true);
    let result: GitAsyncJobResponse;
    try {
        result = await deps.pull();
    } catch (err) {
        deps.setInFlight(false);
        // Server single-flight (409): a pull is already running — treat as no-op.
        if (isConflictError(err)) return 'skipped-in-flight';
        deps.onSkip(AUTO_PULL_MESSAGES.failedPrefix + AUTO_PULL_MESSAGES.genericFailure);
        return 'failed';
    }

    if (result.jobId) {
        deps.onJobStarted(result.jobId);
        return 'started-job';
    }
    if (result.success === false) {
        deps.setInFlight(false);
        deps.onSkip(AUTO_PULL_MESSAGES.failedPrefix + (result.error || AUTO_PULL_MESSAGES.genericFailure));
        return 'failed';
    }
    // Synchronous success (no job returned).
    deps.setInFlight(false);
    deps.onSyncSuccess();
    return 'synced';
}

export interface AutoPullPollerHooks {
    /** Toggle the shared in-flight flag when the job reaches a terminal state. */
    setInFlight: (value: boolean) => void;
    /** Terminal success — refresh data and reset the countdown. */
    onSuccess: () => void;
    /** Terminal failure — receives the ready-to-show toast message. */
    onFailure: (message: string) => void;
}

/**
 * Poller callbacks for an auto-pull job: a failed job (non-fast-forward /
 * conflict) becomes a toast rather than the manual-pull action banner (AC-4).
 */
export function buildAutoPullPollerCallbacks(hooks: AutoPullPollerHooks): GitOperationPollerCallbacks {
    return {
        onSuccess: () => {
            hooks.setInFlight(false);
            hooks.onSuccess();
        },
        onFailure: (error) => {
            hooks.setInFlight(false);
            hooks.onFailure(AUTO_PULL_MESSAGES.failedPrefix + (error || AUTO_PULL_MESSAGES.genericFailure));
        },
        onError: () => {
            hooks.setInFlight(false);
        },
    };
}
