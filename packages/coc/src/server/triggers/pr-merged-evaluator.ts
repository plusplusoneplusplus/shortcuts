/**
 * PR-Merged Condition-Monitor Evaluator
 *
 * Watches one PR (by provider-qualified identity, with this server's own
 * credentials) for a Sentinel To-do wake rule:
 *  - `open` / `draft`  → keep polling; clears any previous read error.
 *  - `merged`          → fire (the manager hands the one-shot fire to its
 *                        `OneShotFirer`, which checks the item and delivers).
 *  - `closed`          → terminal `closed-unmerged`; nothing is posted.
 *  - read/login error  → never fires; recorded in `lastError` and retried
 *                        with backoff (see {@link getPrMergedPollDelay}).
 *
 * Provider data (title, merge commit) is untrusted display text.
 */

import type { PrMergedMonitorEvent, Trigger } from './trigger-types';
import { MAX_PR_MERGE_BACKOFF_MS } from './trigger-types';
import type { EvaluationOutcome, EventEvaluator } from './trigger-manager';
import type { PrStatusFetcher } from './pr-status-fetcher';

export class PrMergedEvaluator implements EventEvaluator {
    constructor(
        private readonly fetchStatus: PrStatusFetcher,
        private readonly now: () => number = Date.now,
    ) {}

    async evaluate(trigger: Trigger): Promise<EvaluationOutcome> {
        const event = trigger.event;
        if (event.type !== 'condition-monitor' || event.monitor !== 'pr-merged') {
            throw new Error(`PrMergedEvaluator cannot evaluate monitor ${(event as { monitor?: string }).monitor}`);
        }

        let snapshot;
        try {
            snapshot = await this.fetchStatus(event.pr);
        } catch (err) {
            const next: PrMergedMonitorEvent = {
                ...event,
                lastError: { message: errorMessage(err), at: new Date(this.now()).toISOString() },
                consecutiveErrors: event.consecutiveErrors + 1,
            };
            return { fire: false, event: next, changed: true };
        }

        const { lastError: _cleared, ...rest } = event;
        const next: PrMergedMonitorEvent = {
            ...rest,
            lastSeenStatus: snapshot.status,
            lastSeenTitle: snapshot.title,
            ...(snapshot.mergeCommit ? { mergeCommit: snapshot.mergeCommit } : {}),
            consecutiveErrors: 0,
        };
        const changed = !!event.lastError || event.lastSeenStatus !== next.lastSeenStatus
            || event.lastSeenTitle !== next.lastSeenTitle;

        if (snapshot.status === 'merged') return { fire: true, event: next };
        if (snapshot.status === 'closed') {
            return {
                fire: false,
                event: next,
                autoDisarm: { status: 'disarmed', reason: 'PR closed without merging', outcome: 'closed-unmerged' },
            };
        }
        return { fire: false, event: next, changed };
    }
}

/**
 * Delay before the next poll of a merge watch: the steady cadence, doubled per
 * consecutive read error and capped at {@link MAX_PR_MERGE_BACKOFF_MS}.
 */
export function getPrMergedPollDelay(event: PrMergedMonitorEvent): number {
    if (event.consecutiveErrors <= 0) return event.pollIntervalMs;
    const factor = 2 ** Math.min(event.consecutiveErrors, 16);
    return Math.min(event.pollIntervalMs * factor, Math.max(MAX_PR_MERGE_BACKOFF_MS, event.pollIntervalMs));
}

function errorMessage(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    return message.slice(0, 500) || 'Unknown error';
}
