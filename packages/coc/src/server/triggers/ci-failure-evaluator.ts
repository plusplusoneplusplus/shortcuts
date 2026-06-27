/**
 * CI-Failure Condition-Monitor Evaluator
 *
 * The ONE `EventEvaluator` implemented this iteration. While its owning trigger
 * is `active`, the `TriggerManager` ticks it on a steady cadence; this evaluator
 * polls the PR's checks (reusing the existing server-side checks-fetch path) and
 * decides whether the fix action should fire.
 *
 * Fire rule (transition detection): fire when ANY check is currently `failure`
 * AND its last-seen status (by check id) was NOT `failure`. This covers:
 *  - green/success → failure              (fires once)
 *  - pending/running → failure            (fires once)
 *  - a newly-appeared failing check       (fires — its id was never seen)
 *  - failure → failure (same id)          (does NOT re-fire)
 *  - currently green / no failures        (does NOT fire; keeps polling)
 *
 * The evaluator never mutates persisted state itself — it returns the refreshed
 * event (with an updated `lastSeenChecks` snapshot) and lets the manager decide
 * whether to persist it (the manager skips persisting on a suppressed fire so a
 * pending failure is re-detected once the in-flight fix completes).
 *
 * Auto-disarm: when the PR is `merged` or `closed`, the evaluator requests a
 * terminal `disarmed`. TTL expiry is handled by the manager, not here.
 *
 * Checks are fetched through an injected {@link CiChecksFetcher} so the
 * transition logic stays pure and unit-testable. The production fetcher reuses
 * the origin-scoped server-side checks path (`createPullRequestsServiceForRepo`
 * + `getChecks`/`getPullRequest`), which is workspace/remote-clone friendly.
 */

import type { Trigger, TriggerEvent } from './trigger-types';
import type { EvaluationOutcome, EventEvaluator } from './trigger-manager';
import { buildCiFailurePrompt } from './ci-failure-prompt';

// ============================================================================
// Snapshot types (provider-agnostic; mirror the canonical PR check vocabulary)
// ============================================================================

/** Canonical check status vocabulary (mirrors forge `CheckStatus`). */
export type CiCheckStatus =
    | 'pending'
    | 'running'
    | 'success'
    | 'failure'
    | 'cancelled'
    | 'skipped'
    | 'warning'
    | 'unknown';

/** Lifecycle state of the polled PR (mirrors forge `PullRequestStatus`). */
export type CiPrStatus = 'open' | 'closed' | 'merged' | 'draft';

/** Minimal per-check snapshot needed for transition detection + prompt. */
export interface CiCheckSnapshot {
    id: string;
    name: string;
    status: CiCheckStatus;
    detailsUrl?: string;
}

/** A single poll's view of the PR and its checks. */
export interface CiPrChecksSnapshot {
    prStatus: CiPrStatus;
    prNumber: string | number;
    /** PR head (source) branch — named in the fix prompt's delivery contract (AC-02/AC-03). */
    headRef?: string;
    /** PR head commit SHA — keys the retry-limit attempt counter (AC-05). */
    headSha?: string;
    checks: CiCheckSnapshot[];
}

/**
 * Fetches the current PR + checks snapshot for a condition monitor. Injected so
 * the evaluator can be unit-tested without provider/HTTP wiring; the production
 * implementation reuses the server-side origin-scoped checks path.
 */
export interface CiChecksFetcher {
    (args: { workspaceId: string; originId: string; prId: string }): Promise<CiPrChecksSnapshot>;
}

// ============================================================================
// Evaluator
// ============================================================================

export class CiFailureEvaluator implements EventEvaluator {
    private readonly fetcher: CiChecksFetcher;

    constructor(fetcher: CiChecksFetcher) {
        this.fetcher = fetcher;
    }

    async evaluate(trigger: Trigger): Promise<EvaluationOutcome> {
        const event = trigger.event;
        // Defensive: this evaluator only handles ci-failure condition monitors.
        if (event.type !== 'condition-monitor' || event.monitor !== 'ci-failure') {
            return { fire: false, event };
        }

        const snapshot = await this.fetcher({
            workspaceId: trigger.workspaceId,
            originId: event.originId,
            prId: event.prId,
        });

        // Auto-disarm once the PR is terminal (merged/closed). `draft` and `open`
        // keep the monitor armed and polling.
        if (snapshot.prStatus === 'merged' || snapshot.prStatus === 'closed') {
            return {
                fire: false,
                event,
                autoDisarm: { status: 'disarmed', reason: `PR ${snapshot.prStatus}` },
            };
        }

        // Compute the refreshed last-seen snapshot and detect failure transitions.
        const nextLastSeen: Record<string, string> = {};
        const newlyFailing: CiCheckSnapshot[] = [];
        for (const check of snapshot.checks) {
            nextLastSeen[check.id] = check.status;
            const prev = event.lastSeenChecks[check.id];
            if (check.status === 'failure' && prev !== 'failure') {
                newlyFailing.push(check);
            }
        }

        const nextEvent: TriggerEvent = { ...event, lastSeenChecks: nextLastSeen };

        if (newlyFailing.length === 0) {
            // No new failure transition — track the latest state and keep polling.
            return { fire: false, event: nextEvent };
        }

        // Fire: name every currently-failing check (full picture) in the prompt,
        // not only the newly-failed ones.
        const failingChecks = snapshot.checks.filter(c => c.status === 'failure');
        const actionPrompt = buildCiFailurePrompt(snapshot.prNumber, failingChecks, snapshot.headRef);
        return { fire: true, event: nextEvent, actionPrompt };
    }
}
