/**
 * One server-side auto-pull tick.
 *
 * Port of the browser's `runAutoPullTick` (AC-02). The timer that calls this
 * lives in `auto-pull-manager`; this module owns only *what a tick does*, kept
 * free of timers and HTTP so it can be unit-tested directly:
 *
 *   1. Single-flight — if a `pull` job is already running for the workspace the
 *      tick is a no-op. `GitOperationRunner.start` re-checks this and answers
 *      with a 409, which is treated the same way, so a race between the manual
 *      Pull button and a tick can't stack two pulls.
 *   2. Dirty pre-check — never auto-pull into a working tree with
 *      staged/unstaged changes; a rebase/merge there could clobber local work or
 *      refuse outright. Untracked files do not block a pull, so they do not
 *      count as dirty. Skipped ticks retry on the next interval.
 *   3. Otherwise run the same pull the manual button runs, *through*
 *      `GitOperationRunner`, so the job record, cache invalidation, and the
 *      `git-changed` broadcast all behave exactly as they do for a manual pull.
 *
 * `start()` returns as soon as the job record exists and settles the job in the
 * background, so the tick cannot read the pull's outcome from its return value.
 * To persist a terminal outcome (AC-03) the tick wraps the `run` callback and
 * writes the state from inside the wrapper, where the result is visible.
 *
 * A tick never throws: every failure path resolves to an outcome, so a rejected
 * promise can't kill the interval that scheduled it.
 *
 * Pure Node.js. Cross-platform compatible.
 */

import type { GitChange } from '@plusplusoneplusplus/forge';
import type { GitOperationOutcome, GitOperationRunner } from './git-operation-runner';
import { writeAutoPullState, type AutoPullOutcome } from './auto-pull-state';

/** Messages persisted alongside a non-success outcome and shown by the client. */
export const AUTO_PULL_MESSAGES = {
    dirty: 'Skipped: uncommitted changes in the working tree.',
    precheckError: 'Skipped: could not check the working tree.',
    genericFailure: 'The pull could not complete cleanly.',
} as const;

/** What one tick decided. `started-job` is the only non-terminal outcome. */
export type AutoPullTickOutcome = AutoPullOutcome | 'started-job';

export interface AutoPullTickDeps {
    /** Where the run-state file lives (`<dataDir>/repos/<workspaceId>/`). */
    dataDir: string;
    workspaceId: string;
    /** Absolute path of the repository to pull. */
    repoRoot: string;
    /** True when a `pull` job is already running for this workspace. */
    isPullRunning: () => Promise<boolean>;
    /** Working-tree changes for the dirty pre-check. */
    getChanges: (repoRoot: string) => Promise<readonly GitChange[]>;
    /** The pull itself — same `BranchService` call the manual route makes. */
    pull: (repoRoot: string) => Promise<GitOperationOutcome>;
    /** Owns the job record, the 409 guard, cache invalidation, and the broadcast. */
    runner: GitOperationRunner;
    /** Epoch millis for `lastRunAt`. Injectable so tests don't depend on the clock. */
    now?: () => number;
}

export interface AutoPullTickResult {
    outcome: AutoPullTickOutcome;
    /** Set when `outcome === 'started-job'`. */
    jobId?: string;
    /** Detail persisted with skips and failures. */
    message?: string;
}

/**
 * Tracked (staged/unstaged) changes an incoming pull could clobber. Untracked
 * files are excluded — they never block a pull, and treating a stray untracked
 * file as dirty would silently stall auto-pull forever.
 */
export function hasBlockingChanges(changes: readonly GitChange[]): boolean {
    return changes.some(c => c.stage === 'staged' || c.stage === 'unstaged');
}

/** An `APIError` carrying HTTP 409 — the runner's single-flight guard. */
function isConflictError(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { statusCode?: unknown }).statusCode === 409;
}

function errorMessage(err: unknown): string {
    return err instanceof Error && err.message ? err.message : AUTO_PULL_MESSAGES.genericFailure;
}

/** Run one auto-pull tick for a repository. Never rejects. */
export async function runAutoPullTick(deps: AutoPullTickDeps): Promise<AutoPullTickResult> {
    const nowMs = () => (deps.now ? deps.now() : Date.now());
    const record = (outcome: AutoPullOutcome, message?: string): AutoPullTickResult => {
        writeAutoPullState(deps.dataDir, deps.workspaceId, {
            lastRunAt: new Date(nowMs()).toISOString(),
            outcome,
            ...(message ? { message } : {}),
        });
        return message ? { outcome, message } : { outcome };
    };

    // 1. Single-flight: never stack a second pull on an in-flight one.
    try {
        if (await deps.isPullRunning()) return record('skipped-in-flight');
    } catch {
        // Unreadable job store: fall through. `start`'s own 409 guard still applies.
    }

    // 2. Dirty pre-check.
    let changes: readonly GitChange[];
    try {
        changes = await deps.getChanges(deps.repoRoot);
    } catch {
        return record('skipped-precheck-error', AUTO_PULL_MESSAGES.precheckError);
    }
    if (hasBlockingChanges(changes)) {
        return record('skipped-dirty', AUTO_PULL_MESSAGES.dirty);
    }

    // 3. The real pull, through the runner. The wrapper around `run` is the only
    //    place the terminal outcome is observable, so the state is written there.
    try {
        const { jobId } = await deps.runner.start({
            workspaceId: deps.workspaceId,
            op: 'pull',
            rejectIfRunning: 'A pull operation is already running',
            run: async () => {
                try {
                    const result = await deps.pull(deps.repoRoot);
                    if (result.success) record('success');
                    else record('failed', result.error || AUTO_PULL_MESSAGES.genericFailure);
                    return result;
                } catch (err) {
                    record('failed', errorMessage(err));
                    throw err;
                }
            },
        });
        return { outcome: 'started-job', jobId };
    } catch (err) {
        // The runner's 409 means a pull started between step 1 and here.
        if (isConflictError(err)) return record('skipped-in-flight');
        return record('failed', errorMessage(err));
    }
}
