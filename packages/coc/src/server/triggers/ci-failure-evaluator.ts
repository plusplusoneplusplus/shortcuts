/**
 * One owner-routed monitor for CI transitions and explicitly authorized conflicts.
 * Conflict attempts use the provider-qualified PR/head/base tuple and a bounded
 * cross-head budget. Unknown previews wait; policies remain visible blockers.
 * Current-head CI transitions remain independent of merge readiness.
 * Evaluation returns state only; the manager persists it, owns writer admission
 * and delivery retries, and handles expiry. Merged/closed PRs request disarm.
 */

import type { ConditionMonitorEvent, Trigger } from './trigger-types';
import { MAX_CI_FIX_ATTEMPTS, MAX_CONFLICT_FIX_ATTEMPTS, MAX_CONFLICT_FIX_TOTAL } from './trigger-types';
import type { EvaluationOutcome, EventEvaluator } from './trigger-manager';
import { buildCiFailurePrompt, buildConflictRepairPrompt } from './ci-failure-prompt';

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
    baseSha?: string;
    baseRef?: string;
    prKey?: string;
    checksHeadSha?: string;
    mergeability?: { state: 'mergeable' | 'conflicting' | 'unknown' | 'blocked'; blockedReason?: string };
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

/**
 * Fetches a truncated log excerpt for the currently-failing checks (AC-02).
 * Injected and OPTIONAL so the evaluator stays pure/unit-testable and the fix
 * still fires when logs cannot be fetched. Returns the excerpt to inject into
 * the prompt, or `undefined` when no logs are available. Implementations must
 * never throw on a transient log-fetch failure — resolve `undefined` instead;
 * the evaluator also guards the call so a rejection can never block the fix.
 */
export interface CiLogFetcher {
    (args: {
        workspaceId: string;
        originId: string;
        prId: string;
        failingChecks: CiCheckSnapshot[];
    }): Promise<string | undefined>;
}

// ============================================================================
// Evaluator
// ============================================================================

export class CiFailureEvaluator implements EventEvaluator {
    private readonly fetcher: CiChecksFetcher;
    private readonly logFetcher?: CiLogFetcher;

    constructor(fetcher: CiChecksFetcher, logFetcher?: CiLogFetcher) {
        this.fetcher = fetcher;
        this.logFetcher = logFetcher;
    }

    async evaluate(trigger: Trigger, options?: { manualCi?: boolean }): Promise<EvaluationOutcome> {
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
            const prev = event.attemptSha === snapshot.headSha || !snapshot.headSha
                ? event.lastSeenChecks[check.id] : undefined;
            if (check.status === 'failure' && (prev !== 'failure' || options?.manualCi)) {
                newlyFailing.push(check);
            }
        }

        // Resolve the retry counter for the CURRENT head SHA (AC-05). A new
        // commit (SHA change) resets the count/notice; an absent SHA falls back
        // to a stable '' key so the cap still accumulates rather than resetting
        // every poll.
        const shaKey = snapshot.headSha ?? '';
        const sameSha = event.attemptSha === shaKey;
        const attemptCount = sameSha ? (event.attemptCount ?? 0) : 0;
        const attemptNotified = sameSha ? (event.attemptNotified ?? false) : false;
        const priorChecks = sameSha || !snapshot.headSha ? event.lastSeenChecks : {};

        const nextEvent: ConditionMonitorEvent = {
            ...event,
            lastSeenChecks: nextLastSeen,
            attemptSha: shaKey,
            attemptCount,
            attemptNotified,
            ...(snapshot.prKey ? { prKey: snapshot.prKey } : {}),
        };

        const expanded = event.repairScope === 'ci-and-conflicts';
        if (!expanded && snapshot.mergeability?.state === 'conflicting') {
            nextEvent.repairStatus = 'Merge conflict requires explicit conflict repair authorization';
        }
        if (expanded) {
            if (event.prKey && snapshot.prKey && event.prKey !== snapshot.prKey) {
                nextEvent.prKey = event.prKey;
                nextEvent.repairStatus = 'PR identity changed; reauthorize in the owner chat';
                return this.noFire(event, nextEvent);
            }
            // Provider policy/approval blockers are display state, never a repair instruction.
            const policy = snapshot.mergeability?.state === 'blocked' ? snapshot.mergeability.blockedReason
                ?? 'Waiting for provider approvals or policies' : undefined;
            nextEvent.repairStatus = policy ?? (snapshot.mergeability?.state === 'unknown' || !snapshot.mergeability
                ? 'Waiting for provider mergeability'
                : snapshot.checksHeadSha !== snapshot.headSha || !snapshot.headSha || snapshot.checks.length === 0
                    ? 'Waiting for fresh current-head CI'
                    : snapshot.checks.some(c => c.status === 'pending' || c.status === 'running' || c.status === 'unknown')
                        ? 'Waiting for current-head CI'
                        : 'Monitoring; provider merge policies still apply');
            if (snapshot.mergeability?.state === 'conflicting' && !options?.manualCi) {
                if (!snapshot.prKey || !snapshot.headSha || !snapshot.baseSha || !snapshot.headRef) {
                    nextEvent.repairStatus = 'Conflict blocked: provider identity, branch or commit snapshot unavailable';
                    return this.noFire(event, nextEvent);
                }
                const key = JSON.stringify([snapshot.prKey, snapshot.headSha, snapshot.baseSha]);
                const attempts = event.conflictAttempts ?? {};
                const count = attempts[key] ?? 0;
                const total = Object.values(attempts).reduce((sum, value) => sum + value, 0);
                nextEvent.conflictAttemptKey = key;
                if (trigger.inFlight) {
                    nextEvent.lastSeenChecks = priorChecks;
                    nextEvent.repairStatus = 'Repair in flight; waiting for its new head';
                    return this.noFire(event, nextEvent);
                }
                if (event.conflictBlocked && event.conflictAttemptKey === key) {
                    nextEvent.repairStatus = event.conflictBlocked;
                    return this.noFire(event, nextEvent);
                }
                if (event.conflictAwaitingHead === snapshot.headSha && event.conflictAttemptKey === key) {
                    nextEvent.conflictBlocked = 'Conflict repair produced no new head or an ambiguous resolution; human action required';
                    nextEvent.repairStatus = nextEvent.conflictBlocked;
                    return this.noFire(event, nextEvent);
                }
                if (count >= MAX_CONFLICT_FIX_ATTEMPTS || total >= MAX_CONFLICT_FIX_TOTAL) {
                    nextEvent.repairStatus = 'Conflict repair retry budget exhausted; human action required';
                    return this.noFire(event, nextEvent);
                }
                nextEvent.conflictAttempts = { ...attempts, [key]: count + 1 };
                nextEvent.conflictAwaitingHead = snapshot.headSha;
                nextEvent.conflictBlocked = undefined;
                nextEvent.repairStatus = 'Repairing confirmed merge conflict';
                return { fire: true, repairKind: 'conflict', event: nextEvent, actionPrompt: buildConflictRepairPrompt({
                    prNumber: snapshot.prNumber, prKey: snapshot.prKey, headRef: snapshot.headRef,
                    headSha: snapshot.headSha, baseSha: snapshot.baseSha, baseRef: snapshot.baseRef,
                }) };
            }
            if (!options?.manualCi && (snapshot.mergeability?.state === 'unknown' || !snapshot.mergeability)) {
                return this.noFire(event, { ...nextEvent, lastSeenChecks: priorChecks });
            }
        }

        // Authoritative production snapshots carry a checks/head receipt. Never
        // treat a changed head's old failure/green snapshot as actionable.
        if (snapshot.checksHeadSha !== undefined && snapshot.checksHeadSha !== snapshot.headSha) {
            nextEvent.repairStatus = 'Waiting for fresh current-head CI';
            return this.noFire(event, { ...nextEvent, lastSeenChecks: priorChecks });
        }
        if (newlyFailing.length === 0) {
            // No new failure transition — track the latest state and keep polling.
            return this.noFire(event, nextEvent);
        }

        // A failing transition is pending. Enforce the per-SHA retry cap.
        if (attemptCount >= MAX_CI_FIX_ATTEMPTS) {
            nextEvent.repairStatus = 'CI repair retry budget exhausted for this head; human action required';
            if (attemptNotified) {
                // Already notified for this SHA — stay armed (a new commit resets
                // the cap) but do not fire or re-notify.
                return { fire: false, event: nextEvent };
            }
            // First time hitting the cap for this SHA — withhold the fix, mark the
            // notice as sent, and signal the manager to surface it once.
            return {
                fire: false,
                event: { ...nextEvent, attemptNotified: true },
                retryLimitReached: true,
            };
        }

        // Under the cap — fire and record this attempt against the current SHA.
        // Name every currently-failing check (full picture), not only the newly
        // failed ones.
        const failingChecks = snapshot.checks.filter(c => c.status === 'failure');

        // Best-effort: pre-fetch a truncated log excerpt to inject into the
        // prompt (AC-02). A log-fetch failure must NEVER block the fix from
        // firing, so the call is guarded and degrades to an excerpt-less prompt.
        let logExcerpt: string | undefined;
        if (this.logFetcher) {
            try {
                logExcerpt = await this.logFetcher({
                    workspaceId: trigger.workspaceId,
                    originId: event.originId,
                    prId: event.prId,
                    failingChecks,
                });
            } catch {
                logExcerpt = undefined;
            }
        }

        const actionPrompt = buildCiFailurePrompt(snapshot.prNumber, failingChecks, snapshot.headRef, logExcerpt);
        return {
            fire: true,
            repairKind: 'ci',
            event: { ...nextEvent, attemptCount: attemptCount + 1,
                repairStatus: 'Repairing current-head CI; provider policies still apply' },
            actionPrompt,
        };
    }

    private noFire(previous: ConditionMonitorEvent, event: ConditionMonitorEvent): EvaluationOutcome {
        return { fire: false, event, changed: previous.repairStatus !== event.repairStatus };
    }
}
