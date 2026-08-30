/**
 * autoPullStatusView — presentation helpers for the server-owned auto-pull schedule.
 *
 * The server owns the auto-pull timer, so the client never computes *when* the
 * next pull happens; it only renders the `{ nextRunAt, lastRunAt, outcome }`
 * the read API reports. These helpers are kept free of React so the wording and
 * the rounding rules can be unit-tested directly.
 */

import type { GitAutoPullOutcome, GitAutoPullStatusResponse } from '@plusplusoneplusplus/coc-client';

/** Human wording per terminal outcome, matching the server's AUTO_PULL_MESSAGES intent. */
const OUTCOME_LABELS: Record<GitAutoPullOutcome, string> = {
    'success': 'pulled',
    'failed': 'failed',
    'skipped-dirty': 'skipped — uncommitted changes',
    'skipped-precheck-error': 'skipped — could not check the working tree',
    'skipped-in-flight': 'skipped — a pull was already running',
};

/**
 * Short label for a scheduled instant, e.g. `in 4m` / `in 2h` / `due`.
 * Returns undefined when nothing is scheduled, so callers can omit the row
 * rather than render a placeholder.
 */
export function formatTimeUntil(nextRunAt: string | undefined, nowMs: number): string | undefined {
    if (!nextRunAt) return undefined;
    const dueMs = Date.parse(nextRunAt);
    if (!Number.isFinite(dueMs)) return undefined;
    const remainingMs = dueMs - nowMs;
    // A tick that is due (or overdue) reads as "due" rather than a negative count:
    // the server may be mid-pull, and a countdown running backwards is noise.
    if (remainingMs <= 0) return 'due';
    const minutes = Math.ceil(remainingMs / 60_000);
    if (minutes < 60) return `in ${minutes}m`;
    const hours = Math.ceil(minutes / 60);
    if (hours < 24) return `in ${hours}h`;
    return `in ${Math.ceil(hours / 24)}d`;
}

/**
 * One-line description of the last run, e.g.
 * `skipped — uncommitted changes`. Undefined when the repo has never run.
 */
export function describeLastRun(status: GitAutoPullStatusResponse | undefined): string | undefined {
    if (!status?.outcome) return undefined;
    return OUTCOME_LABELS[status.outcome] ?? status.outcome;
}

/** Full detail for the title attribute: the outcome plus the server's message. */
export function describeLastRunDetail(status: GitAutoPullStatusResponse | undefined): string | undefined {
    const label = describeLastRun(status);
    if (!label) return undefined;
    const when = status?.lastRunAt ? new Date(status.lastRunAt).toLocaleString() : undefined;
    return [when, label, status?.message].filter(Boolean).join(' — ');
}
